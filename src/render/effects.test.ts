import { describe, expect, it } from 'vitest';
import { PRAISE, praiseFor, praiseIsHot } from './effects';

describe('praise ladder', () => {
  it('says nothing when nothing cleared', () => {
    expect(praiseFor(0, 0)).toBeNull();
    expect(praiseFor(0, 5)).toBeNull();
  });

  it('says something for every clear, including a plain single', () => {
    // The common case used to be silent, which is why clearing felt like
    // nothing was happening. The bottom rung has to exist for the climb to read.
    expect(praiseFor(1, 1)).toBe('NICE');
    expect(praiseFor(1, 0)).toBe('NICE');
  });

  it('escalates with the number of lines', () => {
    expect(praiseFor(2, 1)).toBe('SWEET');
    expect(praiseFor(3, 1)).toBe('BIG WIN');
    expect(praiseFor(4, 1)).toBe('HUGE');
    expect(praiseFor(5, 1)).toBe('MEGA WIN');
  });

  it('escalates with the run, so a streak earns it too', () => {
    expect(praiseFor(1, 2)).toBe('SWEET');
    expect(praiseFor(1, 3)).toBe('BIG WIN');
    expect(praiseFor(1, 4)).toBe('HUGE');
    expect(praiseFor(1, 6)).toBe('JACKPOT');
  });

  it('goes gold early — the ladder is about how much, not whether', () => {
    // The bottom two rungs stay bone so the climb has somewhere to start from,
    // and everything above them is hot.
    expect(praiseIsHot(1, 1)).toBe(false);
    expect(praiseIsHot(2, 1)).toBe(false);
    expect(praiseIsHot(3, 1)).toBe(true);
    expect(praiseIsHot(5, 1)).toBe(true);
    expect(praiseIsHot(1, 6)).toBe(true);
  });

  it('tops out rather than running off the end of the list', () => {
    expect(praiseFor(5, 20)).toBe(PRAISE[PRAISE.length - 1]);
    expect(praiseFor(9, 99)).toBe('LEGENDARY');
  });
});
