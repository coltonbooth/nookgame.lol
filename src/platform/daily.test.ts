import { describe, expect, it } from 'vitest';
import { dateKey, dayNumber, seedForDate, todaySeed } from './daily';

describe('dateKey', () => {
  it('formats the local date, zero-padded', () => {
    expect(dateKey(new Date(2026, 7, 1))).toBe('2026-08-01');
    expect(dateKey(new Date(2026, 11, 25))).toBe('2026-12-25');
  });

  it('uses the local day, not UTC', () => {
    // Late evening local time is already tomorrow in UTC for many zones; the
    // day has to turn over at midnight where the player is.
    const late = new Date(2026, 7, 1, 23, 30);
    expect(dateKey(late)).toBe('2026-08-01');
  });
});

describe('seedForDate', () => {
  it('is a pure function of the date, and differs day to day', () => {
    expect(seedForDate('2026-08-01')).toBe(seedForDate('2026-08-01'));
    expect(seedForDate('2026-08-01')).not.toBe(seedForDate('2026-08-02'));
  });

  it('agrees with todaySeed for the same date', () => {
    const date = new Date(2026, 7, 1, 9, 0);
    expect(todaySeed(date)).toBe(seedForDate('2026-08-01'));
  });
});

describe('dayNumber', () => {
  it('counts calendar days from the epoch', () => {
    expect(dayNumber(new Date(2026, 0, 10))).toBe(1);
    expect(dayNumber(new Date(2026, 0, 11))).toBe(2);
    expect(dayNumber(new Date(2026, 7, 1))).toBe(204);
  });

  it('does not move within a day', () => {
    expect(dayNumber(new Date(2026, 7, 1, 0, 1))).toBe(
      dayNumber(new Date(2026, 7, 1, 23, 59)),
    );
  });

  it('advances by exactly one across a month boundary', () => {
    const last = dayNumber(new Date(2026, 6, 31));
    expect(dayNumber(new Date(2026, 7, 1))).toBe(last + 1);
  });
});
