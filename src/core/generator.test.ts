import { describe, expect, it } from 'vitest';
import {
  EMPTY_BOARD,
  boardFromRows,
  canPlaceAt,
  fitsAnywhere,
  fullLines,
  popcount,
  type Board,
} from './board';
import { legalMoves, playOut } from './bot';
import { nextInt } from './rng';
import { createGame, reducer, type GameState } from './game';
import {
  MERCY_FLOOR,
  MERCY_SPAN,
  analyseBoard,
  generateLayout,
  repeatedShapes,
  boardOpenness,
  dealThree,
  dealWeights,
  hasAnyFit,
  isSolvableSequence,
  mercyFor,
} from './generator';
import { PIECES, type PieceId } from './pieces';

const byName = (name: string): PieceId => {
  const p = PIECES.find((piece) => piece.name === name);
  if (!p) throw new Error(`no piece named ${name}`);
  return p.id;
};

const ONE = byName('1x1');
const DOM_H = byName('2x1');
const BIG = byName('3x3');
const SQUARE = byName('2x2');
const LINE3_H = byName('3x1');
const LINE5_H = byName('5x1');
/** The orientation that matches L_HOLE below: two across, one down-left. */
const L_TRI = byName('L3-a');

const CHECKERBOARD = boardFromRows([
  '.#.#.#.#',
  '#.#.#.#.',
  '.#.#.#.#',
  '#.#.#.#.',
  '.#.#.#.#',
  '#.#.#.#.',
  '.#.#.#.#',
  '#.#.#.#.',
]);

const FULL = boardFromRows(Array(8).fill('########'));

describe('mercy and openness', () => {
  it('decays mercy as a run goes on, down to a floor', () => {
    expect(mercyFor(0)).toBe(1);
    expect(mercyFor(MERCY_SPAN / 2)).toBeCloseTo(0.5, 5);
    expect(mercyFor(1_000_000)).toBe(MERCY_FLOOR);
  });

  it('reads an empty board as fully open and a full one as closed', () => {
    expect(boardOpenness(EMPTY_BOARD)).toBe(1);
    expect(boardOpenness(FULL)).toBe(0);
    expect(boardOpenness(CHECKERBOARD)).toBe(0);
  });
});

/**
 * Cramped but not desperate: columns 0–4 are filled down to row 6, leaving an
 * open channel on the right and an open bottom row. No row or column is full.
 */
const CRAMPED = boardFromRows([
  '#####...',
  '#####...',
  '#####...',
  '#####...',
  '#####...',
  '#####...',
  '#####...',
  '........',
]);

/** A 3-cell L-shaped hole tucked into the top-left corner, and little else. */
const L_HOLE = boardFromRows([
  '..#.....',
  '.#......',
  '#.......',
  '........',
  '........',
  '........',
  '........',
  '........',
]);

describe('reading the board', () => {
  it('counts where each piece could actually go', () => {
    const fit = analyseBoard(CHECKERBOARD);
    expect(fit.fits[BIG]).toBe(0);
    expect(fit.fits[DOM_H]).toBe(0);
    expect(fit.fits[ONE]).toBeGreaterThan(0);
  });

  it('spots a piece that would finish a line, and counts a multi-clear', () => {
    // Columns 0-4 are each one cell short along the bottom row, so a 1x1 down
    // there finishes one column — but a 3x1 finishes three at once.
    const fit = analyseBoard(CRAMPED);
    expect(fit.completes[ONE]).toBe(1);
    expect(fit.completes[LINE3_H]).toBe(3);
    expect(fit.completes[LINE5_H]).toBe(5);
  });

  it('rates a piece that matches the shape of a hole as perfectly snug', () => {
    // This is the case that started all this: an L-shaped gap should pull in
    // the L-shaped piece, not just anything small enough to drop in it.
    const fit = analyseBoard(L_HOLE);
    expect(fit.snugness[L_TRI]).toBe(1);
    expect(fit.snugness[SQUARE]).toBeLessThan(1);
    expect(fit.snugness[ONE]).toBeLessThan(1);
  });

  it('gives a dead piece no snugness to trade on', () => {
    expect(analyseBoard(CHECKERBOARD).snugness[BIG]).toBe(0);
  });
});

describe('adaptive weighting', () => {
  it('is exactly the catalogue weights under Fair Deal', () => {
    expect(dealWeights(CHECKERBOARD, 0, true)).toEqual(PIECES.map((p) => p.weight));
  });

  it('leaves an open board alone entirely', () => {
    expect(dealWeights(EMPTY_BOARD, 0, false)).toEqual(PIECES.map((p) => p.weight));
  });

  it('favours longer pieces on a tight board, not shorter ones', () => {
    // The whole point of the rework: a cornered player needs a piece that can
    // finish a line, and a 1x1 never will.
    const w = dealWeights(CRAMPED, 0, false);
    const raw = PIECES.map((p) => p.weight);

    const lift = (i: number): number => w[i]! / raw[i]!;
    expect(lift(LINE5_H)).toBeGreaterThan(lift(ONE));
    expect(lift(LINE3_H)).toBeGreaterThan(lift(ONE));
  });

  it('all but stops dealing a piece with nowhere to go', () => {
    const w = dealWeights(CHECKERBOARD, 0, false);
    const raw = PIECES.map((p) => p.weight);
    expect(w[BIG]! / raw[BIG]!).toBeLessThan(0.05);
    expect(w[DOM_H]! / raw[DOM_H]!).toBeLessThan(0.05);
  });

  it('prefers the piece that fits the hole to the one that merely fits', () => {
    const w = dealWeights(L_HOLE, 0, false);
    const raw = PIECES.map((p) => p.weight);
    expect(w[L_TRI]! / raw[L_TRI]!).toBeGreaterThan(w[ONE]! / raw[ONE]!);
  });

  it('pays out hard when a big combination is set up', () => {
    // Rows 5, 6 and 7 are complete except a 3x3 corner. A player who builds
    // this deserves the 3x3 that cashes all three rows at once — and this is
    // the only way big combinations can happen, since the generator can supply
    // the finisher but never the setup.
    const primed = boardFromRows([
      '........',
      '........',
      '........',
      '........',
      '........',
      '#####...',
      '#####...',
      '#####...',
    ]);

    const fit = analyseBoard(primed);
    expect(fit.completes[BIG]).toBe(3);

    const w = dealWeights(primed, 0, false);
    const raw = PIECES.map((p) => p.weight);
    const lift = (i: number): number => w[i]! / raw[i]!;

    // The 3x3 is the rarest piece in the bag; on this board it should be the
    // one being pushed hardest, well past a piece that only takes one line.
    expect(lift(BIG)).toBeGreaterThan(3);
    expect(lift(BIG)).toBeGreaterThan(lift(ONE) * 3);
  });

  it('still pays more for a multi-line finisher than a single', () => {
    // Single-line finishers are deliberately well supplied — that's what keeps
    // clears frequent. The invariant that has to survive is the *ordering*: a
    // piece that takes several lines at once must always be wanted more than
    // one that takes a single.
    const primed = boardFromRows([
      '........',
      '........',
      '........',
      '........',
      '........',
      '#####...',
      '#####...',
      '#####...',
    ]);
    const fit = analyseBoard(primed);
    const w = dealWeights(primed, 0, false);
    const raw = PIECES.map((p) => p.weight);

    expect(fit.completes[BIG]).toBe(3);
    expect(fit.completes[ONE]).toBeLessThanOrEqual(1);
    expect(w[BIG]! / raw[BIG]!).toBeGreaterThan(w[ONE]! / raw[ONE]!);
  });

  it('flattens back toward the raw weights as mercy decays', () => {
    const raw = PIECES.map((p) => p.weight);
    const rawRatio = raw[LINE5_H]! / raw[ONE]!;
    const ratio = (w: number[]): number => w[LINE5_H]! / w[ONE]!;

    const early = Math.abs(ratio(dealWeights(CRAMPED, 0, false)) - rawRatio);
    const late = Math.abs(ratio(dealWeights(CRAMPED, 1_000_000, false)) - rawRatio);
    expect(late).toBeLessThan(early);
  });
});

describe('anti-repetition', () => {
  it('flags nothing until two deals are on record', () => {
    expect(repeatedShapes([]).size).toBe(0);
    expect(repeatedShapes([ONE, DOM_H, BIG]).size).toBe(0);
  });

  it('flags a shape that turned up in both of the last two deals', () => {
    const repeated = repeatedShapes([ONE, DOM_H, BIG, ONE, ONE, DOM_H]);
    expect([...repeated].sort()).toEqual([ONE, DOM_H].sort());
  });

  it('damps a repeated shape rather than making it unobtainable', () => {
    // A hard ban meant the one shape you were saving a gap for could be the
    // one shape the generator refused to hand over.
    let seen = false;
    let state = 1;
    for (let i = 0; i < 300 && !seen; i++) {
      const result = dealThree(
        {
          board: EMPTY_BOARD,
          nook: null,
          recentShapes: [SQUARE, DOM_H, BIG, SQUARE, SQUARE, DOM_H],
          progress: 0,
          dealsSinceCombo: 0,
          fairDeal: false,
        },
        state,
      );
      state = result.rngState;
      if (result.pieces.includes(SQUARE)) seen = true;
    }
    expect(seen).toBe(true);
  });

  it('never deals three of a kind', () => {
    let state = createGame({ seed: 5 });
    for (let i = 0; i < 400; i++) {
      const ids = state.tray.map((s) => s?.piece);
      expect(new Set(ids).size).toBeGreaterThan(1);
      state = advanceOneDeal(state);
      if (state.status === 'over') state = createGame({ seed: i + 100 });
    }
  });
});

describe('solvability search', () => {
  it('accepts three pieces on an empty board', () => {
    expect(isSolvableSequence(EMPTY_BOARD, [BIG, BIG, BIG])).toBe(true);
  });

  it('rejects a hand that cannot be placed at all', () => {
    expect(isSolvableSequence(CHECKERBOARD, [DOM_H, DOM_H, DOM_H])).toBe(false);
  });

  it('rejects a hand only partly placeable', () => {
    // One 1x1 fits, the dominoes never do.
    expect(isSolvableSequence(CHECKERBOARD, [ONE, DOM_H, ONE])).toBe(false);
    expect(isSolvableSequence(CHECKERBOARD, [ONE, ONE, ONE])).toBe(true);
  });

  it('accounts for lines opening up mid-sequence', () => {
    // Row 0 is one cell from full; every other row is a checkerboard, so no
    // two empties are adjacent and a 2x1 fits nowhere. Placing a piece only
    // ever fills cells, so the *only* way the 2x1 becomes placeable is the 1x1
    // landing on (7, 0) and clearing row 0. If the search did not simulate
    // clears between placements this would be false.
    const clearable = boardFromRows([
      '#######.',
      '#.#.#.#.',
      '.#.#.#.#',
      '#.#.#.#.',
      '.#.#.#.#',
      '#.#.#.#.',
      '.#.#.#.#',
      '#.#.#.#.',
    ]);
    expect(isSolvableSequence(clearable, [DOM_H, ONE, ONE])).toBe(true);

    // Same shape of hand, but no row or column is ever one cell from full, so
    // nothing can open up and the 2x1 stays homeless.
    expect(isSolvableSequence(CHECKERBOARD, [DOM_H, ONE, ONE])).toBe(false);
  });

  it('is monotone in the Nook: holding a piece never removes solutions', () => {
    let state = createGame({ seed: 808 });
    for (let i = 0; i < 120; i++) {
      const ids = state.tray.flatMap((s) => (s ? [s.piece] : []));
      if (ids.length === 3) {
        const without = isSolvableSequence(state.board, ids, null);
        if (without) {
          expect(isSolvableSequence(state.board, ids, ONE)).toBe(true);
        }
      }
      state = advanceOneDeal(state);
      if (state.status === 'over') state = createGame({ seed: i + 900 });
    }
  });
});

describe('generated layouts', () => {
  it('is a pure function of the seed', () => {
    const a = generateLayout(1234, 14);
    const b = generateLayout(1234, 14);
    expect(a.board).toBe(b.board);
    expect(generateLayout(1235, 14).board).not.toBe(a.board);
  });

  it('never starts with a line already complete', () => {
    for (let seed = 0; seed < 400; seed++) {
      const { board } = generateLayout(seed, 14);
      expect(fullLines(board)).toEqual({ rows: [], cols: [] });
    }
  });

  it('fills roughly the requested amount and leaves plenty of room', () => {
    for (let seed = 0; seed < 200; seed++) {
      const { board } = generateLayout(seed, 14);
      const filled = popcount(board);
      expect(filled).toBeGreaterThan(4);
      expect(filled).toBeLessThanOrEqual(14);
      // Still a comfortable board to open on, for every single day.
      expect(boardOpenness(board)).toBeGreaterThanOrEqual(0.32);
    }
  });

  it('colours every filled cell and nothing else', () => {
    for (let seed = 0; seed < 100; seed++) {
      const { board, colors } = generateLayout(seed, 14);
      for (let cell = 0; cell < 64; cell++) {
        const filled = (board & (1n << BigInt(cell))) !== 0n;
        expect(colors[cell]! > 0).toBe(filled);
      }
    }
  });

  it('gives a daily game a board to open on, and endless an empty one', () => {
    expect(createGame({ seed: 99, layoutCells: 14 }).board).not.toBe(EMPTY_BOARD);
    expect(createGame({ seed: 99 }).board).toBe(EMPTY_BOARD);
  });
});

describe('guaranteed fit', () => {
  it('always deals something placeable when anything is placeable', () => {
    const seen = observeDeals(GAMES);
    expect(seen.deals).toBeGreaterThan(GAMES * 2);
    expect(seen.unfittableDeals).toBe(0);
  });

  it('repairs a hand even when the board is desperately tight', () => {
    // Only a 1x1 fits, and 1x1 is the rarest piece in the bag — random redraws
    // alone would miss it often enough to matter.
    for (let seed = 0; seed < 200; seed++) {
      const result = dealThree(
        {
          board: CHECKERBOARD,
          nook: null,
          recentShapes: [],
          progress: 0,
          dealsSinceCombo: 0,
          fairDeal: false,
        },
        seed,
      );
      expect(hasAnyFit(CHECKERBOARD, result.pieces)).toBe(true);
    }
  });

  it('gives up gracefully on a board where nothing at all fits', () => {
    const result = dealThree(
      {
        board: FULL,
        nook: null,
        recentShapes: [],
        progress: 0,
        dealsSinceCombo: 0,
        fairDeal: false,
      },
      1,
    );
    expect(result.pieces).toHaveLength(3);
    expect(hasAnyFit(FULL, result.pieces)).toBe(false);
  });
});

describe('generator fuzz', () => {
  // These are regression tripwires, not a quality bar — the bot plays
  // uniformly at random and never plans. The histogram is the actual output:
  // tune the weights and the mercy curve from it rather than by feel.
  it('produces a sane score and run-length distribution', () => {
    const stats = fuzz(GAMES, false);
    // eslint-disable-next-line no-console
    console.log(`adaptive (${GAMES} games)`, stats.summary);

    expect(stats.moves.p50).toBeGreaterThan(12);
    expect(stats.scores.p50).toBeGreaterThan(50);
    expect(stats.moves.p10).toBeGreaterThan(6);
  });

  it('scores and lasts better than Fair Deal, which is the point of mercy', () => {
    const adaptive = fuzz(GAMES, false);
    const fair = fuzz(GAMES, true);
    // eslint-disable-next-line no-console
    console.log(`fair (${GAMES} games)`, fair.summary);

    // Score is where the board-aware weighting really shows: it hands out
    // pieces that finish lines, and lines are most of the points.
    expect(adaptive.scores.p50).toBeGreaterThan(fair.scores.p50 * 1.2);
    expect(adaptive.scores.p90).toBeGreaterThan(fair.scores.p90 * 1.2);

    // Deliberately *not* asserting median run length. The bot places at
    // random, so it squanders the longer pieces this weighting deals it, and
    // its median survival comes out level with raw weights. The long tail —
    // the runs where the random placements happened to be sane — is where the
    // difference shows, and that is the half a real player lives in.
    expect(adaptive.moves.p90).toBeGreaterThan(fair.moves.p90);
    expect(adaptive.moves.p99).toBeGreaterThan(fair.moves.p99);
  });
});

// --- helpers ---------------------------------------------------------------

/**
 * Kept modest so `npm test` stays snappy; `npm run test:fuzz` runs the full
 * ten thousand games the histogram is really meant to be read from.
 */
const GAMES = Number(process.env['NOOK_FUZZ_GAMES'] ?? 1500);

interface Spread {
  min: number;
  p10: number;
  p50: number;
  p90: number;
  p99: number;
  max: number;
}

function spread(values: number[]): Spread {
  const s = [...values].sort((a, b) => a - b);
  const at = (p: number): number =>
    s[Math.min(s.length - 1, Math.floor(p * s.length))]!;
  return {
    min: s[0]!,
    p10: at(0.1),
    p50: at(0.5),
    p90: at(0.9),
    p99: at(0.99),
    max: s[s.length - 1]!,
  };
}

function fuzz(
  games: number,
  fairDeal: boolean,
): { moves: Spread; scores: Spread; summary: string } {
  const scores: number[] = [];
  const lengths: number[] = [];

  for (let seed = 0; seed < games; seed++) {
    const result = playOut(createGame({ seed, fairDeal }), seed * 40503 + 7);
    scores.push(result.state.score);
    lengths.push(result.moves);
  }

  const moves = spread(lengths);
  const scoreSpread = spread(scores);
  return {
    moves,
    scores: scoreSpread,
    summary:
      `moves p10/p50/p90/p99 ${moves.p10}/${moves.p50}/${moves.p90}/${moves.p99} · ` +
      `score p10/p50/p90/p99 ${scoreSpread.p10}/${scoreSpread.p50}/${scoreSpread.p90}/${scoreSpread.p99}`,
  };
}

/** Place every tray piece at its first legal anchor, forcing a fresh deal. */
function advanceOneDeal(state: GameState): GameState {
  let s = state;
  const startedAt = s.dealCount;
  let guard = 0;
  while (s.status === 'playing' && s.dealCount === startedAt && guard++ < 12) {
    const index = s.tray.findIndex(Boolean);
    if (index < 0) break;
    const move = firstAnchor(s.board, s.tray[index]!.piece);
    if (!move) break;
    s = reducer(s, { type: 'place', source: 'tray', index, ...move });
  }
  return s;
}

function firstAnchor(
  board: Board,
  piece: PieceId,
): { x: number; y: number } | null {
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      if (canPlaceAt(board, piece, x, y)) return { x, y };
    }
  }
  return null;
}

/**
 * Play `games` bot games, checking the guaranteed-fit rule at every deal: if
 * *anything* in the catalogue fits, at least one dealt piece must fit.
 */
function observeDeals(games: number): { deals: number; unfittableDeals: number } {
  let deals = 0;
  let unfittableDeals = 0;

  const check = (state: GameState): void => {
    deals++;
    const ids = state.tray.flatMap((s) => (s ? [s.piece] : []));
    const anythingFits = PIECES.some((p) => fitsAnywhere(state.board, p.id));
    if (anythingFits && !hasAnyFit(state.board, ids)) unfittableDeals++;
  };

  for (let seed = 0; seed < games; seed++) {
    let state = createGame({ seed });
    let rng = (seed * 40503 + 7) >>> 0;
    check(state);

    while (state.status === 'playing') {
      const moves = legalMoves(state);
      if (moves.length === 0) break;
      const [i, next] = nextInt(rng, moves.length);
      rng = next;

      const before = state.dealCount;
      state = reducer(state, moves[i]!);
      if (state.dealCount !== before) check(state);
    }
  }

  return { deals, unfittableDeals };
}
