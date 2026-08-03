// The scoreboard for game feel. Not an assertion suite — it prints numbers you
// tune against. Run it before and after any change to generation or weights:
//
//   npx vitest run src/core/__diag.test.ts
//
// The greedy bot cashes every clear the instant it can and never plans a combo,
// so it under-states what a person achieves. Read the numbers as a floor, and
// read *changes* in them as the signal.

import { it } from 'vitest';
import { createGame, reducer, type GameState } from './game';
import { playOutGreedy } from './bot';
import { analyseBoard, exploreSequence } from './generator';
import { PIECES } from './pieces';

it('diagnosis', () => {
  const games = 400;

  let deals = 0;
  // Deals where SOME piece in the catalogue could finish a line...
  let dealsWhereFinisherExists = 0;
  // ...and the hand we were actually given contained one.
  let dealsWhereHandHadFinisher = 0;
  // Same, for multi-line finishers.
  let dealsWhereMultiExists = 0;
  let dealsWhereHandHadMulti = 0;

  // The payoff questions: not "does one piece finish a line right now" but
  // "can this hand, played out in some order, actually get me something".
  let handCouldClear = 0;
  let handCouldBurst = 0;

  let firstClearTotal = 0;
  let gamesWithClear = 0;
  let gapSum = 0;
  let gapCount = 0;

  // Clears by size, so "more combos" is measurable rather than vibes.
  const bySize = [0, 0, 0, 0, 0, 0];
  let nookUnlocked = 0;
  const scores: number[] = [];
  const moves: number[] = [];

  for (let seed = 0; seed < games; seed++) {
    const initial = createGame({ seed });
    let state = initial;
    const result = playOutGreedy(initial);

    let placements = 0;
    let firstClear = -1;
    let lastClearAt = 0;

    const inspect = (s: GameState): void => {
      deals++;
      const fit = analyseBoard(s.board);
      const hand = s.tray.flatMap((slot) => (slot ? [slot.piece] : []));

      const anyFinisher = PIECES.some(
        (p) => fit.completes[p.id]! >= 1 && fit.fits[p.id]! > 0,
      );
      const anyMulti = PIECES.some(
        (p) => fit.completes[p.id]! >= 2 && fit.fits[p.id]! > 0,
      );
      const handFinisher = hand.some((id) => fit.completes[id]! >= 1);
      const handMulti = hand.some((id) => fit.completes[id]! >= 2);

      if (anyFinisher) {
        dealsWhereFinisherExists++;
        if (handFinisher) dealsWhereHandHadFinisher++;
      }
      if (anyMulti) {
        dealsWhereMultiExists++;
        if (handMulti) dealsWhereHandHadMulti++;
      }

      const reach = exploreSequence(s.board, hand, s.nook?.piece ?? null, 9);
      if (reach.placedAll && reach.bestTotal >= 1) handCouldClear++;
      if (reach.placedAll && reach.bestBurst >= 2) handCouldBurst++;
    };

    inspect(state);
    for (const action of result.actions) {
      const beforeDeal = state.dealCount;
      const beforeNook = state.nookUnlocked;
      state = reducer(state, action);
      placements++;
      const ev = state.lastEvent;
      if (ev && ev.clearedRows.length + ev.clearedCols.length > 0) {
        const size = ev.clearedRows.length + ev.clearedCols.length;
        bySize[Math.min(size, 5)]!++;
        if (firstClear < 0) firstClear = placements;
        gapSum += placements - lastClearAt;
        gapCount++;
        lastClearAt = placements;
      }
      if (!beforeNook && state.nookUnlocked) nookUnlocked++;
      if (state.dealCount !== beforeDeal) inspect(state);
    }

    if (firstClear > 0) {
      firstClearTotal += firstClear;
      gamesWithClear++;
    }
    scores.push(state.score);
    moves.push(result.actions.length);
  }

  const pct = (a: number, b: number): string =>
    b === 0 ? 'n/a' : `${((a / b) * 100).toFixed(1)}%`;

  const p = (xs: number[], q: number): number =>
    [...xs].sort((a, b) => a - b)[Math.floor((xs.length - 1) * q)]!;

  const totalClears = bySize.reduce((a, b) => a + b, 0);

  console.log({
    deals,
    handHadFinisherWhenAvailable: pct(
      dealsWhereHandHadFinisher,
      dealsWhereFinisherExists,
    ),
    handHadMultiWhenAvailable: pct(dealsWhereHandHadMulti, dealsWhereMultiExists),
    dealsWhereMultiWasPossible: pct(dealsWhereMultiExists, deals),
    handCouldClear: pct(handCouldClear, deals),
    handCouldBurst2: pct(handCouldBurst, deals),
    placementsToFirstClear: (firstClearTotal / gamesWithClear).toFixed(1),
    avgPlacementsBetweenClears: (gapSum / gapCount).toFixed(2),
    clears: {
      single: pct(bySize[1]!, totalClears),
      double: pct(bySize[2]!, totalClears),
      triplePlus: pct(bySize[3]! + bySize[4]! + bySize[5]!, totalClears),
    },
    nookUnlockRate: pct(nookUnlocked, games),
    moves: `p10/50/90 ${p(moves, 0.1)}/${p(moves, 0.5)}/${p(moves, 0.9)}`,
    score: `p10/50/90 ${p(scores, 0.1)}/${p(scores, 0.5)}/${p(scores, 0.9)}`,
  });
});
