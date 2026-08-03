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
  /**
   * The engraved brass plate below the board, where the score rolls. The one
   * memorable object in the design — the score is not a number in a corner.
   */
  readonly plate: Rect;
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

/** The plate's height as a fraction of the board's width. */
const PLATE_RATIO = 0.13;

/**
 * Headroom above the board, as a fraction of its width.
 *
 * The run lights are centred *on* the top bezel, so half of each one lives
 * above the board rectangle. Without reserving room here they get sliced off by
 * the top of the canvas whenever the viewport is tight enough that `boardY`
 * rounds down to nearly zero. Must stay at or above `RUN_LIGHT_ROOM` in the
 * renderer, which is what actually draws them.
 */
const CROWN_RATIO = 0.028;

export function computeLayout(width: number, height: number): Layout {
  const gap = Math.round(clamp(width * 0.03, 8, 20));

  // Vertically the column is: the crown the bezel lights sit in, the board
  // (1.0), the plate (~0.13) and the tray (~0.25 of the board, since a tray box
  // is a quarter of it), plus the gaps between them. Solve for a board that
  // leaves room for all of it, then snap to a multiple of 8 so cells land on
  // whole pixels.
  const byWidth = width - gap * 2;
  const byHeight =
    (height - gap * 4) / (1 + CROWN_RATIO + PLATE_RATIO + 0.25);
  const size = clamp(
    Math.floor(Math.min(byWidth, byHeight, MAX_BOARD) / N) * N,
    MIN_BOARD,
    MAX_BOARD,
  );

  const cell = size / N;
  // Four boxes across — the Nook plus three tray slots — aligned to the board.
  const unit = Math.floor((size - gap * 3) / 4);
  const plateH = Math.round(size * PLATE_RATIO);
  const crown = Math.ceil(size * CROWN_RATIO);

  const stack = crown + size + plateH + unit;
  const slack = Math.max(0, height - stack - gap * 2);
  // Never less than the crown, however little vertical room there is.
  const boardY = crown + Math.round(slack * 0.3);
  const plateY = Math.round(boardY + size + gap * 0.55);
  const trayY = Math.round(height - unit - slack * 0.3);
  const left = Math.round((width - size) / 2);

  const slots: Rect[] = [];
  for (let i = 0; i < 3; i++) {
    slots.push({ x: left + (unit + gap) * (i + 1), y: trayY, w: unit, h: unit });
  }

  return {
    width,
    height,
    board: { x: left, y: boardY, w: size, h: size, cell },
    // Narrower than the board so it reads as a plate set into the frame rather
    // than a second panel the same width as the playfield.
    plate: {
      x: Math.round(left + size * 0.16),
      y: plateY,
      w: Math.round(size * 0.68),
      h: plateH,
    },
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
