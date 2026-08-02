// Where everything sits on the canvas, in CSS pixels. Shared by the renderer
// and the input layer so hit-testing and drawing can never disagree.

import { N } from '../core/board';

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export interface Layout {
  readonly width: number;
  readonly height: number;
  /** The 8×8 playfield. `cell` is one grid square. */
  readonly board: Rect & { readonly cell: number };
  /** The alcove cut into the frame, to the left of the tray. */
  readonly nook: Rect;
  readonly slots: readonly Rect[];
  /** Side of one box in the tray row. */
  readonly unit: number;
}

/**
 * Cell size for a piece drawn in the tray or the Nook: scaled to fill its box,
 * but never larger than a fraction of a board cell — so a 1×1 still reads as
 * small next to a 5-line, without vanishing.
 */
export function trayCellFor(
  layout: Layout,
  w: number,
  h: number,
): number {
  const fit = (layout.unit * 0.86) / Math.max(w, h);
  return Math.min(fit, layout.board.cell * 0.62);
}

/** Desktop cap — don't stretch a phone game across a 27" monitor. */
const MAX_BOARD = 480;
const MIN_BOARD = 96;

const clamp = (v: number, lo: number, hi: number): number =>
  Math.max(lo, Math.min(hi, v));

export function computeLayout(width: number, height: number): Layout {
  const gap = Math.round(clamp(width * 0.03, 8, 20));

  // The tray row is a quarter of the board plus its gaps, so solve for a board
  // that leaves room for it, then snap to a multiple of 8 for whole-pixel cells.
  const byWidth = width - gap * 2;
  const byHeight = (height - gap * 3) / 1.3;
  const size = clamp(
    Math.floor(Math.min(byWidth, byHeight, MAX_BOARD) / N) * N,
    MIN_BOARD,
    MAX_BOARD,
  );

  const cell = size / N;
  // Four boxes across — the Nook plus three tray slots — aligned to the board.
  const unit = Math.floor((size - gap * 3) / 4);

  const slack = Math.max(0, height - size - unit - gap);
  const boardY = Math.round(slack * 0.3);
  const trayY = Math.round(height - unit - slack * 0.35);
  const left = Math.round((width - size) / 2);

  const slots: Rect[] = [];
  for (let i = 0; i < 3; i++) {
    slots.push({ x: left + (unit + gap) * (i + 1), y: trayY, w: unit, h: unit });
  }

  return {
    width,
    height,
    board: { x: left, y: boardY, w: size, h: size, cell },
    nook: { x: left, y: trayY, w: unit, h: unit },
    slots,
    unit,
  };
}

export const contains = (r: Rect, px: number, py: number): boolean =>
  px >= r.x && px < r.x + r.w && py >= r.y && py < r.y + r.h;

/** Board cell under a point, or null. Fractional coords are floored. */
export function cellAt(
  layout: Layout,
  px: number,
  py: number,
): { x: number; y: number } | null {
  const { board } = layout;
  const x = Math.floor((px - board.x) / board.cell);
  const y = Math.floor((py - board.y) / board.cell);
  if (x < 0 || y < 0 || x >= N || y >= N) return null;
  return { x, y };
}
