// The level ladder.
//
// A level is a seed, a starting layout and a set of goals — all derived from
// the level number, so level 12 is the same level 12 for everyone, forever,
// with nothing stored anywhere.
//
// There is no piece budget. You play until the objectives are met or until
// there is nowhere left to put anything, and difficulty comes from the targets
// rising faster than you can keep up: "score 400" is a warm-up, "score 8,000"
// fails because the run ends first.

import { popcount } from './board';
import type { GameState } from './game';
import { hashString, nextInt, type RngState } from './rng';

export type GoalKind =
  | 'score'
  | 'lines'
  | 'gems'
  | 'stars'
  | 'combo'
  | 'sweep'
  | 'run'
  | 'tidy';

export interface Goal {
  readonly kind: GoalKind;
  readonly target: number;
}

export interface Level {
  readonly number: number;
  readonly seed: RngState;
  /** Cells pre-filled with a generated layout. Rises with the level. */
  readonly layoutCells: number;
  /** One marked cell per this many dealt pieces. Levels are richer than
   *  endless, because collect-N goals need the supply to be gettable. */
  readonly markerOneIn: number;
  /** Every goal must be met. */
  readonly goals: readonly Goal[];
}

/** Levels are generous with markers; endless uses its own, rarer rate. */
const LEVEL_MARKER_ONE_IN = 5;

/** Nothing pre-placed for the first few — let people find their feet. */
const LAYOUT_FROM_LEVEL = 3;
const MAX_LAYOUT_CELLS = 22;

// --- the curve -------------------------------------------------------------

const clamp = (v: number, lo: number, hi: number): number =>
  Math.max(lo, Math.min(hi, v));

/** Round to something that reads like a target rather than a calculation. */
function tidy(value: number): number {
  if (value < 500) return Math.round(value / 10) * 10;
  if (value < 2000) return Math.round(value / 50) * 50;
  return Math.round(value / 100) * 100;
}

export function targetFor(kind: GoalKind, level: number): number {
  const n = Math.max(1, level);
  switch (kind) {
    // Gentle opening, then a steepening curve. Around level 20 this passes
    // what a decent run scores, which is where the ladder starts to bite.
    case 'score':
      return tidy(150 + Math.pow(n, 1.4) * 45);
    case 'lines':
      return 3 + Math.floor(n * 0.85);
    // Markers have to actually turn up to be collected, so this rises slowly —
    // but it does keep rising. It used to stop dead at 12 around level 28,
    // after which every collect goal on the ladder was identical forever.
    case 'gems':
    case 'stars':
      return clamp(1 + Math.floor(n / 2.5), 1, 30);
    // A double is very achievable; a triple is genuinely hard. Four is a real
    // event, and asking for it is what a level in the fifties is *for*.
    case 'combo':
      if (n < 18) return 2;
      return n < 40 ? 3 : 4;
    case 'sweep':
      return n < 30 ? 1 : 2;
    // Hold a streak going. Reaching the x5 cap needs six clears in a row.
    case 'run':
      return clamp(2 + Math.floor(n / 8), 2, 6);
    // Get the board down to this many cells or fewer. Pure board management,
    // and it tightens purely by asking for less room used.
    case 'tidy':
      return clamp(40 - Math.floor(n / 3), 10, 40);
  }
}

export function layoutCellsFor(level: number): number {
  if (level < LAYOUT_FROM_LEVEL) return 0;
  return clamp(Math.floor((level - LAYOUT_FROM_LEVEL + 1) * 1.4), 4, MAX_LAYOUT_CELLS);
}

/**
 * How many goals a level asks for. Ramps so the opening stays readable, and
 * keeps ramping — stopping at three was most of why levels past the twenties
 * all felt the same.
 */
function goalCountFor(level: number): number {
  if (level < 4) return 1;
  if (level < 12) return 2;
  if (level < 32) return 3;
  return 4;
}

const PRIMARY: readonly GoalKind[] = ['score', 'lines'];
const COLLECT: readonly GoalKind[] = ['gems', 'stars'];
const HARD: readonly GoalKind[] = ['combo', 'sweep', 'run', 'tidy'];

/** Deterministic pick, so the ladder is identical for everyone. */
function pick<T>(items: readonly T[], state: RngState): [T, RngState] {
  const [index, next] = nextInt(state, items.length);
  return [items[index] ?? items[0]!, next];
}

export function goalsFor(level: number): Goal[] {
  const n = Math.max(1, level);
  let rng = hashString(`nook-level-goals-${n}`);
  const count = goalCountFor(n);
  const kinds: GoalKind[] = [];

  // Always one score-or-lines goal: it's the one that can't stall out.
  const [primary, afterPrimary] = pick(PRIMARY, rng);
  rng = afterPrimary;
  kinds.push(primary);

  if (count >= 2) {
    const [collect, afterCollect] = pick(COLLECT, rng);
    rng = afterCollect;
    kinds.push(collect);
  }

  if (count >= 3) {
    // The third slot mixes in the hard kinds once the ladder has warmed up.
    const pool: GoalKind[] = n >= 14 ? [...COLLECT, ...HARD] : [...COLLECT];
    const remaining = pool.filter((kind) => !kinds.includes(kind));
    const [third, afterThird] = pick(
      remaining.length > 0 ? remaining : COLLECT,
      rng,
    );
    rng = afterThird;
    kinds.push(third);
  }

  if (count >= 4) {
    // Deep in the ladder a second hard goal is the point. Still never the
    // same kind twice, and the primary is always there to carry the level.
    const remaining = [...PRIMARY, ...COLLECT, ...HARD].filter(
      (kind) => !kinds.includes(kind),
    );
    const [fourth, afterFourth] = pick(
      remaining.length > 0 ? remaining : HARD,
      rng,
    );
    rng = afterFourth;
    kinds.push(fourth);
  }

  return kinds.map((kind) => ({ kind, target: targetFor(kind, n) }));
}

export function levelFor(level: number): Level {
  const n = Math.max(1, Math.floor(level));
  return {
    number: n,
    seed: hashString(`nook-level-${n}`),
    layoutCells: layoutCellsFor(n),
    markerOneIn: LEVEL_MARKER_ONE_IN,
    goals: goalsFor(n),
  };
}

// --- progress --------------------------------------------------------------

/** Best single clear in the run, in lines. */
function bestClear(state: GameState): number {
  let best = 0;
  for (const n of state.stats.dealClears) if (n > best) best = n;
  return best;
}

export function progressOf(goal: Goal, state: GameState): number {
  switch (goal.kind) {
    case 'score':
      return state.score;
    case 'lines':
      return state.stats.linesCleared;
    case 'gems':
      return state.stats.gemsCleared;
    case 'stars':
      return state.stats.starsCleared;
    case 'combo':
      return bestClear(state);
    case 'sweep':
      return state.stats.sweptClean;
    case 'run':
      return state.stats.bestRun;
    case 'tidy':
      return popcount(state.board);
  }
}

/**
 * `tidy` is the one goal you meet by going *down*: it asks you to get the board
 * under a size, not over one. Everything else is a threshold to reach.
 */
const COUNTS_DOWN: ReadonlySet<GoalKind> = new Set<GoalKind>(['tidy']);

export const goalMet = (goal: Goal, state: GameState): boolean =>
  COUNTS_DOWN.has(goal.kind)
    ? progressOf(goal, state) <= goal.target
    : progressOf(goal, state) >= goal.target;

export const levelComplete = (level: Level, state: GameState): boolean =>
  level.goals.every((goal) => goalMet(goal, state));

// --- copy ------------------------------------------------------------------

/** Full sentence, for the objective list. Lowercase, like everything else. */
export function describeGoal(goal: Goal): string {
  switch (goal.kind) {
    case 'score':
      return `score ${goal.target.toLocaleString('en-US')}`;
    case 'lines':
      return `clear ${goal.target} lines`;
    case 'gems':
      return `collect ${goal.target} ${goal.target === 1 ? 'gem' : 'gems'}`;
    case 'stars':
      return `collect ${goal.target} ${goal.target === 1 ? 'star' : 'stars'}`;
    case 'combo':
      return `clear ${goal.target} lines at once`;
    case 'sweep':
      return goal.target === 1
        ? 'sweep the board clean'
        : `sweep the board clean ${goal.target} times`;
    case 'run':
      return `reach a run of ${goal.target}`;
    case 'tidy':
      return `get the board down to ${goal.target} blocks`;
  }
}

/** Compact form for the HUD chip: "gems 2/4". */
export function shortGoal(goal: Goal, state: GameState): string {
  const label: Record<GoalKind, string> = {
    score: 'score',
    lines: 'lines',
    gems: 'gems',
    stars: 'stars',
    combo: 'combo',
    sweep: 'sweep',
    run: 'run',
    tidy: 'tidy',
  };

  const raw = progressOf(goal, state);
  // A counting-down goal reads the other way round: "tidy 34→20", not "34/20",
  // which would look like you had overshot.
  const done = COUNTS_DOWN.has(goal.kind) ? raw : Math.min(raw, goal.target);
  const join = COUNTS_DOWN.has(goal.kind) ? '→' : '/';
  return `${label[goal.kind]} ${done.toLocaleString('en-US')}${join}${goal.target.toLocaleString('en-US')}`;
}
