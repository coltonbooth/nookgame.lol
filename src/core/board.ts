// The board is 64 bits, so it is one BigInt. Every placement of every piece at
// every anchor is precomputed once into a mask, which turns "does this fit
// anywhere" and "is there any legal move at all" into a handful of ANDs.

import { PIECES, piece, type PieceId } from './pieces';

export const N = 8;
export const CELLS = N * N;

export type Board = bigint;

export const EMPTY_BOARD: Board = 0n;

export const idx = (x: number, y: number): number => y * N + x;
export const bit = (x: number, y: number): bigint => 1n << BigInt(idx(x, y));

export const ROW = (y: number): bigint => 0xffn << BigInt(y * N);
export const COL = (x: number): bigint => 0x0101010101010101n << BigInt(x);

export const canPlace = (board: Board, mask: bigint): boolean =>
  (board & mask) === 0n;

export const place = (board: Board, mask: bigint): Board => board | mask;

export const isFilled = (board: Board, x: number, y: number): boolean =>
  (board & bit(x, y)) !== 0n;

export interface Placement {
  readonly x: number;
  readonly y: number;
  readonly mask: bigint;
}

/** Every in-bounds anchor for every piece. ~37 × 64 masks, built at load. */
export const PLACEMENTS: ReadonlyArray<readonly Placement[]> = PIECES.map((p) => {
  const list: Placement[] = [];
  for (let y = 0; y + p.h <= N; y++) {
    for (let x = 0; x + p.w <= N; x++) {
      let mask = 0n;
      for (const [dx, dy] of p.cells) mask |= bit(x + dx, y + dy);
      list.push({ x, y, mask });
    }
  }
  return list;
});

/**
 * The ring of in-bounds cells orthogonally touching a placement, and the count
 * of its edges that press against the board wall. Together these say how
 * snugly a piece would sit in the hole it's going into — which is what lets the
 * generator prefer the L-triomino for an L-shaped gap instead of any old piece
 * that happens to fit.
 *
 * Precomputed alongside the masks, so asking costs an array lookup.
 */
export interface Surround {
  /** Cell indices adjacent to the piece but not part of it. */
  readonly halo: readonly number[];
  /** Perimeter edges facing off the board. A corner is snug for free. */
  readonly wall: number;
}

export const SURROUNDS: ReadonlyArray<readonly Surround[]> = PIECES.map((p) => {
  const list: Surround[] = [];
  for (const pl of PLACEMENTS[p.id]!) {
    const own = new Set(p.cells.map(([dx, dy]) => idx(pl.x + dx, pl.y + dy)));
    const halo = new Set<number>();
    let wall = 0;

    for (const [dx, dy] of p.cells) {
      const cx = pl.x + dx;
      const cy = pl.y + dy;
      for (const [ox, oy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const) {
        const nx = cx + ox;
        const ny = cy + oy;
        if (nx < 0 || ny < 0 || nx >= N || ny >= N) {
          wall++;
          continue;
        }
        const cell = idx(nx, ny);
        if (!own.has(cell)) halo.add(cell);
      }
    }

    list.push({ halo: [...halo], wall });
  }
  return list;
});

/** Board as one byte per cell. Cheaper to poke at repeatedly than a BigInt. */
export function occupancy(board: Board): Uint8Array {
  const cells = new Uint8Array(CELLS);
  let b = board;
  for (let i = 0; i < CELLS && b !== 0n; i++) {
    cells[i] = Number(b & 1n);
    b >>= 1n;
  }
  return cells;
}

/**
 * Mask for a piece anchored at (x, y), or null if it would leave the board.
 * Indexed [pieceId][y * 8 + x].
 */
const PLACEMENT_AT: ReadonlyArray<ReadonlyArray<bigint | null>> = PIECES.map(
  (p) => {
    const slots: Array<bigint | null> = new Array(CELLS).fill(null);
    for (const pl of PLACEMENTS[p.id]!) slots[idx(pl.x, pl.y)] = pl.mask;
    return slots;
  },
);

/** The mask for this piece at this anchor, or null if out of bounds. */
export function maskAt(id: PieceId, x: number, y: number): bigint | null {
  if (x < 0 || y < 0 || x >= N || y >= N) return null;
  return PLACEMENT_AT[id]![idx(x, y)] ?? null;
}

/** Can this piece be legally placed with its top-left cell at (x, y)? */
export function canPlaceAt(
  board: Board,
  id: PieceId,
  x: number,
  y: number,
): boolean {
  const mask = maskAt(id, x, y);
  return mask !== null && canPlace(board, mask);
}

/** Does this piece fit anywhere on this board? */
export function fitsAnywhere(board: Board, id: PieceId): boolean {
  for (const pl of PLACEMENTS[id]!) {
    if ((board & pl.mask) === 0n) return true;
  }
  return false;
}

/** How many legal anchors does this piece have? Used as a pressure metric. */
export function countPlacements(board: Board, id: PieceId): number {
  let n = 0;
  for (const pl of PLACEMENTS[id]!) {
    if ((board & pl.mask) === 0n) n++;
  }
  return n;
}

/** Every legal placement of this piece on this board. */
export function legalPlacements(board: Board, id: PieceId): Placement[] {
  return PLACEMENTS[id]!.filter((pl) => (board & pl.mask) === 0n);
}

export interface FullLines {
  readonly rows: number[];
  readonly cols: number[];
}

export function fullLines(board: Board): FullLines {
  const rows: number[] = [];
  const cols: number[] = [];
  for (let y = 0; y < N; y++) {
    const m = ROW(y);
    if ((board & m) === m) rows.push(y);
  }
  for (let x = 0; x < N; x++) {
    const m = COL(x);
    if ((board & m) === m) cols.push(x);
  }
  return { rows, cols };
}

/**
 * One combined mask for the lines to clear. A row and column that intersect
 * both clear, and the shared cell appears once — the OR handles that for free.
 */
export function lineMask(lines: FullLines): bigint {
  let mask = 0n;
  for (const y of lines.rows) mask |= ROW(y);
  for (const x of lines.cols) mask |= COL(x);
  return mask;
}

/** Clear all full lines simultaneously. No gravity — this is not Tetris. */
export function clearLines(board: Board, lines: FullLines): Board {
  return board & ~lineMask(lines);
}

export function popcount(board: Board): number {
  let n = 0;
  let b = board;
  while (b !== 0n) {
    b &= b - 1n;
    n++;
  }
  return n;
}

/** Build a board from a picture: 8 rows of 8 chars, '.' empty, anything else filled. */
export function boardFromRows(rows: readonly string[]): Board {
  let board = EMPTY_BOARD;
  for (let y = 0; y < N; y++) {
    const row = rows[y] ?? '';
    for (let x = 0; x < N; x++) {
      if ((row[x] ?? '.') !== '.') board |= bit(x, y);
    }
  }
  return board;
}

/** Inverse of boardFromRows. Handy in test failure output. */
export function boardToRows(board: Board): string[] {
  const out: string[] = [];
  for (let y = 0; y < N; y++) {
    let row = '';
    for (let x = 0; x < N; x++) row += isFilled(board, x, y) ? '#' : '.';
    out.push(row);
  }
  return out;
}

/** Cells occupied by a piece anchored at (x, y). For updating the colour map. */
export function cellsAt(id: PieceId, x: number, y: number): number[] {
  return piece(id).cells.map(([dx, dy]) => idx(x + dx, y + dy));
}
