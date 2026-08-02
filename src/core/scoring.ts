// Scoring, exactly as specified. Kept in one file so the numbers are tunable
// in one place and testable without touching the reducer.

export const MAX_RUN_MULTIPLIER = 5;

/**
 * What one star is worth before the multiplier. Stars ride the run multiplier
 * along with the line bonus, which is the whole point of them: holding a star
 * back until you are mid-run is worth up to five times cashing it in cold.
 */
export const STAR_BONUS = 50;

/** 1 point per cell of the placed piece. */
export const placementPoints = (cellsInPiece: number): number => cellsInPiece;

/** 1→10, 2→30, 3→60, 4→100, 5→150. */
export const lineBonus = (linesCleared: number): number =>
  (10 * linesCleared * (linesCleared + 1)) / 2;

/**
 * `run` is the number of consecutive placements that each cleared at least one
 * line, counted *after* this placement. Capped so late-game scores don't run
 * away.
 */
export const runMultiplier = (run: number): number =>
  run <= 0 ? 1 : Math.min(1 + 0.5 * (run - 1), MAX_RUN_MULTIPLIER);

/**
 * The next run value given the current one and whether this placement cleared.
 *
 * A non-clearing placement steps the run *down* rather than wiping it, and
 * that is a deliberate departure from `plan.md` §1, which specifies a reset
 * to zero. The reset made big combinations strictly irrational: clearing one
 * line a turn for five turns pays 10+15+20+25+30 = 100, while spending three
 * turns arranging a triple zeroes the run and pays 60. Players could feel that
 * the game only ever gave them singles and doubles, and they were right — the
 * scoring was telling them to take the drip.
 *
 * Decaying by one makes setting up cost a few steps instead of everything, so
 * a combination can pay for the turns it took to build.
 */
export const advanceRun = (run: number, linesCleared: number): number =>
  linesCleared > 0 ? run + 1 : Math.max(0, run - 1);

export interface TurnScore {
  readonly placement: number;
  readonly bonus: number;
  readonly stars: number;
  readonly multiplier: number;
  readonly total: number;
  readonly nextRun: number;
}

/**
 * Score one placement. `run` is the value *before* this placement; the returned
 * `nextRun` is the value after. `starsCleared` counts only stars — gems buy the
 * Nook rather than points, so they are never passed in here.
 */
export function scoreTurn(
  cellsInPiece: number,
  linesCleared: number,
  run: number,
  starsCleared = 0,
): TurnScore {
  const nextRun = advanceRun(run, linesCleared);
  const placement = placementPoints(cellsInPiece);
  const bonus = lineBonus(linesCleared);
  const stars = STAR_BONUS * starsCleared;
  const multiplier = runMultiplier(nextRun);
  return {
    placement,
    bonus,
    stars,
    multiplier,
    total: placement + (bonus + stars) * multiplier,
    nextRun,
  };
}
