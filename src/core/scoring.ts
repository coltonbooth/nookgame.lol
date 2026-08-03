// Scoring, exactly as specified. Kept in one file so the numbers are tunable
// in one place and testable without touching the reducer.

export const MAX_RUN_MULTIPLIER = 10;

/**
 * What one star is worth before the multiplier. Stars ride the run multiplier
 * along with the line bonus, which is the whole point of them: holding a star
 * back until you are mid-run is worth up to ten times cashing it in cold.
 */
export const STAR_BONUS = 60;

/**
 * Lines it takes to fill the jackpot meter, and what it pays when it does.
 *
 * The meter is the game's anticipation mechanic. Points arrive constantly and
 * are therefore cheap; a bank that visibly fills across a whole run, that you
 * can watch getting close, and that goes off with everything the machine has
 * is the thing players actually chase. It is deliberately slow — roughly one
 * payout every couple of minutes — because a jackpot you hit every deal is not
 * a jackpot, it is a line bonus with a louder sound.
 *
 * The payout rides the run multiplier, so the real skill expression is arriving
 * at a full meter *hot* rather than cold: 500 against ×10 is 5,000, and that
 * single decision is worth more than the rest of the run around it.
 */
export const JACKPOT_FULL = 12;
export const JACKPOT_PAYOUT = 500;

/** At or above this the meter is close enough to start the riser. */
const JACKPOT_NEAR = JACKPOT_FULL - 2;

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
 */
export const lineBonus = (linesCleared: number): number =>
  10 * linesCleared * (linesCleared + 1);

/**
 * `run` is the number of consecutive clearing placements, counted *after* this
 * placement. Capped so late-game scores don't run away entirely.
 *
 * A whole point per step, topping out at ×10. The old ramp was three-quarters
 * of a point to a ceiling of ×5, which is a perfectly sensible curve for a
 * quiet game and far too polite for this one: the multiplier is the most
 * exciting number on the plate and it needs somewhere to climb to. Whole steps
 * also mean every total is an integer for free, which the old quarter-steps
 * only managed because every line bonus was carefully divisible by four.
 */
export const runMultiplier = (run: number): number =>
  run <= 0 ? 1 : Math.min(1 + run, MAX_RUN_MULTIPLIER);

export interface RunState {
  readonly run: number;
  /** Placements that may clear nothing before the run starts decaying. */
  readonly grace: number;
  /** Lines banked toward the next jackpot, 0…`JACKPOT_FULL`. */
  readonly jackpot: number;
}

/** A run's worth of accumulators, all at zero. */
export const EMPTY_RUN: RunState = { run: 0, grace: RUN_GRACE, jackpot: 0 };

/** Close enough to a payout that the machine should start making noise. */
export const jackpotReady = (jackpot: number): boolean =>
  jackpot >= JACKPOT_NEAR;

/**
 * The next run given the current one and whether this placement cleared.
 *
 * A non-clearing placement spends the grace first and only then steps the run
 * *down* — never wiping it. The reset originally specified made big
 * combinations strictly irrational: clearing one line a turn for five turns
 * out-paid spending three turns arranging a triple. Players could feel the game
 * only ever gave them singles, and they were right; the scoring was telling
 * them to take the drip. Grace plus a gentle decay makes setting up cost
 * roughly nothing, so a combination pays for the turns it took to build.
 *
 * The jackpot meter is deliberately *not* subject to any of that. It only ever
 * goes up, because a bank you can lose is a bank you stop watching.
 */
export const advanceRun = (
  { run, grace, jackpot }: RunState,
  linesCleared: number,
): RunState => {
  const banked = jackpot + linesCleared;
  if (linesCleared > 0) return { run: run + 1, grace: RUN_GRACE, jackpot: banked };
  if (grace > 0) return { run, grace: grace - 1, jackpot: banked };
  return { run: Math.max(0, run - 1), grace: 0, jackpot: banked };
};

export interface TurnScore {
  readonly placement: number;
  readonly bonus: number;
  readonly stars: number;
  readonly multiplier: number;
  /** The meter filled on this placement. */
  readonly jackpotFired: boolean;
  /** What the payout was worth, multiplier included. Zero unless it fired. */
  readonly jackpotBonus: number;
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
  const advanced = advanceRun(state, linesCleared);
  const placement = placementPoints(cellsInPiece);
  const bonus = lineBonus(linesCleared);
  const stars = STAR_BONUS * starsCleared;
  const multiplier = runMultiplier(advanced.run);

  // Overflow carries rather than evaporating: a triple that takes the meter
  // from 10 to 13 leaves one line already banked toward the next one. Losing it
  // would quietly punish exactly the big clears the meter is there to reward.
  const jackpotFired = advanced.jackpot >= JACKPOT_FULL;
  const next: RunState = jackpotFired
    ? { ...advanced, jackpot: advanced.jackpot - JACKPOT_FULL }
    : advanced;
  const jackpotBonus = jackpotFired ? JACKPOT_PAYOUT * multiplier : 0;

  return {
    placement,
    bonus,
    stars,
    multiplier,
    jackpotFired,
    jackpotBonus,
    total: placement + (bonus + stars) * multiplier + jackpotBonus,
    next,
  };
}
