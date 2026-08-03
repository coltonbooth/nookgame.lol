// Rearrange: one rotating rule modifier, live for seven days.
//
// One slot, rotating, rather than a menu of permanent variants — a menu
// fragments the players across a dozen half-dead modes, where a single weekly
// slot means everyone is playing the same odd version of the game at the same
// time, and it is worth coming back on Monday to see what changed.
//
// Every mutator here is a rule the core already understands how to enforce.
// The two from the design doc that are *not* here — Cascade (needs gravity) and
// Big Nook (a 9x9 board breaks the 64-bit bitboard and every precomputed
// placement table) — are structural rewrites rather than weekly modifiers.

import { PIECES, type PieceId } from './pieces';

export type Mutator = 'spare' | 'fog' | 'charged';

export const MUTATORS: readonly Mutator[] = ['spare', 'fog', 'charged'];

/** Whole weeks since the epoch. Same derivation as the daily's day number. */
export const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** Which mutator is live in a given week. Pure, so everyone agrees. */
export function mutatorForWeek(week: number): Mutator {
  const index = ((week % MUTATORS.length) + MUTATORS.length) % MUTATORS.length;
  return MUTATORS[index]!;
}

export function describeMutator(m: Mutator): string {
  switch (m) {
    case 'spare':
      return 'spare — no singles, no dominoes. nothing small to bail you out.';
    case 'fog':
      return 'fog — the third piece stays hidden until you have placed the other two.';
    case 'charged':
      return 'charged — every marker is a flame. clear a line through one and the 3x3 around it burns too.';
  }
}

export function mutatorName(m: Mutator): string {
  return m;
}

/**
 * Spare: the small pieces are gone from the bag entirely.
 *
 * The 1x1 is described in the catalogue as "a get-out-of-jail card, not a
 * crutch". Spare is the week you find out how much of a crutch it was.
 */
const SPARE_MIN_SIZE = 3;

export function allowsPiece(m: Mutator | null, id: PieceId): boolean {
  if (m !== 'spare') return true;
  return (PIECES[id]?.size ?? 0) >= SPARE_MIN_SIZE;
}

/**
 * Charged: every marker dealt is a flame, and they come far more often than
 * the one-in-twelve of an ordinary run.
 *
 * This is the week the board becomes demolition rather than tetris — you stop
 * playing for lines and start playing to land charges on your worst cluster.
 */
export const CHARGED_MARKER_ONE_IN = 4;

/** Fog hides this tray slot until the others have been played. */
export const FOG_SLOT = 2;

/**
 * Under fog, is this tray slot still hidden? Hidden means "drawn as a shape
 * you cannot read", not "unplayable" — the piece is real and placeable, you
 * simply cannot plan around it, which is the entire point.
 */
export function fogHides(
  m: Mutator | null,
  index: number,
  tray: ReadonlyArray<unknown | null>,
): boolean {
  if (m !== 'fog' || index !== FOG_SLOT) return false;
  // Revealed once the other two slots are empty.
  return tray.some((slot, i) => i !== FOG_SLOT && slot !== null);
}
