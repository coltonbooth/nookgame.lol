// Keyboard control. This serves power users and screen-reader users equally,
// which is why it is a first-class input path rather than an afterthought:
// every action available to a finger is available to a key.
//
//   1 2 3   select a tray piece      Q  stash to the Nook
//   E       take the Nook's piece    ← ↑ ↓ → / WASD  move the ghost
//   Enter / Space  place             Esc  put it back

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
import type { Layout } from '../render/layout';
import type { DragView } from '../render/renderer';

export interface KeyboardDeps {
  getState(): GameState;
  getLayout(): Layout;
  dispatch(action: Action): void;
  announce(message: string): void;
  invalidate(): void;
}

interface Selection {
  readonly source: Source;
  readonly index: number;
  readonly liftedAt: number;
  x: number;
  y: number;
}

export class KeyboardController {
  private selection: Selection | null = null;

  constructor(private readonly deps: KeyboardDeps) {}

  attach(target: EventTarget = window): () => void {
    const onKeyDown = (event: Event): void => this.handle(event as KeyboardEvent);
    target.addEventListener('keydown', onKeyDown);
    return () => target.removeEventListener('keydown', onKeyDown);
  }

  /** Selection is cleared whenever the tray changes under it. */
  syncTo(state: GameState): void {
    const sel = this.selection;
    if (!sel) return;
    if (!this.slotOf(state, sel)) this.reset();
  }

  view(): DragView | null {
    const sel = this.selection;
    if (!sel) return null;

    const state = this.deps.getState();
    const slot = this.slotOf(state, sel);
    if (!slot) return null;

    const layout = this.deps.getLayout();
    const b = layout.board;
    const p = preview(state, sel.source, sel.index, sel.x, sel.y);

    return {
      source: sel.source,
      index: sel.index,
      piece: slot.piece,
      color: slot.color,
      marker: slot.marker,
      liftedAt: sel.liftedAt,
      ghostX: b.x + sel.x * b.cell,
      ghostY: b.y + sel.y * b.cell,
      snap: p.legal ? { x: sel.x, y: sel.y } : null,
      preview: p.legal ? p : NO_PREVIEW,
      overNook: false,
      // Keep the piece visible in the tray too — with no finger on screen,
      // seeing where it came from is the only cue you have.
      hideSource: false,
    };
  }

  // --- internals ---------------------------------------------------------

  private handle(event: KeyboardEvent): void {
    if (event.metaKey || event.ctrlKey || event.altKey) return;

    // Don't fight the restart button for Space and Enter.
    const focused = document.activeElement;
    if (focused instanceof HTMLButtonElement || focused instanceof HTMLInputElement) {
      return;
    }

    const state = this.deps.getState();
    if (state.status !== 'playing') return;

    const key = event.key.toLowerCase();
    let handled = true;

    switch (key) {
      case '1':
      case '2':
      case '3':
        this.select(state, 'tray', Number(key) - 1);
        break;
      case 'e':
        this.select(state, 'nook', 0);
        break;
      case 'q':
        this.stash(state);
        break;
      case 'arrowleft':
      case 'a':
        this.move(state, -1, 0);
        break;
      case 'arrowright':
      case 'd':
        this.move(state, 1, 0);
        break;
      case 'arrowup':
      case 'w':
        this.move(state, 0, -1);
        break;
      case 'arrowdown':
      case 's':
        this.move(state, 0, 1);
        break;
      case 'enter':
      case ' ':
        this.place(state);
        break;
      case 'escape':
        this.reset();
        this.deps.announce('put back.');
        break;
      default:
        handled = false;
    }

    if (handled) {
      event.preventDefault();
      this.deps.invalidate();
    }
  }

  private select(state: GameState, source: Source, index: number): void {
    if (source === 'nook' && !state.nookUnlocked) {
      this.deps.announce('the nook is sealed. clear a line through a gem.');
      return;
    }

    const slot = this.slotOf(state, { source, index });
    if (!slot) {
      this.deps.announce(source === 'nook' ? 'the nook is empty.' : 'empty slot.');
      return;
    }

    const start = this.firstLegal(state, source, index) ?? { x: 0, y: 0 };
    this.selection = { source, index, liftedAt: performance.now(), ...start };

    const name = piece(slot.piece).name;
    this.deps.announce(
      source === 'nook'
        ? `took ${name} from the nook.`
        : `selected ${name}, slot ${index + 1}.`,
    );
  }

  private stash(state: GameState): void {
    if (!state.nookUnlocked) {
      this.deps.announce('the nook is sealed. clear a line through a gem.');
      return;
    }

    const sel = this.selection;
    if (!sel || sel.source !== 'tray') {
      this.deps.announce('select a tray piece first.');
      return;
    }
    if (state.nook && state.swapUsed) {
      this.deps.announce('no swap left this deal.');
      return;
    }

    this.deps.dispatch({ type: 'stash', index: sel.index });
    this.reset();
    this.deps.announce('tucked into the nook.');
  }

  private move(state: GameState, dx: number, dy: number): void {
    const sel = this.selection;
    if (!sel) return;

    const slot = this.slotOf(state, sel);
    if (!slot) return;

    const shape = piece(slot.piece);
    sel.x = clamp(sel.x + dx, 0, N - shape.w);
    sel.y = clamp(sel.y + dy, 0, N - shape.h);
  }

  private place(state: GameState): void {
    const sel = this.selection;
    if (!sel) return;

    if (!preview(state, sel.source, sel.index, sel.x, sel.y).legal) {
      this.deps.announce("that doesn't fit here.");
      return;
    }

    this.deps.dispatch({
      type: 'place',
      source: sel.source,
      index: sel.index,
      x: sel.x,
      y: sel.y,
    });
    this.reset();
  }

  /** Drop the current selection — on restart, or when a drag takes over. */
  reset(): void {
    this.selection = null;
    this.deps.invalidate();
  }

  private slotOf(
    state: GameState,
    sel: { source: Source; index: number },
  ): Slot | null {
    return sel.source === 'nook' ? state.nook : (state.tray[sel.index] ?? null);
  }

  /** Park the ghost somewhere it actually fits, so the first keypress is useful. */
  private firstLegal(
    state: GameState,
    source: Source,
    index: number,
  ): { x: number; y: number } | null {
    const slot = this.slotOf(state, { source, index });
    if (!slot) return null;
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        if (canPlaceAt(state.board, slot.piece, x, y)) return { x, y };
      }
    }
    return null;
  }
}

const clamp = (v: number, lo: number, hi: number): number =>
  Math.max(lo, Math.min(hi, v));
