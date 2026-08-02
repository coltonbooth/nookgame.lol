import { describe, expect, it } from 'vitest';
import {
  MAX_RUN_MULTIPLIER,
  advanceRun,
  lineBonus,
  placementPoints,
  runMultiplier,
  scoreTurn,
} from './scoring';

describe('lineBonus', () => {
  it('matches the specified table', () => {
    expect(lineBonus(0)).toBe(0);
    expect(lineBonus(1)).toBe(10);
    expect(lineBonus(2)).toBe(30);
    expect(lineBonus(3)).toBe(60);
    expect(lineBonus(4)).toBe(100);
    expect(lineBonus(5)).toBe(150);
  });
});

describe('runMultiplier', () => {
  it('starts at 1 and steps by half', () => {
    expect(runMultiplier(0)).toBe(1);
    expect(runMultiplier(1)).toBe(1);
    expect(runMultiplier(2)).toBe(1.5);
    expect(runMultiplier(3)).toBe(2);
    expect(runMultiplier(4)).toBe(2.5);
  });

  it('caps so late-game scores cannot run away', () => {
    expect(runMultiplier(9)).toBe(MAX_RUN_MULTIPLIER);
    expect(runMultiplier(50)).toBe(MAX_RUN_MULTIPLIER);
  });
});

describe('advanceRun', () => {
  it('increments on any clear', () => {
    expect(advanceRun(0, 1)).toBe(1);
    expect(advanceRun(3, 2)).toBe(4);
  });

  it('decays by one on a placement that clears nothing', () => {
    // Not a reset: a reset makes building a combination cost more than it
    // pays, so players only ever see singles.
    expect(advanceRun(7, 0)).toBe(6);
    expect(advanceRun(1, 0)).toBe(0);
    expect(advanceRun(0, 0)).toBe(0);
  });

  it('lets a three-turn setup keep most of a streak', () => {
    let run = 6;
    for (let i = 0; i < 3; i++) run = advanceRun(run, 0);
    expect(run).toBe(3);
    expect(runMultiplier(advanceRun(run, 3))).toBe(2.5);
  });
});

describe('scoreTurn', () => {
  it('scores one point per cell when nothing clears', () => {
    expect(placementPoints(5)).toBe(5);
    const turn = scoreTurn(5, 0, 4);
    expect(turn.total).toBe(5);
    expect(turn.nextRun).toBe(3); // decayed, not wiped
  });

  it('applies the multiplier to the bonus only, not the placement', () => {
    // 4 cells, 2 lines, run was 1 -> run becomes 2 -> x1.5 on a 30 bonus.
    const turn = scoreTurn(4, 2, 1);
    expect(turn.nextRun).toBe(2);
    expect(turn.multiplier).toBe(1.5);
    expect(turn.total).toBe(4 + 45);
  });

  it('keeps totals integral at every multiplier step', () => {
    for (let run = 0; run <= 12; run++) {
      for (let lines = 1; lines <= 5; lines++) {
        expect(Number.isInteger(scoreTurn(3, lines, run).total)).toBe(true);
      }
    }
  });
});
