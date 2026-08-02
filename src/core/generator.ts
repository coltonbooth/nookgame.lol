// Piece generation — the part that decides whether the game feels fair.
//
// Naive weighted-random deals feel terrible, so five layers sit on top:
//   1. weighted bag, not uniform
//   2. guaranteed fit — at least one of the three is placeable right now
//   3. sequence solvability — some ordering of the three is fully placeable
//   4. openness-adaptive weighting, governed by a decaying `mercy`
//   5. anti-repetition
//
// Layers 2 and 3 take the Nook into account: a player holding a 1×1 has more
// outs, and the generator should know it.

import {
  PLACEMENTS,
  ROW,
  COL,
  SURROUNDS,
  clearLines,
  fitsAnywhere,
  fullLines,
  occupancy,
  place,
  countPlacements,
  idx,
  CELLS,
  N,
  type Board,
} from './board';
import { PIECES, type PieceId } from './pieces';
import { nextInt, weightedPick, type RngState } from './rng';

/** Anchors these have on an empty board — the denominators for openness. */
const PIECE_3X3: PieceId = PIECES.findIndex((p) => p.name === '3x3');
const PIECE_2X2: PieceId = PIECES.findIndex((p) => p.name === '2x2');
const MAX_3X3_PLACEMENTS = 36;
const MAX_2X2_PLACEMENTS = 49;

/** Below this much assistance the board analysis isn't worth running. */
const ASSIST_FLOOR = 0.05;

/**
 * How hard each signal pulls, at full assistance. Tuned against a
 * random-move bot over 1,500 games — see the numbers in `dealWeights`.
 *
 * SIZE_PULL is doing more work than it looks. "Completes a line" and "sits
 * snugly" both favour *small* pieces left to themselves: a 1×1 dropped into a
 * one-cell gap scores maximally on each. Without a size counterweight the
 * clever signals hand out more junk hands than plain random weights do.
 */
const SIZE_PULL = 0.8;
const SNUG_PULL = 0.9;

/**
 * Line-finishing potential, and deliberately not linear in the number of lines.
 *
 * Boosting *any* finisher backfires: hand a player the piece that clears each
 * row the moment it becomes clearable and rows never stack up, so every clear
 * is a single and big combinations become impossible. Keeping single-line
 * finishers on a short leash lets pressure build, and paying heavily for
 * multi-line finishers means the piece that cashes three rows in at once shows
 * up when it has been earned.
 */
const SINGLE_LINE_PULL = 0.5;
const MULTI_LINE_PULL = 2.4;
/** How hard to favour pieces that bring lines to the brink without finishing. */
const PRIME_PULL = 0.6;

function lineValue(completes: number): number {
  if (completes <= 0) return 0;
  if (completes === 1) return SINGLE_LINE_PULL;
  return MULTI_LINE_PULL * (completes - 1);
}

/** A piece with nowhere to go is the definition of a bad piece. */
const DEAD_PENALTY = 0.04;
/** How much a shape repeated across the last two deals is damped. Not zero. */
const REPEAT_PENALTY = 0.3;
/** A generated daily layout must leave the board at least this open. */
const LAYOUT_MIN_OPENNESS = 0.32;

/** How many hands to try before falling back to the best one seen. */
const MAX_ATTEMPTS = 16;
/** Node ceiling for one solvability search. Typical searches use under 50. */
const SOLVE_BUDGET = 4000;

/** Score at which mercy has fully decayed. The game hardens as you improve. */
export const MERCY_SPAN = 30000;
export const MERCY_FLOOR = 0.15;

export interface DealContext {
  readonly board: Board;
  readonly nook: PieceId | null;
  /** Last two deals, flattened: [0..2] most recent, [3..5] the one before. */
  readonly recentShapes: readonly PieceId[];
  readonly score: number;
  /** Fair Deal turns off all adaptive assistance. */
  readonly fairDeal: boolean;
}

export interface DealResult {
  readonly pieces: [PieceId, PieceId, PieceId];
  readonly rngState: RngState;
}

/** Assistance strength, decaying to a floor as the score rises. */
export function mercyFor(score: number): number {
  const m = 1 - score / MERCY_SPAN;
  return Math.max(MERCY_FLOOR, Math.min(1, m));
}

/**
 * Board pressure as a 0–1 openness figure. Blends the room left for a 2×2 and
 * for a 3×3: the 3×3 stops fitting long before a board is genuinely tight, so
 * on its own it saturates far too early and the game panics prematurely.
 */
export function boardOpenness(board: Board): number {
  const big = countPlacements(board, PIECE_3X3) / MAX_3X3_PLACEMENTS;
  const small = countPlacements(board, PIECE_2X2) / MAX_2X2_PLACEMENTS;
  return (big + small) / 2;
}

/**
 * What the board actually looks like from each piece's point of view. This is
 * the "be a bit intelligent" part: rather than judging pieces by size alone,
 * ask where each one could go, whether it could finish a line, and how snugly
 * it would sit in the gap it lands in.
 */
export interface BoardFit {
  /** Legal anchors per piece. Zero means the piece is born dead. */
  readonly fits: number[];
  /** Most lines any single placement of this piece could complete. */
  readonly completes: number[];
  /**
   * How many lines a placement would leave *primed* — one or two cells from
   * done — without finishing them. This is the combo-building signal: a triple
   * can only ever happen if three lines arrive at the brink together, and
   * nothing else in here rewards getting them there.
   */
  readonly primes: number[];
  /** Best snugness in 0–1: how enclosed its tightest placement would be. */
  readonly snugness: number[];
}

/** The longest piece in the catalogue — the most cells one piece can cover. */
const MAX_PIECE_SPAN = 5;
/** A line this close is worth building toward even if nothing can finish it yet. */
const BUILDABLE_MISSING = 7;
/** After a placement, a line left needing this few is primed for a combo. */
const PRIMED_MISSING = 2;

/** Masks of the cells still missing from each line within `limit` of full. */
function lineGaps(board: Board, limit: number): bigint[] {
  const gaps: bigint[] = [];
  for (let y = 0; y < N; y++) {
    const missing = ROW(y) & ~board;
    if (missing !== 0n && popcountUpTo(missing, limit)) gaps.push(missing);
  }
  for (let x = 0; x < N; x++) {
    const missing = COL(x) & ~board;
    if (missing !== 0n && popcountUpTo(missing, limit)) gaps.push(missing);
  }
  return gaps;
}

/** Cheap gate: is any line close enough to be worth thinking about? */
function anyNearlyFull(board: Board): boolean {
  for (let y = 0; y < N; y++) {
    const missing = ROW(y) & ~board;
    if (missing !== 0n && popcountUpTo(missing, BUILDABLE_MISSING)) return true;
  }
  for (let x = 0; x < N; x++) {
    const missing = COL(x) & ~board;
    if (missing !== 0n && popcountUpTo(missing, BUILDABLE_MISSING)) return true;
  }
  return false;
}

/** True if the mask has between 1 and `limit` bits. Bails early. */
function popcountUpTo(mask: bigint, limit: number): boolean {
  let n = 0;
  let b = mask;
  while (b !== 0n) {
    b &= b - 1n;
    if (++n > limit) return false;
  }
  return n > 0;
}

/** Bit count, giving up once past `cap`. */
function popcountCapped(mask: bigint, cap: number): number {
  let n = 0;
  let b = mask;
  while (b !== 0n && n <= cap) {
    b &= b - 1n;
    n++;
  }
  return n;
}

export function analyseBoard(board: Board): BoardFit {
  const cells = occupancy(board);
  const gaps = lineGaps(board, MAX_PIECE_SPAN);
  const buildable = lineGaps(board, BUILDABLE_MISSING);

  const fits: number[] = [];
  const completes: number[] = [];
  const primes: number[] = [];
  const snugness: number[] = [];

  for (const p of PIECES) {
    const placements = PLACEMENTS[p.id]!;
    const surrounds = SURROUNDS[p.id]!;

    let count = 0;
    let bestLines = 0;
    let bestPrimed = 0;
    let bestSnug = 0;

    for (let i = 0; i < placements.length; i++) {
      const pl = placements[i]!;
      if ((board & pl.mask) !== 0n) continue;
      count++;

      // How many nearly-full lines would this placement finish? A line is
      // finished when the placement covers every one of its missing cells.
      let lines = 0;
      for (const missing of gaps) {
        if ((missing & ~pl.mask) === 0n) lines++;
      }
      if (lines > bestLines) bestLines = lines;

      // And how many would it leave on the brink? Not finished — primed.
      let primed = 0;
      for (const missing of buildable) {
        const left = popcountCapped(missing & ~pl.mask, PRIMED_MISSING + 1);
        if (left >= 1 && left <= PRIMED_MISSING) primed++;
      }
      if (primed > bestPrimed) bestPrimed = primed;

      const { halo, wall } = surrounds[i]!;
      let touching = wall;
      for (const cell of halo) touching += cells[cell]!;
      const snug = touching / (halo.length + wall);
      if (snug > bestSnug) bestSnug = snug;
    }

    fits.push(count);
    completes.push(bestLines);
    primes.push(bestPrimed);
    snugness.push(count === 0 ? 0 : bestSnug);
  }

  return { fits, completes, primes, snugness };
}

/**
 * A starting layout for Today's Nook, built from the day's seed.
 *
 * Rather than scattering cells at random — which reads as damage, not design —
 * this lays down whole catalogue pieces. Everything on the board is a shape
 * the game could have dealt you, so the gaps between them are the same kind of
 * gaps you make yourself, and each day opens on a board with its own character.
 *
 * Never completes a line (that would clear on the first placement and hand out
 * free points) and never fills so much that the run starts in trouble.
 */
export function generateLayout(
  rngState: RngState,
  targetCells: number,
): { board: Board; colors: Uint8Array; rngState: RngState } {
  let board = 0n;
  const colors = new Uint8Array(CELLS);
  let rng = rngState;
  let placed = 0;

  // Medium shapes read as deliberate; a board of 1x1s reads as static.
  const candidates = PIECES.filter((p) => p.size >= 2 && p.size <= 5);
  const weights = candidates.map((p) => p.weight);

  for (let attempt = 0; attempt < 60 && placed < targetCells; attempt++) {
    const [pick, afterPick] = weightedPick(rng, weights);
    rng = afterPick;
    const piece = candidates[pick]!;
    if (placed + piece.size > targetCells) continue;

    const spots = PLACEMENTS[piece.id]!.filter((pl) => (board & pl.mask) === 0n);
    if (spots.length === 0) continue;

    const [spot, afterSpot] = nextInt(rng, spots.length);
    rng = afterSpot;
    const chosen = spots[spot]!;

    // A pre-filled line would clear the instant play started.
    const next = board | chosen.mask;
    const lines = fullLines(next);
    if (lines.rows.length > 0 || lines.cols.length > 0) continue;

    // Scattering pieces can fragment a board far more than the cell count
    // suggests. Everyone gets the same daily, so a cramped opening is cramped
    // for everybody — refuse any placement that boxes the board in.
    if (boardOpenness(next) < LAYOUT_MIN_OPENNESS) continue;

    const [color, afterColor] = nextInt(rng, 4);
    rng = afterColor;

    board = next;
    for (const [dx, dy] of piece.cells) {
      colors[idx(chosen.x + dx, chosen.y + dy)] = color + 1;
    }
    placed += piece.size;
  }

  return { board, colors, rngState: rng };
}

/** Place, then clear any completed lines. The board a player would end up with. */
function simulate(board: Board, mask: bigint): Board {
  const placed = place(board, mask);
  const lines = fullLines(placed);
  if (lines.rows.length === 0 && lines.cols.length === 0) return placed;
  return clearLines(placed, lines);
}

/** Layer 2: is at least one of these placeable on the board as it stands? */
export function hasAnyFit(board: Board, ids: readonly PieceId[]): boolean {
  return ids.some((id) => fitsAnywhere(board, id));
}

/**
 * Layer 3: can *some* ordering of `ids` be placed in full? Line clears are
 * simulated between placements because clearing opens space. The Nook's piece
 * may optionally be spent at any point — it only ever adds outs.
 *
 * Returns false if the node budget runs out, which just means "redeal".
 */
export function isSolvableSequence(
  board: Board,
  ids: readonly PieceId[],
  nook: PieceId | null = null,
  budget: number = SOLVE_BUDGET,
): boolean {
  let nodes = budget;
  const seen = new Set<string>();

  const search = (b: Board, remaining: number, nookLeft: boolean): boolean => {
    if (remaining === 0) return true;
    if (--nodes <= 0) return false;

    const key = `${b.toString(36)}:${remaining}:${nookLeft ? 1 : 0}`;
    if (seen.has(key)) return false;
    seen.add(key);

    for (let i = 0; i < ids.length; i++) {
      if ((remaining & (1 << i)) === 0) continue;
      for (const pl of PLACEMENTS[ids[i]!]!) {
        if ((b & pl.mask) !== 0n) continue;
        if (search(simulate(b, pl.mask), remaining & ~(1 << i), nookLeft)) {
          return true;
        }
        if (nodes <= 0) return false;
      }
    }

    if (nookLeft && nook !== null) {
      for (const pl of PLACEMENTS[nook]!) {
        if ((b & pl.mask) !== 0n) continue;
        if (search(simulate(b, pl.mask), remaining, false)) return true;
        if (nodes <= 0) return false;
      }
    }

    return false;
  };

  return search(board, (1 << ids.length) - 1, nook !== null);
}

/**
 * Layer 4, and the part that decides whether a hand feels fair.
 *
 * The obvious move on a tight board is to hand out small pieces so that
 * something always fits. It is also wrong: small pieces cannot finish lines, so
 * the board keeps filling and the run dies anyway, slowly, on a diet of
 * dominoes. What a cornered player needs is a piece that goes in the gap they
 * actually have and gets a line back.
 *
 * So as the board tightens we bias toward pieces that are *longer*, that could
 * complete a line, and that slot snugly into the shape of the holes on the
 * board — and away from pieces with nowhere to go at all.
 *
 * Measured against raw weights over 1,500 bot games, on tight boards: hands
 * whose best piece is 3 cells or fewer fall from 7.5% to ~4.5%, mean dealt
 * piece size rises from 3.56 to ~3.83, and line clears per game roughly
 * double, from 1.93 to ~3.5.
 *
 * Note the bot places at random, so it *misuses* long pieces in a way a person
 * doesn't — it under-states the value of the size bias. Read its run length as
 * a floor, not a verdict.
 *
 * `fairDeal` skips the lot and hands back the raw catalogue weights.
 */
export function dealWeights(
  board: Board,
  score: number,
  fairDeal: boolean,
): number[] {
  const base = PIECES.map((p) => p.weight);
  if (fairDeal) return base;

  const mercy = mercyFor(score);
  if (mercy < ASSIST_FLOOR) return base;

  // Two different jobs, and they must not share a gate.
  //
  // Shape help — longer pieces, snug fits — is rescue work, so it scales with
  // how boxed in you are. Line help is *rhythm*, and rhythm is not something
  // you only want when you're dying: if it waits for a tight board you never
  // get a run going, and the game reads as relentless. So it rides on mercy
  // alone and stays on from the first placement.
  const shapeAssist = mercy * (1 - boardOpenness(board));
  const openings = anyNearlyFull(board);
  if (!openings && shapeAssist < ASSIST_FLOOR) return base;

  const fit = analyseBoard(board);

  return PIECES.map((p, i) => {
    if (fit.fits[i] === 0) return base[i]! * DEAD_PENALTY;

    // Could it finish lines right now, and how many at once?
    const lines = 1 + mercy * lineValue(fit.completes[i]!);
    // Or bring lines to the brink, so a combo becomes possible at all.
    const priming = 1 + mercy * PRIME_PULL * Math.min(fit.primes[i]!, 3);
    // Longer pieces, capped at 5 so the 3x3 doesn't run away with it.
    const size = 1 + shapeAssist * SIZE_PULL * (Math.min(p.size, 5) - 3);
    // Does it slot into the shape of a hole, rather than just fitting somewhere?
    const snug =
      1 + shapeAssist * SNUG_PULL * Math.max(0, fit.snugness[i]! - 0.45) * 2;

    return base[i]! * clamp(size * lines * priming * snug, 0.05, 10);
  });
}

const clamp = (v: number, lo: number, hi: number): number =>
  Math.max(lo, Math.min(hi, v));

/**
 * Layer 5: shapes that turned up in both of the last two deals get damped.
 *
 * This used to be a hard ban, which was a mistake — it meant the one shape you
 * were saving a gap for could be the one shape the generator refused to give
 * you, and there was no way to tell that from bad luck. A weight penalty keeps
 * hands varied without ever making a piece unobtainable.
 */
export function repeatedShapes(recentShapes: readonly PieceId[]): Set<PieceId> {
  const repeated = new Set<PieceId>();
  if (recentShapes.length < 6) return repeated;
  const previous = new Set(recentShapes.slice(0, 3));
  for (const id of recentShapes.slice(3, 6)) {
    if (previous.has(id)) repeated.add(id);
  }
  return repeated;
}

/** Draw three, damping recent repeats and never dealing three of a kind. */
function drawHand(
  rngState: RngState,
  weights: readonly number[],
  repeated: ReadonlySet<PieceId>,
): [ids: [PieceId, PieceId, PieceId], next: RngState] {
  const available = weights.map((w, i) => (repeated.has(i) ? w * REPEAT_PENALTY : w));
  const counts = new Map<PieceId, number>();
  const picked: PieceId[] = [];
  let state = rngState;

  for (let k = 0; k < 3; k++) {
    const [id, next] = weightedPick(state, available);
    state = next;
    picked.push(id);

    const seen = (counts.get(id) ?? 0) + 1;
    counts.set(id, seen);
    // Two of a shape is a legitimate hand; three is a bad joke.
    if (seen >= 2) available[id] = 0;
  }

  return [[picked[0]!, picked[1]!, picked[2]!], state];
}

/**
 * Force a hand to contain something placeable by swapping one slot for a
 * weighted pick among the pieces that actually fit. Only reachable when the
 * board is tight enough that sixteen random hands all missed; without it the
 * guaranteed-fit rule would be a probability rather than a guarantee.
 */
function repairHand(
  board: Board,
  hand: [PieceId, PieceId, PieceId],
  weights: readonly number[],
  rngState: RngState,
): [hand: [PieceId, PieceId, PieceId], next: RngState] {
  const fitting = PIECES.filter((p) => fitsAnywhere(board, p.id)).map((p) => p.id);
  if (fitting.length === 0) return [hand, rngState];

  const [k, afterPick] = weightedPick(
    rngState,
    fitting.map((id) => weights[id]!),
  );
  const [slot, next] = nextInt(afterPick, 3);

  const repaired: [PieceId, PieceId, PieceId] = [...hand];
  repaired[slot] = fitting[k]!;
  return [repaired, next];
}

/**
 * Deal a set of three. Tries hands until one is both immediately playable and
 * fully solvable in some order, then falls back to merely playable, then to a
 * repaired hand. If nothing in the catalogue fits at all the run is already
 * over, and the reducer's end check will say so.
 */
export function dealThree(ctx: DealContext, rngState: RngState): DealResult {
  const weights = dealWeights(ctx.board, ctx.score, ctx.fairDeal);
  const repeated = repeatedShapes(ctx.recentShapes);

  let state = rngState;
  let playable: [PieceId, PieceId, PieceId] | null = null;
  let last: [PieceId, PieceId, PieceId] = [0, 0, 0];

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const [ids, next] = drawHand(state, weights, repeated);
    state = next;
    last = ids;

    if (!hasAnyFit(ctx.board, ids)) continue;
    if (playable === null) playable = ids;

    if (isSolvableSequence(ctx.board, ids, ctx.nook)) {
      return { pieces: ids, rngState: state };
    }
  }

  if (playable !== null) return { pieces: playable, rngState: state };

  const [repaired, next] = repairHand(ctx.board, last, weights, state);
  return { pieces: repaired, rngState: next };
}
