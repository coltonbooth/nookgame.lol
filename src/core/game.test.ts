import { describe, expect, it } from 'vitest';
import { CELLS, EMPTY_BOARD, bit, boardFromRows, isFilled, popcount } from './board';
import { endedFairly, playOut, playOutGreedy } from './bot';
import {
  EMPTY_STATS,
  MARKER_ONE_IN,
  NO_MARKER,
  type MarkerKind,
  anyLegalMove,
  createGame,
  markerAt,
  KEY_LINES,
  preview,
  reducer,
  replay,
  serialize,
  slotFits,
  type Action,
  type GameState,
  type Slot,
} from './game';
import { PIECES, type PieceId } from './pieces';
import { JACKPOT_FULL, JACKPOT_PAYOUT, STAR_BONUS } from './scoring';

const byName = (name: string): PieceId => {
  const p = PIECES.find((piece) => piece.name === name);
  if (!p) throw new Error(`no piece named ${name}`);
  return p.id;
};

const ONE = byName('1x1');
const DOM_H = byName('2x1');
const DOM_V = byName('1x2');
const BIG = byName('3x3');

const slot = (
  piece: PieceId,
  color = 1,
  marker = NO_MARKER,
  markerKind: MarkerKind = 'gem',
): Slot => ({ piece, color, marker, markerKind });

/** Skip the gem hunt when a test is about something else. */
const unlocked = (state: GameState): GameState => ({
  ...state,
  nookUnlocked: true,
});

// Defaults to an unlocked Nook so the mechanics tests below stay about the
// mechanics; the locking rules get their own section.
function makeState(overrides: Partial<GameState> = {}): GameState {
  return {
    board: EMPTY_BOARD,
    stats: EMPTY_STATS,
    colors: new Uint8Array(CELLS),
    gems: EMPTY_BOARD,
    stars: EMPTY_BOARD,
    charges: EMPTY_BOARD,
    markerPolicy: 'progression',
    markerOneIn: MARKER_ONE_IN,
    tray: [null, null, null],
    nook: null,
    nookUnlocked: true,
    swapUsed: false,
    score: 0,
    run: 0,
    runGrace: 0,
    jackpot: 0,
    keys: 0,
    keyEvent: null,
    status: 'playing',
    rngState: 1,
    dealCount: 1,
    recentShapes: [],
    fairDeal: false,
    mutator: null,
    lastEvent: null,
    ...overrides,
  };
}

/** Empties where (x + y) is even: never two orthogonally adjacent, so only a
 *  1×1 fits — and no row or column is full or one cell from full. */
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

describe('createGame', () => {
  it('deals three pieces and starts empty', () => {
    const g = createGame({ seed: 1234 });
    expect(g.board).toBe(EMPTY_BOARD);
    expect(g.tray.filter(Boolean)).toHaveLength(3);
    expect(g.nook).toBeNull();
    expect(g.score).toBe(0);
    expect(g.run).toBe(0);
    expect(g.status).toBe('playing');
    expect(g.dealCount).toBe(1);
  });

  it('is a pure function of the seed', () => {
    expect(serialize(createGame({ seed: 99 }))).toBe(
      serialize(createGame({ seed: 99 })),
    );
    expect(serialize(createGame({ seed: 99 }))).not.toBe(
      serialize(createGame({ seed: 100 })),
    );
  });
});

describe('illegal actions', () => {
  const base = makeState({ tray: [slot(ONE), slot(DOM_H), null] });

  it('are no-ops rather than throwing', () => {
    const cases: Action[] = [
      { type: 'place', source: 'tray', index: 2, x: 0, y: 0 }, // empty slot
      { type: 'place', source: 'nook', index: 0, x: 0, y: 0 }, // empty nook
      { type: 'place', source: 'tray', index: 0, x: 8, y: 0 }, // off-board
      { type: 'place', source: 'tray', index: 1, x: 7, y: 0 }, // 2x1 overhangs
      { type: 'stash', index: 2 }, // nothing to stash
    ];
    for (const action of cases) expect(reducer(base, action)).toBe(base);
  });

  it('ignores everything once the run is over', () => {
    const over = makeState({ status: 'over', tray: [slot(ONE), null, null] });
    expect(
      reducer(over, { type: 'place', source: 'tray', index: 0, x: 0, y: 0 }),
    ).toBe(over);
  });

  it('refuses to place onto an occupied cell', () => {
    const s = makeState({
      board: boardFromRows(['#.......', ...Array(7).fill('........')]),
      tray: [slot(ONE), null, null],
    });
    expect(
      reducer(s, { type: 'place', source: 'tray', index: 0, x: 0, y: 0 }),
    ).toBe(s);
  });
});

describe('placing and scoring', () => {
  it('scores one point per cell when nothing clears', () => {
    const s = makeState({ tray: [slot(BIG), slot(ONE), slot(ONE)] });
    const next = reducer(s, { type: 'place', source: 'tray', index: 0, x: 0, y: 0 });
    expect(next.score).toBe(9);
    expect(next.run).toBe(0);
    expect(popcount(next.board)).toBe(9);
    expect(next.tray[0]).toBeNull();
  });

  it('clears an intersecting row and column at once and sweeps clean', () => {
    const s = makeState({
      // Row 0 and column 7 are each one short — of the same cell.
      board: boardFromRows([
        '#######.',
        '.......#',
        '.......#',
        '.......#',
        '.......#',
        '.......#',
        '.......#',
        '.......#',
      ]),
      tray: [slot(ONE), slot(DOM_H), slot(DOM_H)],
    });

    const next = reducer(s, { type: 'place', source: 'tray', index: 0, x: 7, y: 0 });

    expect(next.board).toBe(EMPTY_BOARD);
    expect(next.lastEvent?.clearedRows).toEqual([0]);
    expect(next.lastEvent?.clearedCols).toEqual([7]);
    expect(next.lastEvent?.sweptClean).toBe(true);
    // 1 cell + a 2-line bonus of 60 at x2 (the first clear of a run pays).
    expect(next.score).toBe(1 + 60 * 2);
    expect(next.run).toBe(1);
    expect(Array.from(next.colors).every((c) => c === 0)).toBe(true);
  });

  it('decays the run on a placement that clears nothing', () => {
    const s = makeState({ run: 4, tray: [slot(ONE), slot(ONE), slot(ONE)] });
    const next = reducer(s, { type: 'place', source: 'tray', index: 0, x: 3, y: 3 });
    expect(next.run).toBe(3);

    // And it bottoms out rather than going negative.
    const cold = makeState({ run: 0, tray: [slot(ONE), null, null] });
    expect(
      reducer(cold, { type: 'place', source: 'tray', index: 0, x: 3, y: 3 }).run,
    ).toBe(0);
  });

  it('paints the placed cells with the slot colour and clears them again', () => {
    const s = makeState({ tray: [slot(DOM_H, 3), slot(ONE), slot(ONE)] });
    const next = reducer(s, { type: 'place', source: 'tray', index: 0, x: 2, y: 5 });
    expect(next.colors[5 * 8 + 2]).toBe(3);
    expect(next.colors[5 * 8 + 3]).toBe(3);
    expect(next.colors[0]).toBe(0);
  });
});

describe('dealing', () => {
  it('deals only when all three tray slots are empty', () => {
    let g = createGame({ seed: 7 });
    expect(g.dealCount).toBe(1);

    for (let i = 0; i < 3; i++) {
      const move = firstLegalMove(g, i);
      g = reducer(g, move);
      expect(g.dealCount).toBe(i === 2 ? 2 : 1);
    }
    expect(g.tray.filter(Boolean)).toHaveLength(3);
  });

  it('does not let a piece in the Nook block the next deal', () => {
    let g = unlocked(createGame({ seed: 21 }));
    g = reducer(g, { type: 'stash', index: 0 });
    g = reducer(g, firstLegalMove(g, 1));
    g = reducer(g, firstLegalMove(g, 2));
    expect(g.dealCount).toBe(2);
    expect(g.nook).not.toBeNull();
  });
});

describe('the Nook', () => {
  it('stashes into an empty Nook for free', () => {
    const s = makeState({ tray: [slot(ONE), slot(DOM_H), slot(BIG)] });
    const next = reducer(s, { type: 'stash', index: 0 });
    expect(next.nook).toEqual(slot(ONE));
    expect(next.tray[0]).toBeNull();
    expect(next.swapUsed).toBe(false);
  });

  it('ejects the stored piece back to the tray and spends the swap', () => {
    const s = makeState({
      tray: [slot(ONE), slot(DOM_H), slot(BIG)],
      nook: slot(DOM_V),
    });
    const next = reducer(s, { type: 'stash', index: 0 });
    expect(next.nook).toEqual(slot(ONE));
    expect(next.tray[0]).toEqual(slot(DOM_V));
    expect(next.swapUsed).toBe(true);
  });

  it('allows only one swap per deal', () => {
    const s = makeState({
      tray: [slot(ONE), slot(DOM_H), slot(BIG)],
      nook: slot(DOM_V),
      swapUsed: true,
    });
    expect(reducer(s, { type: 'stash', index: 1 })).toBe(s);
  });

  it('restores the swap when a new deal arrives', () => {
    let g = unlocked(createGame({ seed: 33 }));
    g = reducer(g, { type: 'stash', index: 0 });
    g = reducer(g, { type: 'stash', index: 1 });
    expect(g.swapUsed).toBe(true);

    // Emptying the tray triggers a deal, and the deal restores the swap.
    const dealtAt = g.dealCount;
    while (g.dealCount === dealtAt) {
      g = reducer(g, firstLegalMove(g, g.tray.findIndex((s) => s !== null)));
    }
    expect(g.swapUsed).toBe(false);
  });

  it('places straight out of the Nook', () => {
    const s = makeState({ tray: [null, slot(DOM_H), null], nook: slot(BIG) });
    const next = reducer(s, { type: 'place', source: 'nook', index: 0, x: 1, y: 1 });
    expect(next.nook).toBeNull();
    expect(next.score).toBe(9);
    expect(popcount(next.board)).toBe(9);
  });
});

describe('gems and earning the Nook', () => {
  /** Row 0 one cell short at (7,0), and a gem waiting in that row. */
  const nearlyFull = (gemColumn: number): GameState =>
    makeState({
      board: boardFromRows(['#######.', ...Array(7).fill('........')]),
      gems: bit(gemColumn, 0),
      nookUnlocked: false,
      tray: [slot(ONE), slot(DOM_H), slot(DOM_H)],
    });

  it('starts every run sealed, with no gems on the board', () => {
    const g = createGame({ seed: 4 });
    expect(g.nookUnlocked).toBe(false);
    expect(g.gems).toBe(EMPTY_BOARD);
    expect(g.stars).toBe(EMPTY_BOARD);
  });

  it('refuses to stash while sealed', () => {
    const s = makeState({
      nookUnlocked: false,
      tray: [slot(ONE), slot(DOM_H), slot(BIG)],
    });
    expect(reducer(s, { type: 'stash', index: 0 })).toBe(s);
    expect(anyLegalMove(s)).toBe(true);
  });

  it('lays a gem onto the board with the cell that carries it', () => {
    // Gem on cell 1 of a 2x1, so it lands on the right-hand cell.
    const s = makeState({
      nookUnlocked: false,
      tray: [slot(DOM_H, 1, 1), null, null],
    });
    const next = reducer(s, { type: 'place', source: 'tray', index: 0, x: 3, y: 4 });
    expect(markerAt(next, 3, 4)).toBeNull();
    expect(markerAt(next, 4, 4)).toBe('gem');
    expect(next.nookUnlocked).toBe(false);
  });

  it('opens the Nook when a cleared line runs through a gem', () => {
    const s = nearlyFull(2);
    const next = reducer(s, { type: 'place', source: 'tray', index: 0, x: 7, y: 0 });

    expect(next.lastEvent?.clearedRows).toEqual([0]);
    expect(next.lastEvent?.gemsCleared).toBe(1);
    expect(next.lastEvent?.unlockedNook).toBe(true);
    expect(next.nookUnlocked).toBe(true);
    // Gems have done their job; none are left to confuse anyone.
    expect(next.gems).toBe(EMPTY_BOARD);
  });

  it('stays sealed when the cleared line misses the gem', () => {
    // Gem parked on row 4, well clear of the row 0 that clears.
    const s = makeState({
      ...nearlyFull(2),
      gems: bit(2, 4),
      board: boardFromRows([
        '#######.',
        '........',
        '........',
        '........',
        '..#.....',
        '........',
        '........',
        '........',
      ]),
    });
    const next = reducer(s, { type: 'place', source: 'tray', index: 0, x: 7, y: 0 });

    expect(next.lastEvent?.clearedRows).toEqual([0]);
    expect(next.lastEvent?.gemsCleared).toBe(0);
    expect(next.nookUnlocked).toBe(false);
    expect(markerAt(next, 2, 4)).toBe('gem'); // still waiting
  });

  it('lets the piece be stashed the moment it is unlocked', () => {
    let g = nearlyFull(2);
    g = reducer(g, { type: 'place', source: 'tray', index: 0, x: 7, y: 0 });
    expect(g.nookUnlocked).toBe(true);

    g = reducer(g, { type: 'stash', index: 1 });
    expect(g.nook).toEqual(slot(DOM_H));
  });

  it('keeps dealing markers once the Nook is open — never gems again', () => {
    let dealt = 0;
    let marked = 0;
    const kinds = new Set<string>();

    for (let seed = 0; seed < 60; seed++) {
      // Empty the tray of an already-unlocked game to force a fresh deal.
      let g = unlocked(createGame({ seed }));
      const dealtAt = g.dealCount;
      while (g.status === 'playing' && g.dealCount === dealtAt) {
        g = reducer(g, firstLegalMove(g, g.tray.findIndex((s) => s !== null)));
      }
      for (const s of g.tray) {
        if (!s) continue;
        dealt++;
        if (s.marker !== NO_MARKER) {
          marked++;
          kinds.add(s.markerKind);
          // Under 'progression', an open Nook means the gem's work is done:
          // from here it is stars for score and the occasional charge.
          expect(s.markerKind).not.toBe('gem');
        }
      }
    }

    // Both post-unlock kinds should actually turn up over sixty runs.
    expect(kinds).toEqual(new Set(['star', 'charge']));
    expect(dealt).toBeGreaterThan(100);
    expect(marked).toBeGreaterThan(0);
  });

  it('calls markers gems while sealed and stars once open', () => {
    expect(createGame({ seed: 1 }).nookUnlocked).toBe(false);
    expect(unlocked(createGame({ seed: 1 })).nookUnlocked).toBe(true);
  });

  it('deals gems at roughly the advertised rate', () => {
    let pieces = 0;
    let gems = 0;
    for (let seed = 0; seed < 400; seed++) {
      for (const s of createGame({ seed }).tray) {
        pieces++;
        if (s && s.marker !== NO_MARKER) gems++;
      }
    }
    // One in twelve, with room for sampling noise.
    expect(gems / pieces).toBeGreaterThan(0.04);
    expect(gems / pieces).toBeLessThan(0.14);
  });

  it('gems only ever sit on filled cells', () => {
    for (let seed = 0; seed < 40; seed++) {
      const result = playOut(createGame({ seed }), seed * 7919 + 3);
      expect((result.state.gems | result.state.stars) & ~result.state.board).toBe(0n);
    }
  });

  it('is reachable — most runs earn the Nook', () => {
    let earned = 0;
    const games = 300;
    for (let seed = 0; seed < games; seed++) {
      if (playOut(createGame({ seed }), seed * 40503 + 7).state.nookUnlocked) {
        earned++;
      }
    }
    // A bot playing at random, so a human should do better than this. If it
    // ever collapses toward zero the rate or the unlock rule has broken.
    expect(earned / games).toBeGreaterThan(0.25);
    expect(earned / games).toBeLessThan(0.98);
  });
});

describe('stars', () => {
  /** Row 0 one cell short at (7,0), Nook already open, star waiting in the row. */
  const withStar = (run = 0): GameState =>
    makeState({
      board: boardFromRows(['#######.', ...Array(7).fill('........')]),
      stars: bit(2, 0),
      nookUnlocked: true,
      run,
      tray: [slot(ONE), slot(DOM_H), slot(DOM_H)],
    });

  it('pays the star bonus when a cleared line runs through one', () => {
    const next = reducer(withStar(), {
      type: 'place',
      source: 'tray',
      index: 0,
      x: 7,
      y: 0,
    });

    // 1 cell + (20 line bonus + star) x2 for the first clear of a run.
    expect(next.score).toBe(1 + (20 + STAR_BONUS) * 2);
    expect(next.lastEvent?.starsCleared).toBe(1);
    expect(next.lastEvent?.starBonus).toBe(STAR_BONUS);
    expect(next.lastEvent?.unlockedNook).toBe(false);
    expect(next.stars).toBe(EMPTY_BOARD);
  });

  it('rides the run multiplier, which is the reason to hold one back', () => {
    // run 4 before this placement -> 5 after -> x6.
    const next = reducer(withStar(4), {
      type: 'place',
      source: 'tray',
      index: 0,
      x: 7,
      y: 0,
    });
    expect(next.lastEvent?.multiplier).toBe(6);
    expect(next.score).toBe(1 + (20 + STAR_BONUS) * 6);
  });

  it('pays nothing for the gem that opens the Nook', () => {
    const sealed = makeState({
      board: boardFromRows(['#######.', ...Array(7).fill('........')]),
      gems: bit(2, 0),
      nookUnlocked: false,
      tray: [slot(ONE), slot(DOM_H), slot(DOM_H)],
    });
    const next = reducer(sealed, { type: 'place', source: 'tray', index: 0, x: 7, y: 0 });

    expect(next.lastEvent?.unlockedNook).toBe(true);
    expect(next.lastEvent?.starBonus).toBe(0);
    expect(next.score).toBe(1 + 20 * 2); // the line bonus alone
  });

  it('counts a star the placed piece brings with it', () => {
    // The 1x1 carries the star on its only cell, and lands on the row it clears.
    const s = makeState({
      board: boardFromRows(['#######.', ...Array(7).fill('........')]),
      nookUnlocked: true,
      tray: [slot(ONE, 1, 0, 'star'), null, null],
    });
    const next = reducer(s, { type: 'place', source: 'tray', index: 0, x: 7, y: 0 });
    expect(next.lastEvent?.starsCleared).toBe(1);
    expect(next.lastEvent?.starBonus).toBe(STAR_BONUS);
  });

  it('shows the same number in the preview as it scores', () => {
    const s = withStar(2);
    const p = preview(s, 'tray', 0, 7, 0);
    expect(p.markersCleared).toBe(1);
    expect(p.wouldUnlock).toBe(false);

    const next = reducer(s, { type: 'place', source: 'tray', index: 0, x: 7, y: 0 });
    expect(next.score).toBe(p.gained);
  });

  it('flags the unlock in the preview while still sealed', () => {
    const sealed = makeState({
      board: boardFromRows(['#######.', ...Array(7).fill('........')]),
      gems: bit(2, 0),
      nookUnlocked: false,
      tray: [slot(ONE), null, null],
    });
    expect(preview(sealed, 'tray', 0, 7, 0).wouldUnlock).toBe(true);
    expect(preview(sealed, 'tray', 0, 0, 0).wouldUnlock).toBe(false);
  });
});

describe('nowhere left to put it', () => {
  it('keeps playing when the only piece that fits is in the Nook', () => {
    const withNook = makeState({
      board: CHECKERBOARD,
      tray: [null, null, slot(DOM_H)],
      nook: slot(ONE),
    });
    expect(anyLegalMove(withNook)).toBe(true);

    const withoutNook = makeState({ ...withNook, nook: null });
    expect(anyLegalMove(withoutNook)).toBe(false);
  });

  it('ends only once the Nook piece is spent', () => {
    const s = makeState({
      board: CHECKERBOARD,
      tray: [null, null, slot(DOM_H)],
      nook: slot(ONE),
    });
    const next = reducer(s, { type: 'place', source: 'nook', index: 0, x: 0, y: 0 });
    expect(next.lastEvent?.clearedRows).toEqual([]);
    expect(next.nook).toBeNull();
    expect(next.status).toBe('over');
    expect(next.dealCount).toBe(1); // tray was never empty, so no deal
  });

  it('marks individual dead pieces, which is what drives the tray fade', () => {
    const s = makeState({
      board: CHECKERBOARD,
      tray: [slot(ONE), slot(DOM_H), null],
      nook: slot(BIG),
    });
    expect(slotFits(s, s.tray[0]!)).toBe(true); // 1x1 still has homes
    expect(slotFits(s, s.tray[1]!)).toBe(false); // no two adjacent empties
    expect(slotFits(s, s.nook)).toBe(false);
    expect(slotFits(s, null)).toBe(false);
  });

  it('never reports over while a legal move remains', () => {
    for (let seed = 0; seed < 60; seed++) {
      const result = playOut(createGame({ seed }), seed * 7919 + 1);
      expect(endedFairly(result.state)).toBe(true);
      expect(result.state.status).toBe('over');
    }
  });
});

describe('preview', () => {
  it('reports the lines a placement would clear and what it would score', () => {
    const s = makeState({
      board: boardFromRows(['#######.', ...Array(7).fill('........')]),
      tray: [slot(ONE), null, null],
      run: 2,
    });

    const p = preview(s, 'tray', 0, 7, 0);
    expect(p.legal).toBe(true);
    expect(p.lines.rows).toEqual([0]);
    expect(p.lines.cols).toEqual([]);
    expect(p.multiplier).toBe(4); // run would become 3
    expect(p.gained).toBe(1 + 20 * 4);

    expect(preview(s, 'tray', 0, 0, 0).legal).toBe(false);
    expect(preview(s, 'nook', 0, 7, 0).legal).toBe(false);
  });

  it('does not mutate the state it inspects', () => {
    const s = makeState({ tray: [slot(BIG), null, null] });
    const before = serialize(s);
    preview(s, 'tray', 0, 0, 0);
    expect(serialize(s)).toBe(before);
  });

  it('warns that a placement would fill the jackpot meter', () => {
    const nearly = makeState({
      board: boardFromRows(['#######.', ...Array(7).fill('........')]),
      tray: [slot(ONE), null, null],
      jackpot: JACKPOT_FULL - 1,
    });
    expect(preview(nearly, 'tray', 0, 7, 0).wouldJackpot).toBe(true);

    const cold = makeState({
      board: boardFromRows(['#######.', ...Array(7).fill('........')]),
      tray: [slot(ONE), null, null],
      jackpot: 0,
    });
    expect(preview(cold, 'tray', 0, 7, 0).wouldJackpot).toBe(false);
  });
});

describe('the jackpot meter', () => {
  /** A board one cell short of clearing row 0, with a 1x1 in hand. */
  const oneAway = (overrides: Partial<GameState> = {}): GameState =>
    makeState({
      board: boardFromRows(['#######.', ...Array(7).fill('........')]),
      tray: [slot(ONE), slot(DOM_H), slot(DOM_H)],
      ...overrides,
    });

  const drop = (s: GameState): GameState =>
    reducer(s, { type: 'place', source: 'tray', index: 0, x: 7, y: 0 });

  it('banks a line per clear without paying out', () => {
    const next = drop(oneAway({ jackpot: 3 }));
    expect(next.jackpot).toBe(4);
    expect(next.lastEvent?.jackpot).toBe(false);
    expect(next.lastEvent?.jackpotBonus).toBe(0);
    expect(next.stats.jackpots).toBe(0);
  });

  it('pays out and resets on the placement that fills it', () => {
    const next = drop(oneAway({ jackpot: JACKPOT_FULL - 1 }));
    expect(next.lastEvent?.jackpot).toBe(true);
    expect(next.jackpot).toBe(0);
    expect(next.stats.jackpots).toBe(1);
    // 1 cell + a 20 line bonus at x2, plus the payout at the same x2.
    expect(next.lastEvent?.jackpotBonus).toBe(JACKPOT_PAYOUT * 2);
    expect(next.score).toBe(1 + 20 * 2 + JACKPOT_PAYOUT * 2);
  });

  it('does not fire twice off one full meter', () => {
    const first = drop(oneAway({ jackpot: JACKPOT_FULL - 1 }));
    expect(first.lastEvent?.jackpot).toBe(true);

    const second = drop(
      oneAway({ jackpot: first.jackpot, run: first.run, score: first.score }),
    );
    expect(second.lastEvent?.jackpot).toBe(false);
  });

  it('survives a replay byte-identically', () => {
    // The meter is run state like any other, so a run that hits a jackpot has
    // to reproduce from its seed and action list or the daily is a lie.
    const played = playOutGreedy(createGame({ seed: 99 }));
    expect(played.state.stats.jackpots).toBeGreaterThan(0);
    expect(serialize(replay({ seed: 99 }, played.actions))).toBe(
      serialize(played.state),
    );
  });
});

describe('run stats', () => {
  it('tracks the best run, sweeps and lines over a whole run', () => {
    const s = makeState({
      board: boardFromRows([
        '#######.',
        '.......#',
        '.......#',
        '.......#',
        '.......#',
        '.......#',
        '.......#',
        '.......#',
      ]),
      tray: [slot(ONE), slot(DOM_H), slot(DOM_H)],
      run: 3,
    });

    const next = reducer(s, { type: 'place', source: 'tray', index: 0, x: 7, y: 0 });
    expect(next.stats.linesCleared).toBe(2);
    expect(next.stats.sweptClean).toBe(1);
    expect(next.stats.bestRun).toBe(4);
    expect(next.stats.placements).toBe(1);
  });

  it('records one grid square per deal, holding that deal\'s best clear', () => {
    let g = createGame({ seed: 11 });
    expect(g.stats.dealClears).toHaveLength(1);

    const result = playOut(g, 4242);
    g = result.state;
    // One square per deal, and none can claim more lines than were ever cleared.
    expect(g.stats.dealClears).toHaveLength(g.dealCount);
    expect(Math.max(...g.stats.dealClears)).toBeLessThanOrEqual(
      g.stats.linesCleared,
    );
  });

  it('replays identically, which is what makes a shared result mean anything', () => {
    const seed = 20260801;
    const played = playOut(createGame({ seed }), 777, 400);
    const again = replay({ seed }, played.actions);
    expect(again.stats).toEqual(played.state.stats);
  });
});

describe('replay determinism', () => {
  it('reproduces a long run byte-for-byte', () => {
    const seed = 20260801;
    const first = playOut(createGame({ seed }), 12345, 1000);
    const second = playOut(createGame({ seed }), 12345, 1000);

    expect(first.moves).toBe(second.moves);
    expect(serialize(first.state)).toBe(serialize(second.state));

    // And replaying the recorded action list lands in the same place.
    expect(serialize(replay({ seed }, first.actions))).toBe(
      serialize(first.state),
    );
  });

  it('produces different runs from different seeds', () => {
    const a = playOut(createGame({ seed: 1 }), 999);
    const b = playOut(createGame({ seed: 2 }), 999);
    expect(serialize(a.state)).not.toBe(serialize(b.state));
  });
});

describe('markers by policy', () => {
  /** Every marker kind on the tray of a freshly dealt game. */
  const dealtKinds = (options: Parameters<typeof createGame>[0]): string[] =>
    createGame(options).tray.flatMap((s) =>
      s && s.marker !== NO_MARKER ? [s.markerKind] : [],
    );

  it("never deals a flame under 'mixed' — levels count gems and stars", () => {
    // Level goals are denominated in gems and stars, so a third kind in the
    // pool silently cuts the supply of both and makes every collect-goal
    // harder without any target moving to meet it.
    const kinds = new Set<string>();
    for (let seed = 0; seed < 40; seed++) {
      for (const k of dealtKinds({ seed, markerPolicy: 'mixed', markerOneIn: 1 })) {
        kinds.add(k);
      }
    }
    expect(kinds).toEqual(new Set(['gem', 'star']));
  });

  it("deals flames alongside stars under 'progression' once the Nook is open", () => {
    const kinds = new Set<string>();
    for (let seed = 0; seed < 40; seed++) {
      for (const k of dealtKinds({ seed, markerOneIn: 1, nookUnlocked: true })) {
        kinds.add(k);
      }
    }
    expect(kinds).toEqual(new Set(['star', 'charge']));
  });

  it('deals only gems while the Nook is still sealed', () => {
    const kinds = new Set<string>();
    for (let seed = 0; seed < 40; seed++) {
      for (const k of dealtKinds({ seed, markerOneIn: 1 })) kinds.add(k);
    }
    expect(kinds).toEqual(new Set(['gem']));
  });
});

describe('charged cells', () => {
  // Row 7 is one cell short. A charge sitting in the middle of it goes off
  // when the row completes, taking the 3x3 around it with it.
  const primed = (chargeAt: [number, number]) =>
    makeState({
      board: boardFromRows([
        '........',
        '........',
        '........',
        '........',
        '........',
        '..###...',
        '..###...',
        '.#######',
      ]),
      charges: bit(chargeAt[0], chargeAt[1]),
      tray: [slot(ONE), slot(DOM_H), slot(DOM_H)],
    });

  const fire = (state: GameState) =>
    reducer(state, { type: 'place', source: 'tray', index: 0, x: 0, y: 7 });

  it('takes the surrounding 3x3 with it when its line clears', () => {
    const before = primed([3, 7]);
    const after = fire(before);

    expect(after.lastEvent?.clearedRows).toEqual([7]);
    expect(after.lastEvent?.chargesFired).toBe(1);
    // Row 6 sat above the cleared row and was part of no full line. The whole
    // 3x3 around the charge goes: (2,6), (3,6) and (4,6).
    expect(isFilled(after.board, 2, 6)).toBe(false);
    expect(isFilled(after.board, 3, 6)).toBe(false);
    expect(isFilled(after.board, 4, 6)).toBe(false);
    // Row 5 is two rows up — outside a radius-1 blast — and survives intact.
    expect(isFilled(after.board, 2, 5)).toBe(true);
    expect(isFilled(after.board, 3, 5)).toBe(true);
    expect(isFilled(after.board, 4, 5)).toBe(true);
  });

  it('does nothing at all until its line actually clears', () => {
    const s = makeState({
      board: boardFromRows([
        '........',
        '........',
        '........',
        '........',
        '........',
        '..###...',
        '..###...',
        '.#####..',
      ]),
      charges: bit(3, 7),
      tray: [slot(ONE), slot(DOM_H), slot(DOM_H)],
    });
    const after = reducer(s, { type: 'place', source: 'tray', index: 0, x: 0, y: 7 });
    expect(after.lastEvent?.clearedRows).toEqual([]);
    expect(after.lastEvent?.chargesFired).toBe(0);
    // Everything the blast would have taken is still standing.
    expect(isFilled(after.board, 3, 6)).toBe(true);
    expect(isFilled(after.board, 3, 5)).toBe(true);
    expect(after.charges).toBe(bit(3, 7));
  });

  it('pays no points — the hole it opens is the whole reward', () => {
    const plain = makeState({
      board: boardFromRows([...Array(7).fill('........'), '.#######']),
      tray: [slot(ONE), slot(DOM_H), slot(DOM_H)],
    });
    const charged = makeState({
      board: boardFromRows([...Array(7).fill('........'), '.#######']),
      charges: bit(3, 7),
      tray: [slot(ONE), slot(DOM_H), slot(DOM_H)],
    });
    expect(fire(charged).score).toBe(fire(plain).score);
  });

  it('does not chain — one blast never sets off another', () => {
    const s = makeState({
      board: boardFromRows([
        '........',
        '........',
        '........',
        '........',
        '........',
        '........',
        '.....#..',
        '.#######',
      ]),
      // (2,7) clears with the row; (5,6) is only reachable via the first blast.
      charges: bit(2, 7) | bit(5, 6),
      tray: [slot(ONE), slot(DOM_H), slot(DOM_H)],
    });
    const after = fire(s);
    // Only the charge caught by the line itself counts as fired.
    expect(after.lastEvent?.chargesFired).toBe(1);
    // The second charge was outside the first blast, so it is still on the board.
    expect(after.charges).toBe(bit(5, 6));
  });

  it('clears the colours of everything the blast took', () => {
    const after = fire(primed([3, 7]));
    for (let cell = 0; cell < CELLS; cell++) {
      if ((after.board & (1n << BigInt(cell))) === 0n) {
        expect(after.colors[cell]).toBe(0);
      }
    }
  });

  it('survives a round trip through serialize', () => {
    const s = primed([3, 7]);
    expect(JSON.parse(serialize(s)).charges).toBe(s.charges.toString(36));
  });
});

describe('the Key', () => {
  /**
   * Play the 1x1 into a checkerboard and the run is over: nothing else in the
   * tray fits, and going through the reducer is what sets `status` to 'over'.
   */
  const stuck = (overrides: Partial<GameState> = {}): GameState =>
    reducer(
      makeState({
        board: CHECKERBOARD,
        tray: [slot(ONE), slot(BIG), slot(BIG)],
        keys: 1,
        ...overrides,
      }),
      { type: 'place', source: 'tray', index: 0, x: 0, y: 0 },
    );

  it('does nothing while the run is still playable', () => {
    const alive = makeState({ tray: [slot(ONE), null, null], keys: 1 });
    expect(alive.status).toBe('playing');
    expect(reducer(alive, { type: 'key' })).toBe(alive);
  });

  it('does nothing with no keys in hand', () => {
    const dead = stuck({ keys: 0 });
    expect(dead.status).toBe('over');
    expect(reducer(dead, { type: 'key' })).toBe(dead);
  });

  it('always leaves a legal move — that is the whole promise', () => {
    const dead = stuck();
    expect(dead.status).toBe('over');
    expect(anyLegalMove(dead)).toBe(false);

    const rescued = reducer(dead, { type: 'key' });
    expect(rescued.status).toBe('playing');
    expect(anyLegalMove(rescued)).toBe(true);
    expect(rescued.keys).toBe(0);
  });

  it('clears at least the promised number of lines', () => {
    const dead = stuck();
    const rescued = reducer(dead, { type: 'key' });
    expect(rescued.keyEvent?.lines).toBeGreaterThanOrEqual(KEY_LINES);
    expect(popcount(rescued.board)).toBeLessThan(popcount(dead.board));
  });

  it('pays nothing and does not advance the run', () => {
    // A rescue that scored would make dying on purpose a strategy.
    const dead = stuck({ run: 3 });
    const rescued = reducer(dead, { type: 'key' });
    expect(rescued.score).toBe(dead.score);
    expect(rescued.run).toBe(dead.run);
  });

  it('drops the colours and markers of everything it wiped', () => {
    const dead = stuck();
    const rescued = reducer(dead, { type: 'key' });
    for (let cell = 0; cell < CELLS; cell++) {
      const filled = (rescued.board & (1n << BigInt(cell))) !== 0n;
      if (!filled) expect(rescued.colors[cell]).toBe(0);
    }
    expect(rescued.gems & ~rescued.board).toBe(EMPTY_BOARD);
    expect(rescued.stars & ~rescued.board).toBe(EMPTY_BOARD);
  });

  it('is earned back by sweeping the board clean', () => {
    const s = makeState({
      board: boardFromRows(['#######.', ...Array(7).fill('........')]),
      tray: [slot(ONE), null, null],
      keys: 0,
    });
    const swept = reducer(s, { type: 'place', source: 'tray', index: 0, x: 7, y: 0 });
    expect(swept.lastEvent?.sweptClean).toBe(true);
    expect(swept.keys).toBe(1);
  });

  it('survives a round trip through serialize', () => {
    const rescued = reducer(stuck(), { type: 'key' });
    expect(JSON.parse(serialize(rescued)).keys).toBe(0);
  });
});

/** The first legal placement for the piece in tray slot `index`. */
function firstLegalMove(state: GameState, index: number): Action {
  const s = state.tray[index];
  if (!s) throw new Error(`tray slot ${index} is empty`);
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      if (preview(state, 'tray', index, x, y).legal) {
        return { type: 'place', source: 'tray', index, x, y };
      }
    }
  }
  throw new Error(`no legal move for tray slot ${index}`);
}
