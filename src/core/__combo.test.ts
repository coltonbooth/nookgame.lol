import { it } from 'vitest';
import { createGame, reducer } from './game';
import { playOutGreedy } from './bot';

function measure(fairDeal: boolean, games = 800) {
  const bySize = [0, 0, 0, 0, 0, 0, 0];
  let biggestTotal = 0;
  let score = 0;
  let moves = 0;
  let gamesWithTriple = 0;

  for (let seed = 0; seed < games; seed++) {
    const initial = createGame({ seed, fairDeal });
    let state = initial;
    let biggest = 0;

    const result = playOutGreedy(initial);
    // Replay to observe each clear.
    for (const action of result.actions) {
      state = reducer(state, action);
      const ev = state.lastEvent;
      if (ev) {
        const n = ev.clearedRows.length + ev.clearedCols.length;
        if (n > 0) bySize[Math.min(n, 6)]! += 1;
        if (n > biggest) biggest = n;
      }
    }

    biggestTotal += biggest;
    score += result.state.score;
    moves += result.moves;
    if (biggest >= 3) gamesWithTriple++;
  }

  const triples = bySize[3]! + bySize[4]! + bySize[5]! + bySize[6]!;
  return {
    label: fairDeal ? 'raw  ' : 'tuned',
    singles: (bySize[1]! / games).toFixed(2),
    doubles: (bySize[2]! / games).toFixed(2),
    triplePlus: (triples / games).toFixed(2),
    pctGamesWithTriple: ((gamesWithTriple / games) * 100).toFixed(1) + '%',
    biggestPerGame: (biggestTotal / games).toFixed(2),
    scorePerGame: (score / games).toFixed(0),
    movesPerGame: (moves / games).toFixed(1),
  };
}

it('combos under greedy play', () => {
  console.log(measure(true));
  console.log(measure(false));
});
