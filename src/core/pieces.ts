// The piece catalogue. Fixed orientation only — every rotation is its own
// entry, and there is deliberately no rotation code anywhere in the codebase.
// That constraint is what makes the genre work; it is not an oversight.

export type PieceId = number;

export type Family =
  | 'single'
  | 'domino'
  | 'line3'
  | 'line4'
  | 'line5'
  | 'square'
  | 'rect'
  | 'bigsquare'
  | 'ltri'
  | 'ltet'
  | 'stet'
  | 'ttet'
  | 'corner';

export interface Piece {
  readonly id: PieceId;
  readonly name: string;
  readonly family: Family;
  /** [dx, dy] offsets from the piece's top-left anchor. */
  readonly cells: ReadonlyArray<readonly [number, number]>;
  readonly w: number;
  readonly h: number;
  readonly size: number;
  /** Relative draw weight. Primary difficulty dial — tune from play data. */
  readonly weight: number;
}

type Spec = {
  name: string;
  family: Family;
  cells: ReadonlyArray<readonly [number, number]>;
  weight: number;
};

const rect = (w: number, h: number): Array<readonly [number, number]> => {
  const cells: Array<readonly [number, number]> = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) cells.push([x, y]);
  return cells;
};

// Weights are the primary difficulty dial, and they are also what makes the
// game feel generous or stingy. Skewed toward chunky pieces on purpose: a bag
// full of dominoes and triominoes feels like scraps, and small pieces cannot
// fill a row fast enough to keep lines clearing.
//
// Chunky is not the same as square, though, and the catalogue used to conflate
// them: 2x2, 3x2 and 2x3 were the three heaviest entries. A 2-D block occupies
// two or three rows at once and completes none of them, so a bag full of them
// fills the board evenly and clears nothing. On an eight-wide board what closes
// a row is a *line*, so the line families now outweigh the rectangles.
const SPECS: Spec[] = [
  // A get-out-of-jail card, not a crutch.
  { name: '1x1', family: 'single', cells: rect(1, 1), weight: 2 },

  { name: '2x1', family: 'domino', cells: rect(2, 1), weight: 5 },
  { name: '1x2', family: 'domino', cells: rect(1, 2), weight: 5 },

  { name: '3x1', family: 'line3', cells: rect(3, 1), weight: 10 },
  { name: '1x3', family: 'line3', cells: rect(1, 3), weight: 10 },

  { name: '4x1', family: 'line4', cells: rect(4, 1), weight: 10 },
  { name: '1x4', family: 'line4', cells: rect(1, 4), weight: 10 },

  // Half a row in one piece — the workhorse of a big clear.
  { name: '5x1', family: 'line5', cells: rect(5, 1), weight: 9 },
  { name: '1x5', family: 'line5', cells: rect(1, 5), weight: 9 },

  { name: '2x2', family: 'square', cells: rect(2, 2), weight: 9 },

  { name: '3x2', family: 'rect', cells: rect(3, 2), weight: 7 },
  { name: '2x3', family: 'rect', cells: rect(2, 3), weight: 7 },

  { name: '4x2', family: 'rect', cells: rect(4, 2), weight: 3 },
  { name: '2x4', family: 'rect', cells: rect(2, 4), weight: 3 },

  { name: '3x3', family: 'bigsquare', cells: rect(3, 3), weight: 3 },

  // The heavyweights. Rare, but they exist, and landing one is an event.
  { name: '4x3', family: 'bigsquare', cells: rect(4, 3), weight: 1 },
  { name: '3x4', family: 'bigsquare', cells: rect(3, 4), weight: 1 },
  { name: '4x4', family: 'bigsquare', cells: rect(4, 4), weight: 1 },

  // L-triomino — 2×2 minus one cell, all four corners.
  { name: 'L3-a', family: 'ltri', cells: [[0, 0], [1, 0], [0, 1]], weight: 6 },
  { name: 'L3-b', family: 'ltri', cells: [[0, 0], [1, 0], [1, 1]], weight: 6 },
  { name: 'L3-c', family: 'ltri', cells: [[0, 0], [0, 1], [1, 1]], weight: 6 },
  { name: 'L3-d', family: 'ltri', cells: [[1, 0], [0, 1], [1, 1]], weight: 6 },

  // L tetromino, four rotations.
  { name: 'L-0', family: 'ltet', cells: [[0, 0], [0, 1], [0, 2], [1, 2]], weight: 5 },
  { name: 'L-1', family: 'ltet', cells: [[0, 0], [1, 0], [2, 0], [0, 1]], weight: 5 },
  { name: 'L-2', family: 'ltet', cells: [[0, 0], [1, 0], [1, 1], [1, 2]], weight: 5 },
  { name: 'L-3', family: 'ltet', cells: [[2, 0], [0, 1], [1, 1], [2, 1]], weight: 5 },

  // J tetromino, four rotations.
  { name: 'J-0', family: 'ltet', cells: [[1, 0], [1, 1], [0, 2], [1, 2]], weight: 5 },
  { name: 'J-1', family: 'ltet', cells: [[0, 0], [0, 1], [1, 1], [2, 1]], weight: 5 },
  { name: 'J-2', family: 'ltet', cells: [[0, 0], [1, 0], [0, 1], [0, 2]], weight: 5 },
  { name: 'J-3', family: 'ltet', cells: [[0, 0], [1, 0], [2, 0], [2, 1]], weight: 5 },

  // S / Z, two distinct rotations each.
  { name: 'S-0', family: 'stet', cells: [[1, 0], [2, 0], [0, 1], [1, 1]], weight: 4 },
  { name: 'S-1', family: 'stet', cells: [[0, 0], [0, 1], [1, 1], [1, 2]], weight: 4 },
  { name: 'Z-0', family: 'stet', cells: [[0, 0], [1, 0], [1, 1], [2, 1]], weight: 4 },
  { name: 'Z-1', family: 'stet', cells: [[1, 0], [0, 1], [1, 1], [0, 2]], weight: 4 },

  // T tetromino, four rotations.
  { name: 'T-0', family: 'ttet', cells: [[0, 0], [1, 0], [2, 0], [1, 1]], weight: 5 },
  { name: 'T-1', family: 'ttet', cells: [[1, 0], [0, 1], [1, 1], [1, 2]], weight: 5 },
  { name: 'T-2', family: 'ttet', cells: [[1, 0], [0, 1], [1, 1], [2, 1]], weight: 5 },
  { name: 'T-3', family: 'ttet', cells: [[0, 0], [0, 1], [1, 1], [0, 2]], weight: 5 },

  // Big corner — two 3-cell arms sharing a cell, in a 3×3 box.
  { name: 'C-0', family: 'corner', cells: [[0, 0], [0, 1], [0, 2], [1, 2], [2, 2]], weight: 6 },
  { name: 'C-1', family: 'corner', cells: [[0, 0], [1, 0], [2, 0], [0, 1], [0, 2]], weight: 6 },
  { name: 'C-2', family: 'corner', cells: [[0, 0], [1, 0], [2, 0], [2, 1], [2, 2]], weight: 6 },
  { name: 'C-3', family: 'corner', cells: [[2, 0], [2, 1], [0, 2], [1, 2], [2, 2]], weight: 6 },
];

export const PIECES: readonly Piece[] = SPECS.map((spec, id) => {
  let w = 0;
  let h = 0;
  for (const [dx, dy] of spec.cells) {
    if (dx + 1 > w) w = dx + 1;
    if (dy + 1 > h) h = dy + 1;
  }
  return {
    id,
    name: spec.name,
    family: spec.family,
    cells: spec.cells,
    w,
    h,
    size: spec.cells.length,
    weight: spec.weight,
  };
});

export const PIECE_COUNT = PIECES.length;

export function piece(id: PieceId): Piece {
  const p = PIECES[id];
  if (!p) throw new Error(`unknown piece id ${id}`);
  return p;
}

/** The four enamel colours. Index 0 is "empty"; filled cells use 1–4. */
export const COLOR_COUNT = 4;
