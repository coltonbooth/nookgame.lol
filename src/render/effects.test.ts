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
    expect(praiseFor(1, 1)).toBe('nice');
    expect(praiseFor(1, 0)).toBe('nice');
  });

  it('escalates with the number of lines', () => {
    expect(praiseFor(2, 1)).toBe('sweet');
    expect(praiseFor(3, 1)).toBe('great');
    expect(praiseFor(4, 1)).toBe('wow');
    expect(praiseFor(5, 1)).toBe('AMAZING');
  });

  it('escalates with the run, so a streak earns it too', () => {
    expect(praiseFor(1, 2)).toBe('sweet');
    expect(praiseFor(1, 3)).toBe('great');
    expect(praiseFor(1, 4)).toBe('wow');
    expect(praiseFor(1, 6)).toBe('UNBELIEVABLE');
  });

  it('starts shouting only once the clear has earned it', () => {
    expect(praiseIsHot(1, 1)).toBe(false);
    expect(praiseIsHot(2, 1)).toBe(false);
    expect(praiseIsHot(5, 1)).toBe(true);
    expect(praiseIsHot(1, 6)).toBe(true);
  });

  it('tops out rather than running off the end of the list', () => {
    expect(praiseFor(5, 20)).toBe(PRAISE[PRAISE.length - 1]);
    expect(praiseFor(9, 99)).toBe('LEGENDARY');
  });
});
