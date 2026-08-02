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

/** A piece landing. Barely there on purpose. */
export function tapPlace(): void {
  buzz(8);
}

/** Tucking into the Nook: softer still, and distinct from a placement. */
export function tapStash(): void {
  buzz([4, 30, 4]);
}

/**
 * A clear. Scales with how much came down, because the whole point is that
 * a four-line sweep should feel different from a single row.
 */
export function tapClear(lines: number): void {
  if (lines <= 0) return;
  if (lines === 1) return buzz(18);
  if (lines === 2) return buzz([14, 40, 22]);
  return buzz([16, 36, 20, 36, 30]);
}

/** Swept clean — rare enough to deserve its own signature. */
export function tapSweptClean(): void {
  buzz([20, 50, 20, 50, 60]);
}

/** The alcove opening. One firm knock. */
export function tapUnlock(): void {
  buzz([30, 60, 45]);
}
