// A random-legal-move bot. Pure, seeded, and independent of the game's own
// RNG — which is what makes it useful for the replay-determinism property test
// and for fuzzing the generator's weight and mercy curves.

import { N, PLACEMENTS, type Board } from './board';
import {
  anyLegalMove,
  preview,
  reducer,
  type Action,
  type GameState,
} from './game';
import { nextInt, type RngState } from './rng';

/** Every legal placement available from the tray and the Nook. */
export function legalMoves(state: GameState): Action[] {
  if (state.status !== 'playing') return [];

  const moves: Action[] = [];
  const collect = (
    source: 'tray' | 'nook',
    index: number,
    piece: number,
    board: Board,
  ): void => {
    for (const pl of PLACEMENTS[piece]!) {
      if ((board & pl.mask) === 0n) {
        moves.push({ type: 'place', source, index, x: pl.x, y: pl.y });
      }
    }
  };

  state.tray.forEach((slot, i) => {
    if (slot) collect('tray', i, slot.piece, state.board);
  });
  if (state.nook) collect('nook', 0, state.nook.piece, state.board);

  return moves;
}

export interface PlayOut {
  readonly state: GameState;
  readonly actions: Action[];
  readonly moves: number;
}

/**
 * Play until the run ends or `maxMoves` is reached, picking uniformly among
 * legal placements. Never stashes — the Nook is exercised by its own tests.
 */
export function playOut(
  initial: GameState,
  botSeed: RngState,
  maxMoves = 10000,
): PlayOut {
  let state = initial;
  let rng = botSeed >>> 0;
  const actions: Action[] = [];

  while (state.status === 'playing' && actions.length < maxMoves) {
    const moves = legalMoves(state);
    if (moves.length === 0) break;

    const [i, next] = nextInt(rng, moves.length);
    rng = next;

    const action = moves[i]!;
    actions.push(action);
    state = reducer(state, action);
  }

  return { state, actions, moves: actions.length };
}

/** Sanity helper: a run that ended must genuinely have no move left. */
export const endedFairly = (state: GameState): boolean =>
  state.status !== 'over' || !anyLegalMove(state);

/**
 * A greedy bot: takes the highest-scoring placement available, packing toward
 * the edges when scores tie.
 *
 * This exists because the random bot is blind to anything that depends on
 * *choosing* a placement — most obviously combos, which need the right piece
 * put in the right spot. Measuring combo rates with random play says nothing
 * about whether combos are achievable; it only says a coin-flipper can't find
 * them. This is still nowhere near a good human, but it responds to piece
 * supply, which is the thing being tuned.
 */
export function bestMove(state: GameState): Action | null {
  let best: Action | null = null;
  let bestScore = -Infinity;

  for (const move of legalMoves(state)) {
    if (move.type !== 'place') continue;
    const outcome = preview(state, move.source, move.index, move.x, move.y);
    if (!outcome.legal) continue;

    // Points dominate; edge-packing breaks ties, since leaving the middle
    // open is what keeps a board alive.
    const edginess = edgeBias(state, move.x, move.y);
    const score = outcome.gained * 1000 + edginess;

    if (score > bestScore) {
      bestScore = score;
      best = move;
    }
  }

  return best;
}

/** Higher when the piece's cells hug the rim of the board. */
function edgeBias(state: GameState, x: number, y: number): number {
  const slot = state.tray.find(Boolean);
  if (!slot) return 0;
  const half = (N - 1) / 2;
  return Math.abs(x - half) + Math.abs(y - half);
}

export function playOutGreedy(initial: GameState, maxMoves = 10000): PlayOut {
  let state = initial;
  const actions: Action[] = [];

  while (state.status === 'playing' && actions.length < maxMoves) {
    const move = bestMove(state);
    if (!move) break;
    actions.push(move);
    state = reducer(state, move);
  }

  return { state, actions, moves: actions.length };
}
