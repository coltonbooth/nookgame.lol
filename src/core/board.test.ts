import { describe, expect, it } from 'vitest';
import {
  COL,
  EMPTY_BOARD,
  ROW,
  boardFromRows,
  boardToRows,
  canPlaceAt,
  clearLines,
  countPlacements,
  fitsAnywhere,
  fullLines,
  idx,
  lineMask,
  maskAt,
  place,
  popcount,
} from './board';
import { PIECES } from './pieces';

const byName = (name: string): number => {
  const p = PIECES.find((piece) => piece.name === name);
  if (!p) throw new Error(`no piece named ${name}`);
  return p.id;
};

const ONE = byName('1x1');
const DOM_H = byName('2x1');
const LINE5_H = byName('5x1');
const BIG = byName('3x3');

describe('geometry', () => {
  it('indexes row-major', () => {
    expect(idx(0, 0)).toBe(0);
    expect(idx(7, 0)).toBe(7);
    expect(idx(0, 1)).toBe(8);
    expect(idx(7, 7)).toBe(63);
  });

  it('builds row and column masks of exactly 8 cells', () => {
    for (let i = 0; i < 8; i++) {
      expect(popcount(ROW(i))).toBe(8);
      expect(popcount(COL(i))).toBe(8);
    }
    expect(ROW(0)).toBe(0xffn);
    expect(COL(0) & ROW(3)).toBe(1n << 24n);
  });

  it('round-trips through the ascii helpers', () => {
    const rows = [
      '#.......',
      '........',
      '..##....',
      '........',
      '........',
      '........',
      '........',
      '.......#',
    ];
    expect(boardToRows(boardFromRows(rows))).toEqual(rows);
  });
});

describe('placement legality', () => {
  it('rejects anchors that would leave the board', () => {
    expect(maskAt(LINE5_H, 4, 0)).toBeNull();
    expect(maskAt(LINE5_H, 3, 0)).not.toBeNull();
    expect(maskAt(ONE, 8, 0)).toBeNull();
    expect(maskAt(ONE, -1, 0)).toBeNull();
    expect(maskAt(BIG, 6, 6)).toBeNull();
    expect(maskAt(BIG, 5, 5)).not.toBeNull();
  });

  it('rejects overlap and accepts an exact fit', () => {
    const board = boardFromRows([
      '.#......',
      '........',
      '........',
      '........',
      '........',
      '........',
      '........',
      '........',
    ]);
    expect(canPlaceAt(board, DOM_H, 0, 0)).toBe(false);
    expect(canPlaceAt(board, DOM_H, 2, 0)).toBe(true);
    expect(canPlaceAt(board, ONE, 1, 0)).toBe(false);
    expect(canPlaceAt(board, ONE, 0, 0)).toBe(true);
  });

  it('knows when a piece fits nowhere', () => {
    // Alternating filled columns leave no room for a horizontal domino.
    const board = boardFromRows(Array(8).fill('#.#.#.#.'));
    expect(fitsAnywhere(board, DOM_H)).toBe(false);
    expect(fitsAnywhere(board, ONE)).toBe(true);
  });

  it('counts 3x3 anchors on an empty board', () => {
    expect(countPlacements(EMPTY_BOARD, BIG)).toBe(36);
  });
});

describe('clearing', () => {
  it('clears a row and a column simultaneously without double-counting', () => {
    // Row 0 and column 7 are each one cell short — of the same cell.
    const board = boardFromRows([
      '#######.',
      '.......#',
      '.......#',
      '.......#',
      '.......#',
      '.......#',
      '.......#',
      '.......#',
    ]);
    expect(popcount(board)).toBe(14);

    const filled = place(board, maskAt(ONE, 7, 0)!);
    expect(popcount(filled)).toBe(15);

    const lines = fullLines(filled);
    expect(lines.rows).toEqual([0]);
    expect(lines.cols).toEqual([7]);

    // 8 + 8 - 1: the shared cell appears once.
    expect(popcount(lineMask(lines))).toBe(15);
    expect(clearLines(filled, lines)).toBe(EMPTY_BOARD);
  });

  it('leaves everything else exactly where it was — no gravity', () => {
    const board = boardFromRows([
      '..#.....',
      '#######.',
      '....#...',
      '........',
      '........',
      '........',
      '........',
      '........',
    ]);
    const filled = place(board, maskAt(ONE, 7, 1)!);
    const cleared = clearLines(filled, fullLines(filled));
    expect(boardToRows(cleared)).toEqual([
      '..#.....',
      '........',
      '....#...',
      '........',
      '........',
      '........',
      '........',
      '........',
    ]);
  });

  it('finds nothing to clear on a partial board', () => {
    const board = boardFromRows(['#######.', ...Array(7).fill('........')]);
    expect(fullLines(board)).toEqual({ rows: [], cols: [] });
  });
});

describe('precomputed placements', () => {
  it('gives every piece the expected anchor count', () => {
    for (const p of PIECES) {
      const expected = (9 - p.w) * (9 - p.h);
      expect(countPlacements(EMPTY_BOARD, p.id)).toBe(expected);
    }
  });

  it('produces masks whose popcount matches the piece size', () => {
    for (const p of PIECES) {
      const mask = maskAt(p.id, 0, 0)!;
      expect(popcount(mask)).toBe(p.size);
    }
  });
});
