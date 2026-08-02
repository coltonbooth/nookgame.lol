import { describe, expect, it } from 'vitest';
import { hashString, nextFloat, nextInt, nextU32, weightedPick } from './rng';

describe('mulberry32', () => {
  it('is a pure function of its state', () => {
    expect(nextU32(12345)).toEqual(nextU32(12345));
    expect(nextU32(12345)[0]).not.toBe(nextU32(12346)[0]);
  });

  it('produces floats in [0, 1)', () => {
    let state = 7;
    for (let i = 0; i < 5000; i++) {
      const [v, next] = nextFloat(state);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
      state = next;
    }
  });

  it('stays inside the requested integer bound', () => {
    let state = 99;
    const seen = new Set<number>();
    for (let i = 0; i < 5000; i++) {
      const [v, next] = nextInt(state, 6);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(6);
      seen.add(v);
      state = next;
    }
    expect(seen.size).toBe(6);
  });

  it('does not cycle within a run length we care about', () => {
    const seen = new Set<number>();
    let state = 1;
    for (let i = 0; i < 20000; i++) {
      seen.add(state);
      state = nextU32(state)[1];
    }
    expect(seen.size).toBe(20000);
  });
});

describe('weightedPick', () => {
  it('never picks a zero-weight index', () => {
    let state = 4242;
    for (let i = 0; i < 3000; i++) {
      const [k, next] = weightedPick(state, [0, 5, 0, 5]);
      expect(k === 1 || k === 3).toBe(true);
      state = next;
    }
  });

  it('respects the weights, roughly', () => {
    let state = 1;
    const counts = [0, 0, 0];
    for (let i = 0; i < 30000; i++) {
      const [k, next] = weightedPick(state, [1, 3, 6]);
      counts[k]! += 1;
      state = next;
    }
    expect(counts[0]! / 30000).toBeCloseTo(0.1, 1);
    expect(counts[1]! / 30000).toBeCloseTo(0.3, 1);
    expect(counts[2]! / 30000).toBeCloseTo(0.6, 1);
  });

  it('falls back to uniform when everything is banned', () => {
    const [k] = weightedPick(5, [0, 0, 0]);
    expect(k).toBeGreaterThanOrEqual(0);
    expect(k).toBeLessThan(3);
  });
});

describe('hashString', () => {
  it('gives distinct seeds for adjacent dates', () => {
    const a = hashString('2026-08-01');
    const b = hashString('2026-08-02');
    expect(a).not.toBe(b);
    expect(hashString('2026-08-01')).toBe(a);
    expect(a).toBeGreaterThanOrEqual(0);
  });
});
