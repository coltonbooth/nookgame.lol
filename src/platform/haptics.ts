// Vibration, treated strictly as a bonus.
//
// **iOS Safari does not support the Vibration API at all.** Nothing here will
// fire on an iPhone, and that is expected — never build a mechanic that
// depends on feeling it. Android Chrome gets the full treatment.

let enabled = true;

const supported = (): boolean =>
  typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';

function buzz(pattern: number | number[]): void {
  if (!enabled || !supported()) return;
  try {
    navigator.vibrate(pattern);
  } catch {
    // Some browsers throw if the document hasn't been interacted with yet.
  }
}

/** Turn haptics off — for a settings toggle, or a player who finds it fussy. */
export function setHapticsEnabled(value: boolean): void {
  enabled = value;
}

export const hapticsAvailable = supported;

/** A piece landing. The quietest thing here, and still a real knock. */
export function tapPlace(): void {
  buzz(16);
}

/** Tucking into the Nook: a double tick, distinct from a placement. */
export function tapStash(): void {
  buzz([10, 26, 10]);
}

/**
 * A clear. Scales with how much came down, because the whole point is that
 * a four-line sweep should feel different from a single row.
 */
export function tapClear(lines: number): void {
  if (lines <= 0) return;
  if (lines === 1) return buzz(32);
  if (lines === 2) return buzz([26, 34, 40]);
  return buzz([28, 30, 34, 30, 55]);
}

/** Swept clean — rare enough to deserve its own signature. */
export function tapSweptClean(): void {
  buzz([36, 40, 36, 40, 100]);
}

/**
 * The jackpot. The longest, hardest pattern in the game by a distance — the
 * payout has to be felt as categorically different from a good clear, not as a
 * slightly better one.
 */
export function tapJackpot(): void {
  buzz([60, 40, 40, 30, 40, 30, 40, 30, 60, 40, 140]);
}

/** The alcove opening. One firm knock. */
export function tapUnlock(): void {
  buzz([45, 50, 70]);
}

/**
 * Released somewhere illegal. A single blunt refusal — shorter and duller than
 * anything that pays, so the hand can tell "no" from "yes" without looking.
 */
export function tapInvalid(): void {
  buzz(20);
}

/** Nowhere left to put it. */
export function tapGameOver(): void {
  buzz([60, 70, 60, 70, 110]);
}
