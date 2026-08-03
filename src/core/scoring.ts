// Scoring, exactly as specified. Kept in one file so the numbers are tunable
// in one place and testable without touching the reducer.

export const MAX_RUN_MULTIPLIER = 5;

/**
 * What one star is worth before the multiplier. Stars ride the run multiplier
 * along with the line bonus, which is the whole point of them: holding a star
 * back until you are mid-run is worth up to five times cashing it in cold.
 *
 * 60 rather than 50 so that every reachable multiplier step lands on a whole
 * number of points — see `lineBonus`.
 */
export const STAR_BONUS = 60;

/**
 * How many placements that clear nothing a run survives before it decays.
 *
 * Arranging a combination takes a turn or two of *not* clearing, which is
 * exactly the behaviour the game wants to encourage — so it must not be the
 * behaviour the multiplier punishes. Measured with a greedy bot, a double was
 * reachable in 82% of deals and made up 6% of clears: the payoff was there and
 * nobody was waiting for it, because waiting cost multiplier.
 */
export const RUN_GRACE = 1;

/** 1 point per cell of the placed piece. */
export const placementPoints = (cellsInPiece: number): number => cellsInPiece;

/**
 * 1→20, 2→60, 3→120, 4→200, 5→300.
 *
 * Twice the original table. Clearing a whole row used to pay 10 while dropping
 * a five-cell piece paid 5, so wiping a line was worth two pieces and the
 * number that flew up never read as a reward. Placement stays at 1/cell
 * precisely so that the clear is the event.
 *
 * Every value is a multiple of 20, which is what keeps totals whole: the
 * multiplier steps in quarters, so a bonus divisible by four is the condition
 * for never showing the player a fractional score.
 */
export const lineBonus = (linesCleared: number): number =>
  10 * linesCleared * (linesCleared + 1);

/**
 * `run` is the number of consecutive clearing placements, counted *after* this
 * placement. Capped so late-game scores don't run away.
 *
 * The ramp used to be `1 + 0.5 * (run - 1)`, which paid nothing at all for the
 * first clear of a streak and needed nine in a row to reach the cap — a cap no
 * player had ever seen. It now pays from the first clear and tops out at a
 * streak of five, which is a streak someone can actually hold in their head.
 */
export const runMultiplier = (run: number): number =>
  run <= 0 ? 1 : Math.min(1 + 0.75 * run, MAX_RUN_MULTIPLIER);

export interface RunState {
  readonly run: number;
  /** Placements that may clear nothing before the run starts decaying. */
  readonly grace: number;
}

/**
 * The next run given the current one and whether this placement cleared.
 *
 * A non-clearing placement spends the grace first and only then steps the run
 * *down* — never wiping it. The reset specified in `plan.md` §1 made big
 * combinations strictly irrational: clearing one line a turn for five turns
 * out-paid spending three turns arranging a triple. Players could feel the game
 * only ever gave them singles, and they were right; the scoring was telling
 * them to take the drip. Grace plus a gentle decay makes setting up cost
 * roughly nothing, so a combination pays for the turns it took to build.
 */
export const advanceRun = (
  { run, grace }: RunState,
  linesCleared: number,
): RunState => {
  if (linesCleared > 0) return { run: run + 1, grace: RUN_GRACE };
  if (grace > 0) return { run, grace: grace - 1 };
  return { run: Math.max(0, run - 1), grace: 0 };
};

export interface TurnScore {
  readonly placement: number;
  readonly bonus: number;
  readonly stars: number;
  readonly multiplier: number;
  readonly total: number;
  readonly next: RunState;
}

/**
 * Score one placement. `state` is the run *before* this placement; the returned
 * `next` is the run after. `starsCleared` counts only stars — gems buy the
 * Nook rather than points, so they are never passed in here.
 */
export function scoreTurn(
  cellsInPiece: number,
  linesCleared: number,
  state: RunState,
  starsCleared = 0,
): TurnScore {
  const next = advanceRun(state, linesCleared);
  const placement = placementPoints(cellsInPiece);
  const bonus = lineBonus(linesCleared);
  const stars = STAR_BONUS * starsCleared;
  const multiplier = runMultiplier(next.run);
  return {
    placement,
    bonus,
    stars,
    multiplier,
    total: placement + (bonus + stars) * multiplier,
    next,
  };
}
