// Hand-written canvas renderer. Board, tray and Nook are canvas; everything
// else (score, panels, settings) is DOM, which keeps text and accessibility
// easy and leaves the canvas doing only what canvas is good at.

import { N, isFilled } from '../core/board';
import type { MarkerKind, Preview, Slot, Source } from '../core/game';
import { type GameState, markerAt, slotFits } from '../core/game';
import { piece, type PieceId } from '../core/pieces';
import { Effects } from './effects';
import { computeLayout, trayCellFor, type Layout, type Rect } from './layout';
import {
  BRASS,
  FELT,
  IVORY,
  RECESS,
  SpriteCache,
  drawGemPath,
  type SpriteSheet,
} from './sprites';

/** What the input layer is currently doing, as far as drawing is concerned. */
export interface DragView {
  readonly source: Source;
  readonly index: number;
  readonly piece: PieceId;
  readonly color: number;
  /** Where to draw the piece's top-left cell, in CSS pixels. */
  readonly ghostX: number;
  readonly ghostY: number;
  /** The board anchor it would snap to, or null if nothing is in range. */
  readonly snap: { readonly x: number; readonly y: number } | null;
  /** Index into the piece's cells carrying a marker, or NO_MARKER. */
  readonly marker: number;
  readonly markerKind: MarkerKind;
  /** performance.now() when this piece was picked up, for the lift animation. */
  readonly liftedAt: number;
  readonly preview: Preview;
  readonly overNook: boolean;
  /** A dragged piece leaves its slot; a keyboard-selected one stays put. */
  readonly hideSource: boolean;
}

const DPR_CAP = 3;
const GHOST_ALPHA = 0.35;
const DEAD_ALPHA = 0.4;

/** Pickup lift, per the game-feel checklist: ~1.15x with a shadow. */
const LIFT_SCALE = 0.15;
const LIFT_MS = 130;

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));

/** Overshoots slightly then settles — the difference between snap and pop. */
function easeOutBack(t: number): number {
  const c = 1.9;
  return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2);
}

const reducedMotion = (): boolean =>
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export class Renderer {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly sprites = new SpriteCache();
  private dpr = 1;

  /** Pops, particles and shake. Owned here so the loop can ask if it's busy. */
  readonly effects = new Effects(reducedMotion);

  layout: Layout;

  /** The element whose box drives the canvas size — never the canvas itself. */
  readonly host: HTMLElement;

  constructor(private readonly canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('canvas 2d context unavailable');
    this.ctx = ctx;
    this.host = canvas.parentElement ?? canvas;
    this.layout = computeLayout(1, 1);
    this.resize();
  }

  /** Re-measure and re-scale for the current size and device pixel ratio. */
  resize(): Layout {
    const rect = this.host.getBoundingClientRect();
    const cssWidth = Math.max(1, rect.width);
    const cssHeight = Math.max(1, rect.height);

    // Cap at 3 — 4× on some Androids is wasted fill rate.
    this.dpr = Math.min(window.devicePixelRatio || 1, DPR_CAP);
    this.canvas.width = Math.round(cssWidth * this.dpr);
    this.canvas.height = Math.round(cssHeight * this.dpr);
    this.canvas.style.width = `${cssWidth}px`;
    this.canvas.style.height = `${cssHeight}px`;
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    this.layout = computeLayout(cssWidth, cssHeight);
    return this.layout;
  }

  draw(
    state: GameState,
    view: DragView | null,
    now: number,
    endProgress = 0,
  ): void {
    const { ctx } = this;
    const l = this.layout;

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = FELT;
    ctx.fillRect(0, 0, l.width, l.height);

    // Shake moves the board and its debris, never the tray or the HUD —
    // shaking the thing you are about to aim at is just cruel.
    const shake = this.effects.shakeOffset(now);
    ctx.save();
    ctx.translate(shake.x, shake.y);
    this.drawBoard(state, view, now);
    this.effects.draw(ctx, l, now);
    ctx.restore();

    this.drawNook(state, view);
    this.drawTray(state, view);
    if (view) {
      this.drawDragged(view, now);
      this.drawGain(view);
    }

    if (endProgress > 0) this.drawEnding(endProgress);
  }

  /**
   * Board drains to greyscale before the panel arrives. The doc is right that
   * the moment needs to land — cutting straight to a score card reads as the
   * game being taken away from you.
   */
  private drawEnding(progress: number): void {
    const { ctx } = this;
    const b = this.layout.board;

    ctx.save();
    // 'saturation' takes the saturation of the source and the luminosity of
    // the backdrop, so filling with flat grey drains the colour out.
    ctx.globalCompositeOperation = 'saturation';
    ctx.globalAlpha = clamp01(progress);
    ctx.fillStyle = 'hsl(0, 0%, 50%)';
    ctx.fillRect(b.x - 4, b.y - 4, b.w + 8, b.h + 8);
    ctx.restore();
  }

  // --- board -------------------------------------------------------------

  private drawBoard(
    state: GameState,
    view: DragView | null,
    now: number,
  ): void {
    const { ctx } = this;
    const b = this.layout.board;
    const sheet = this.sprites.get(b.cell, this.dpr);

    // The recess the blocks sit in, with a brass bezel around the frame.
    roundRect(ctx, b.x, b.y, b.w, b.h, b.cell * 0.16);
    ctx.fillStyle = RECESS;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(200, 162, 74, 0.55)';
    ctx.stroke();

    // Empty wells, so the grid reads as a physical object rather than lines.
    ctx.fillStyle = 'rgba(255, 255, 255, 0.028)';
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        if (isFilled(state.board, x, y)) continue;
        roundRect(
          ctx,
          b.x + x * b.cell + b.cell * 0.1,
          b.y + y * b.cell + b.cell * 0.1,
          b.cell * 0.8,
          b.cell * 0.8,
          b.cell * 0.14,
        );
        ctx.fill();
      }
    }

    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const color = state.colors[y * N + x] ?? 0;
        if (color === 0 || !isFilled(state.board, x, y)) continue;
        const px = b.x + x * b.cell;
        const py = b.y + y * b.cell;
        this.blit(sheet, color, px, py, b.cell);
        const marker = markerAt(state, x, y);
        if (marker) this.blitMarker(sheet, marker, px, py, b.cell);
      }
    }

    if (view?.snap) {
      this.drawClearPreview(view, now);
      this.drawGhost(view);
    }
  }

  /**
   * Pulse the rows and columns this placement would clear. Pure UX, but it is
   * what makes the game readable on a small screen and it teaches the run
   * system without a tutorial.
   */
  private drawClearPreview(view: DragView, now: number): void {
    const { rows, cols } = view.preview.lines;
    if (rows.length === 0 && cols.length === 0) return;

    const { ctx } = this;
    const b = this.layout.board;
    // Reduced motion keeps the highlight, loses the throb.
    const alpha = reducedMotion() ? 0.22 : 0.18 + 0.09 * Math.sin(now / 190);

    ctx.save();
    ctx.fillStyle = `rgba(224, 160, 50, ${alpha})`;
    for (const y of rows) {
      ctx.fillRect(b.x, b.y + y * b.cell, b.w, b.cell);
    }
    for (const x of cols) {
      ctx.fillRect(b.x + x * b.cell, b.y, b.cell, b.h);
    }
    ctx.restore();
  }

  /** What this placement is worth, floating just above the ghost. */
  private drawGain(view: DragView): void {
    if (!view.snap || !view.preview.legal) return;

    const { ctx } = this;
    const b = this.layout.board;
    const p = piece(view.piece);

    const cx = b.x + (view.snap.x + p.w / 2) * b.cell;
    // Above the piece normally; below it when the piece is against the top
    // edge, so the label never sits on top of the blocks it describes.
    const above = b.y + view.snap.y * b.cell - b.cell * 0.42;
    const cy =
      above >= b.y + b.cell * 0.3
        ? above
        : b.y + (view.snap.y + p.h) * b.cell + b.cell * 0.42;

    ctx.save();
    ctx.font = `600 ${Math.round(b.cell * 0.42)}px ui-sans-serif, system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = Math.max(2, b.cell * 0.12);
    ctx.strokeStyle = 'rgba(26, 29, 35, 0.85)';
    ctx.fillStyle = view.preview.lines.rows.length + view.preview.lines.cols.length > 0
      ? '#E0A032'
      : IVORY;

    const label = `+${view.preview.gained}`;
    ctx.strokeText(label, cx, cy);
    ctx.fillText(label, cx, cy);
    ctx.restore();
  }

  private drawGhost(view: DragView): void {
    const { ctx } = this;
    const b = this.layout.board;
    const snap = view.snap!;

    ctx.save();
    ctx.globalAlpha = GHOST_ALPHA;
    ctx.strokeStyle = IVORY;
    ctx.lineWidth = Math.max(1.5, b.cell * 0.07);
    for (const [dx, dy] of piece(view.piece).cells) {
      roundRect(
        ctx,
        b.x + (snap.x + dx) * b.cell + b.cell * 0.08,
        b.y + (snap.y + dy) * b.cell + b.cell * 0.08,
        b.cell * 0.84,
        b.cell * 0.84,
        b.cell * 0.15,
      );
      ctx.stroke();
    }
    ctx.restore();
  }

  // --- the Nook ----------------------------------------------------------

  private drawNook(state: GameState, view: DragView | null): void {
    const { ctx } = this;
    const r = this.layout.nook;

    // An alcove cut into the frame — same brass bezel, deeper shadow — not a
    // fourth tray slot.
    roundRect(ctx, r.x, r.y, r.w, r.h, r.w * 0.16);
    ctx.fillStyle = state.nookUnlocked ? '#15171C' : '#101216';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = !state.nookUnlocked
      ? 'rgba(200, 162, 74, 0.14)'
      : state.nook && state.swapUsed
        ? 'rgba(200, 162, 74, 0.24)'
        : 'rgba(200, 162, 74, 0.5)';
    ctx.stroke();

    // Sealed: no word, just the shape of what opens it. The alcove is there
    // from the first frame so the goal teaches itself.
    if (!state.nookUnlocked) {
      // The one placement that would open it lights the alcove up, which is
      // where the gem and the alcove finally connect for the player.
      const opening = view?.preview.wouldUnlock ?? false;
      ctx.save();
      ctx.globalAlpha = opening ? 0.95 : 0.3;
      drawGemPath(ctx, r.x + r.w / 2, r.y + r.h / 2, r.w * 0.15);
      ctx.strokeStyle = BRASS;
      ctx.lineWidth = Math.max(1.5, r.w * (opening ? 0.032 : 0.022));
      ctx.stroke();
      ctx.restore();
      return;
    }

    if (view?.overNook) {
      ctx.save();
      ctx.globalAlpha = 0.5;
      ctx.strokeStyle = IVORY;
      ctx.lineWidth = 2;
      roundRect(ctx, r.x + 2, r.y + 2, r.w - 4, r.h - 4, r.w * 0.14);
      ctx.stroke();
      ctx.restore();
    }

    const lifted = view?.hideSource && view.source === 'nook';
    if (!state.nook || lifted) {
      ctx.save();
      ctx.globalAlpha = 0.28;
      ctx.fillStyle = IVORY;
      ctx.font = `${Math.round(r.h * 0.17)}px ui-sans-serif, system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('nook', r.x + r.w / 2, r.y + r.h / 2);
      ctx.restore();
      return;
    }

    this.drawPieceIn(r, state.nook, 1);
  }

  // --- tray --------------------------------------------------------------

  private drawTray(state: GameState, view: DragView | null): void {
    this.layout.slots.forEach((rect, i) => {
      const slot = state.tray[i];
      if (!slot) return;
      if (view?.hideSource && view.source === 'tray' && view.index === i) return;

      // Dead pieces fade — vital readability, and it builds dread beautifully.
      this.drawPieceIn(rect, slot, slotFits(state, slot) ? 1 : DEAD_ALPHA);
    });
  }

  // --- the piece under the pointer ---------------------------------------

  private drawDragged(view: DragView, now: number): void {
    const { ctx } = this;
    const cell = this.layout.board.cell;
    const sheet = this.sprites.get(cell, this.dpr);
    const p = piece(view.piece);

    ctx.save();

    // Lift: the piece scales up as you pick it up, so it reads as coming off
    // the board rather than sliding along it. Scaled about its own centre.
    const lift = reducedMotion()
      ? 1
      : 1 + LIFT_SCALE * easeOutBack(clamp01((now - view.liftedAt) / LIFT_MS));
    if (lift !== 1) {
      const cx = view.ghostX + (p.w * cell) / 2;
      const cy = view.ghostY + (p.h * cell) / 2;
      ctx.translate(cx, cy);
      ctx.scale(lift, lift);
      ctx.translate(-cx, -cy);
    }
    // A keyboard-held piece hovers rather than being carried, and with no
    // finger on screen it would otherwise be indistinguishable from a placed
    // one. Nothing in range: tint invalid rather than hiding the piece —
    // silent failure just confuses.
    ctx.globalAlpha = view.hideSource ? 1 : 0.72;
    if (!view.snap && !view.overNook) ctx.globalAlpha = 0.55;

    ctx.shadowColor = 'rgba(0, 0, 0, 0.45)';
    ctx.shadowBlur = cell * 0.35;
    ctx.shadowOffsetY = cell * 0.12;

    p.cells.forEach(([dx, dy], i) => {
      const px = view.ghostX + dx * cell;
      const py = view.ghostY + dy * cell;
      this.blit(sheet, view.color, px, py, cell);
      if (i === view.marker) this.blitMarker(sheet, view.markerKind, px, py, cell);
    });
    ctx.restore();
  }

  // --- primitives --------------------------------------------------------

  /** Draw a piece centred inside a box, scaled to fit it. */
  private drawPieceIn(rect: Rect, slot: Slot, alpha: number): void {
    const { ctx } = this;
    const p = piece(slot.piece);
    const cell = trayCellFor(this.layout, p.w, p.h);
    const sheet = this.sprites.get(cell, this.dpr);

    const originX = rect.x + (rect.w - p.w * cell) / 2;
    const originY = rect.y + (rect.h - p.h * cell) / 2;

    ctx.save();
    ctx.globalAlpha = alpha;
    p.cells.forEach(([dx, dy], i) => {
      const px = originX + dx * cell;
      const py = originY + dy * cell;
      this.blit(sheet, slot.color, px, py, cell);
      if (i === slot.marker) this.blitMarker(sheet, slot.markerKind, px, py, cell);
    });
    ctx.restore();
  }

  private blit(
    sheet: SpriteSheet,
    color: number,
    x: number,
    y: number,
    size: number,
  ): void {
    const face = sheet.faces[color];
    if (face) this.ctx.drawImage(face, x, y, size, size);
  }

  private blitMarker(
    sheet: SpriteSheet,
    kind: MarkerKind,
    x: number,
    y: number,
    size: number,
  ): void {
    this.ctx.drawImage(kind === 'star' ? sheet.star : sheet.gem, x, y, size, size);
  }
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}
