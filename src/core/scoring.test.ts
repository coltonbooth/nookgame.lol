import { describe, expect, it } from 'vitest';
import {
  MAX_RUN_MULTIPLIER,
  RUN_GRACE,
  advanceRun,
  lineBonus,
  placementPoints,
  runMultiplier,
  scoreTurn,
  type RunState,
} from './scoring';

/** A run of `n` with a full grace allowance. */
const at = (run: number, grace = RUN_GRACE): RunState => ({ run, grace });

describe('lineBonus', () => {
  it('matches the specified table', () => {
    expect(lineBonus(0)).toBe(0);
    expect(lineBonus(1)).toBe(20);
    expect(lineBonus(2)).toBe(60);
    expect(lineBonus(3)).toBe(120);
    expect(lineBonus(4)).toBe(200);
    expect(lineBonus(5)).toBe(300);
  });

  it('pays more for one big clear than for the same lines taken one at a time', () => {
    // The whole reason combinations exist. If this ever inverts, the scoring
    // is telling players to take the drip and they will.
    expect(lineBonus(2)).toBeGreaterThan(2 * lineBonus(1));
    expect(lineBonus(3)).toBeGreaterThan(3 * lineBonus(1));
  });
});

describe('runMultiplier', () => {
  it('pays from the very first clear of a streak', () => {
    expect(runMultiplier(0)).toBe(1);
    expect(runMultiplier(1)).toBe(1.75);
    expect(runMultiplier(2)).toBe(2.5);
    expect(runMultiplier(3)).toBe(3.25);
    expect(runMultiplier(4)).toBe(4);
  });

  it('caps at a streak a player could actually hold', () => {
    expect(runMultiplier(6)).toBe(MAX_RUN_MULTIPLIER);
    expect(runMultiplier(50)).toBe(MAX_RUN_MULTIPLIER);
  });
});

describe('advanceRun', () => {
  it('increments on any clear and refills the grace', () => {
    expect(advanceRun(at(0), 1)).toEqual({ run: 1, grace: RUN_GRACE });
    expect(advanceRun({ run: 3, grace: 0 }, 2)).toEqual({
      run: 4,
      grace: RUN_GRACE,
    });
  });

  it('spends grace before decaying, so a setup turn is free', () => {
    const setup = advanceRun(at(4), 0);
    expect(setup.run).toBe(4);
    expect(setup.grace).toBe(0);
  });

  it('decays by one once the grace is spent, and never wipes', () => {
    expect(advanceRun({ run: 7, grace: 0 }, 0)).toEqual({ run: 6, grace: 0 });
    expect(advanceRun({ run: 1, grace: 0 }, 0)).toEqual({ run: 0, grace: 0 });
    expect(advanceRun({ run: 0, grace: 0 }, 0)).toEqual({ run: 0, grace: 0 });
  });

  it('makes a one-turn setup for a double beat cashing two singles', () => {
    // Two turns either way. Cash a single now and another next turn...
    const drip = scoreTurn(4, 1, at(1)).total + scoreTurn(4, 1, at(2)).total;
    // ...or spend a turn arranging and take the double. The grace is what
    // makes this work: the setup turn costs no multiplier.
    const setup = scoreTurn(4, 0, at(1));
    const combo = setup.total + scoreTurn(4, 2, setup.next).total;
    expect(combo).toBeGreaterThan(drip);
  });
});

describe('scoreTurn', () => {
  it('scores one point per cell when nothing clears', () => {
    expect(placementPoints(5)).toBe(5);
    const turn = scoreTurn(5, 0, { run: 4, grace: 0 });
    expect(turn.total).toBe(5);
    expect(turn.next.run).toBe(3); // decayed, not wiped
  });

  it('applies the multiplier to the bonus only, not the placement', () => {
    // 4 cells, 2 lines, run was 1 -> run becomes 2 -> x2.5 on a 60 bonus.
    const turn = scoreTurn(4, 2, at(1));
    expect(turn.next.run).toBe(2);
    expect(turn.multiplier).toBe(2.5);
    expect(turn.total).toBe(4 + 150);
  });

  it('keeps totals integral at every multiplier step', () => {
    for (let run = 0; run <= 12; run++) {
      for (let lines = 1; lines <= 5; lines++) {
        for (let stars = 0; stars <= 3; stars++) {
          const turn = scoreTurn(3, lines, at(run), stars);
          expect(Number.isInteger(turn.total)).toBe(true);
        }
      }
    }
  });
});
