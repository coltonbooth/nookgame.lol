// The drag controller. Owns the "piece in hand" state and turns pointer
// positions into board anchors.
//
// Three details in here are the difference between "nice" and "why does this
// feel bad": the piece renders above the finger rather than under it, snapping
// reaches for the nearest legal cell instead of demanding precision, and a
// release that just missed still counts. None of them are visible in a
// screenshot and all of them are obvious in the hand.

import { N, canPlaceAt } from '../core/board';
import {
  NO_PREVIEW,
  preview,
  type Action,
  type GameState,
  type Slot,
  type Source,
} from '../core/game';
import { piece } from '../core/pieces';
import { contains, trayCellFor, type Layout } from '../render/layout';
import type { DragView } from '../render/renderer';
import type { PointerInfo } from './pointer';

interface Held {
  readonly source: Source;
  readonly index: number;
  readonly slot: Slot;
  /** Where inside the piece it was grabbed, in cell units. */
  readonly grabX: number;
  readonly grabY: number;
  /** When it left the tray, for the lift animation. */
  readonly liftedAt: number;
}

export interface DragDeps {
  getState(): GameState;
  getLayout(): Layout;
  dispatch(action: Action): void;
  invalidate(): void;
  /** A piece left the tray. */
  onPickup(): void;
  /** Released somewhere it cannot go. Silence here reads as a dropped input. */
  onInvalidDrop(): void;
}

/** Hold this long without moving to stash, as an alternative to dragging. */
const LONG_PRESS_MS = 450;
const LONG_PRESS_SLOP = 10;

/**
 * Render the dragged piece this far above the touch point. Without it the
 * player's own finger covers the thing they are aiming, and the game feels
 * broken in a way nobody can quite name. Touch and pen only — a mouse cursor
 * occludes nothing.
 */
const FINGER_OFFSET_CELLS = 1.5;

/** How far the snap will reach, in cells, to find a legal home. */
const SNAP_RADIUS_CELLS = 0.6;
/** Extra reach granted only at the moment of release, in CSS pixels. */
const DROP_TOLERANCE_PX = 10;

export class DragController {
  private held: Held | null = null;
  private pointer: PointerInfo | null = null;
  private origin: PointerInfo | null = null;
  private longPress: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly deps: DragDeps) {}

  get active(): boolean {
    return this.held !== null;
  }

  onDown(p: PointerInfo): void {
    const state = this.deps.getState();
    if (state.status !== 'playing') return;

    const held = this.pick(state, p);
    if (!held) return;

    this.held = held;
    this.pointer = p;
    this.origin = p;
    this.deps.onPickup();
    if (held.source === 'tray' && state.nookUnlocked) {
      this.armLongPress(held.index);
    }
    this.deps.invalidate();
  }

  onMove(p: PointerInfo): void {
    if (!this.held) return;
    this.pointer = p;
    if (this.origin && distance(this.origin, p) > LONG_PRESS_SLOP) {
      this.disarmLongPress();
    }
    this.deps.invalidate();
  }

  onUp(p: PointerInfo): void {
    const held = this.held;
    if (!held) return;

    this.pointer = p;
    const state = this.deps.getState();
    const view = this.view();
    const drop = this.resolveDrop(state, held, p);
    this.cancel();

    if (view?.overNook && held.source === 'tray') {
      this.deps.dispatch({ type: 'stash', index: held.index });
      return;
    }
    if (drop) {
      this.deps.dispatch({
        type: 'place',
        source: held.source,
        index: held.index,
        x: drop.x,
        y: drop.y,
      });
      return;
    }

    this.deps.onInvalidDrop();
  }

  cancel(): void {
    this.disarmLongPress();
    this.held = null;
    this.pointer = null;
    this.origin = null;
    this.deps.invalidate();
  }

  private armLongPress(index: number): void {
    this.disarmLongPress();
    this.longPress = setTimeout(() => {
      this.longPress = null;
      if (!this.held) return;
      this.cancel();
      this.deps.dispatch({ type: 'stash', index });
    }, LONG_PRESS_MS);
  }

  private disarmLongPress(): void {
    if (this.longPress === null) return;
    clearTimeout(this.longPress);
    this.longPress = null;
  }

  /** What the renderer should draw, or null when nothing is in hand. */
  view(): DragView | null {
    const held = this.held;
    const p = this.pointer;
    if (!held || !p) return null;

    const state = this.deps.getState();
    const layout = this.deps.getLayout();
    const cell = layout.board.cell;

    const ghostX = p.x - held.grabX * cell;
    const ghostY =
      p.y - held.grabY * cell - (p.occluding ? FINGER_OFFSET_CELLS * cell : 0);

    const snap = this.snapAnchor(state, held, ghostX, ghostY, SNAP_RADIUS_CELLS);
    const overNook =
      state.nookUnlocked &&
      held.source === 'tray' &&
      contains(layout.nook, p.x, p.y) &&
      (state.nook === null || !state.swapUsed);

    return {
      source: held.source,
      index: held.index,
      piece: held.slot.piece,
      color: held.slot.color,
      marker: held.slot.marker,
      markerKind: held.slot.markerKind,
      liftedAt: held.liftedAt,
      ghostX,
      ghostY,
      snap,
      preview: snap
        ? preview(state, held.source, held.index, snap.x, snap.y)
        : NO_PREVIEW,
      overNook,
      hideSource: true,
    };
  }

  // --- internals ---------------------------------------------------------

  /** Which piece, if any, is under this pointer, and where it was grabbed. */
  private pick(state: GameState, p: PointerInfo): Held | null {
    const layout = this.deps.getLayout();

    if (state.nook && contains(layout.nook, p.x, p.y)) {
      return this.grab('nook', 0, state.nook, layout.nook, p);
    }

    for (let i = 0; i < layout.slots.length; i++) {
      const rect = layout.slots[i]!;
      const slot = state.tray[i];
      if (slot && contains(rect, p.x, p.y)) {
        return this.grab('tray', i, slot, rect, p);
      }
    }
    return null;
  }

  private grab(
    source: Source,
    index: number,
    slot: Slot,
    rect: { x: number; y: number; w: number; h: number },
    p: PointerInfo,
  ): Held {
    const layout = this.deps.getLayout();
    const shape = piece(slot.piece);
    const cell = trayCellFor(layout, shape.w, shape.h);

    // Grab point as a fraction of the piece, so it keeps its relationship to
    // the finger when it scales up to board size.
    const originX = rect.x + (rect.w - shape.w * cell) / 2;
    const originY = rect.y + (rect.h - shape.h * cell) / 2;
    const grabX = clamp((p.x - originX) / cell, 0, shape.w);
    const grabY = clamp((p.y - originY) / cell, 0, shape.h);

    return { source, index, slot, grabX, grabY, liftedAt: performance.now() };
  }

  /**
   * Nearest legal anchor to where the piece is floating, measured from the
   * piece's **top-left cell** rather than the finger. The rounded cell wins
   * outright when it is legal; otherwise the search reaches `radius` cells for
   * an alternative. Generosity reads as responsiveness.
   */
  private snapAnchor(
    state: GameState,
    held: Held,
    ghostX: number,
    ghostY: number,
    radius: number,
  ): { x: number; y: number } | null {
    const layout = this.deps.getLayout();
    const b = layout.board;
    const shape = piece(held.slot.piece);

    // `canPlaceAt` is a bounds check and one bitboard AND. `preview` answers
    // the same question but computes the full placement first — line detection,
    // scoring, marker resolution — and this runs up to ten times a frame while
    // a piece is in hand. The full preview is worth paying for exactly once,
    // for the anchor that wins, which `view()` already does.
    const legal = (x: number, y: number): boolean =>
      x >= 0 &&
      y >= 0 &&
      x + shape.w <= N &&
      y + shape.h <= N &&
      canPlaceAt(state.board, held.slot.piece, x, y);

    // Fractional anchor: where the top-left cell actually is, in cell units.
    const fx = (ghostX - b.x) / b.cell;
    const fy = (ghostY - b.y) / b.cell;
    const rx = Math.round(fx);
    const ry = Math.round(fy);

    if (legal(rx, ry)) return { x: rx, y: ry };

    let best: { x: number; y: number } | null = null;
    let bestDistance = radius;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const x = rx + dx;
        const y = ry + dy;
        if (!legal(x, y)) continue;
        const distance = Math.hypot(fx - x, fy - y);
        if (distance < bestDistance) {
          bestDistance = distance;
          best = { x, y };
        }
      }
    }
    return best;
  }

  /**
   * On release, reach a little further than the live snap did. A drop that
   * missed by a few pixels with only one plausible home should still land.
   */
  private resolveDrop(state: GameState, held: Held, p: PointerInfo) {
    const b = this.deps.getLayout().board;
    const ghostX = p.x - held.grabX * b.cell;
    const ghostY =
      p.y - held.grabY * b.cell - (p.occluding ? FINGER_OFFSET_CELLS * b.cell : 0);

    const radius = SNAP_RADIUS_CELLS + DROP_TOLERANCE_PX / b.cell;
    return this.snapAnchor(state, held, ghostX, ghostY, radius);
  }
}

const clamp = (v: number, lo: number, hi: number): number =>
  Math.max(lo, Math.min(hi, v));

const distance = (a: PointerInfo, b: PointerInfo): number =>
  Math.hypot(a.x - b.x, a.y - b.y);
