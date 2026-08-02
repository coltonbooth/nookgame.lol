import { describe, expect, it } from 'vitest';
import { PRAISE, praiseFor } from './effects';

describe('praise ladder', () => {
  it('says nothing for a plain single clear', () => {
    // Praising every clear devalues the praise.
    expect(praiseFor(1, 1)).toBeNull();
    expect(praiseFor(0, 0)).toBeNull();
  });

  it('escalates with the number of lines', () => {
    expect(praiseFor(2, 1)).toBe('nice');
    expect(praiseFor(3, 1)).toBe('great');
    expect(praiseFor(4, 1)).toBe('wow');
    expect(praiseFor(5, 1)).toBe('amazing');
  });

  it('escalates with the run, so a streak earns it too', () => {
    expect(praiseFor(1, 2)).toBe('nice');
    expect(praiseFor(1, 3)).toBe('great');
    expect(praiseFor(1, 4)).toBe('wow');
    expect(praiseFor(1, 6)).toBe('unbelievable');
  });

  it('tops out rather than running off the end of the list', () => {
    expect(praiseFor(5, 20)).toBe(PRAISE[PRAISE.length - 1]);
    expect(praiseFor(9, 99)).toBe('legendary');
  });
});
