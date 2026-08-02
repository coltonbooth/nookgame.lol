// Today's Nook: the day itself is the seed.
//
// No backend, no sync, no clock skew to worry about — the seed is a pure
// function of the local date, so everyone playing on the same calendar day gets
// the same starting stream. This file owns the impurity (reading the clock) so
// that `core/` never has to.

import { hashString, type RngState } from '../core/rng';

/**
 * Day #1. Arbitrary, but it must never move: change it and every historical
 * result someone has shared silently refers to a different puzzle.
 */
const EPOCH = Date.UTC(2026, 0, 10);
const DAY_MS = 86_400_000;

/** Local calendar date as YYYY-MM-DD. Local, so the day turns over at midnight
 *  where the player actually is. */
export function dateKey(date = new Date()): string {
  const y = date.getFullYear();
  const m = `${date.getMonth() + 1}`.padStart(2, '0');
  const d = `${date.getDate()}`.padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** The seed for a given day. A pure function of the date string. */
export const seedForDate = (key: string): RngState => hashString(key);

export const todaySeed = (date = new Date()): RngState =>
  seedForDate(dateKey(date));

/** The number in "Nook #204". Counts calendar days from the epoch. */
export function dayNumber(date = new Date()): number {
  const local = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  return Math.floor((local - EPOCH) / DAY_MS) + 1;
}
