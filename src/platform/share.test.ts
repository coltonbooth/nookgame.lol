import { describe, expect, it } from 'vitest';
import { EMPTY_STATS, type RunStats } from '../core/game';
import { shareText } from './share';

const stats = (over: Partial<RunStats> = {}): RunStats => ({
  ...EMPTY_STATS,
  ...over,
});

describe('shareText', () => {
  it('leads with the day and the score', () => {
    const text = shareText({
      day: 204,
      score: 12480,
      stats: stats({ linesCleared: 21 }),
    });
    expect(text.split('\n')[0]).toBe('Nook #204 — 12,480');
  });

  it('draws one square per deal, grouped in threes', () => {
    const text = shareText({
      day: 1,
      score: 100,
      stats: stats({ dealClears: [1, 1, 2, 0, 1, 3, 2, 2, 2, 1, 0] }),
    });
    expect(text.split('\n')[1]).toBe('🟦🟦🟪 ⬛🟦🟨 🟪🟪🟪 🟦⬛');
  });

  it('caps a very long run rather than wrapping forever', () => {
    const text = shareText({
      day: 1,
      score: 100,
      stats: stats({ dealClears: new Array(40).fill(1) }),
    });
    const grid = text.split('\n')[1]!;
    expect(grid.endsWith('…')).toBe(true);
    expect([...grid].filter((c) => c === '🟦').length).toBe(24);
  });

  it('reports the run and the sweeps in the game\'s own voice', () => {
    const text = shareText({
      day: 7,
      score: 900,
      stats: stats({
        bestRun: 8,
        sweptClean: 2,
        linesCleared: 30,
        dealClears: [1, 2, 0],
      }),
    });
    expect(text.split('\n')[2]).toBe(
      'longest run ×5 · swept clean twice · 30 lines',
    );
  });

  it('says nothing about a run that never happened', () => {
    const text = shareText({
      day: 7,
      score: 40,
      stats: stats({ bestRun: 1, sweptClean: 0, linesCleared: 1 }),
    });
    expect(text).not.toContain('longest run');
    expect(text).not.toContain('swept clean');
    expect(text).toContain('1 lines');
  });

  it('gives away nothing about the board', () => {
    const text = shareText({
      day: 3,
      score: 500,
      stats: stats({ dealClears: [2, 0, 1], linesCleared: 3 }),
    });
    // No coordinates, no piece names, no grid rows — just how it went.
    expect(text).not.toMatch(/[0-9]+,[0-9]+/);
    expect(text.split('\n')).toHaveLength(3);
  });
});
