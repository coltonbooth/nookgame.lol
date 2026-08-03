import { describe, expect, it } from 'vitest';
import { boardFromRows, popcount } from './board';
import { EMPTY_STATS, type GameState } from './game';
import {
  describeGoal,
  goalMet,
  goalsFor,
  levelFor,
  progressOf,
  shortGoal,
  targetFor,
  type GoalKind,
} from './levels';

const KINDS: GoalKind[] = [
  'score',
  'lines',
  'gems',
  'stars',
  'combo',
  'sweep',
  'run',
  'tidy',
];

/** Just enough state for the progress readers. */
const stateWith = (over: Partial<GameState> = {}): GameState =>
  ({
    board: 0n,
    score: 0,
    stats: EMPTY_STATS,
    ...over,
  }) as GameState;

describe('the ladder keeps differentiating', () => {
  // The failure this guards against: past ~level 28 every dial was pinned
  // except the score target, so level 30 and level 300 were the same puzzle
  // with a bigger number attached.
  it('does not hand out identical goal sets deep in the ladder', () => {
    const signature = (n: number): string =>
      goalsFor(n)
        .map((g) => `${g.kind}:${g.target}`)
        .sort()
        .join('|');

    const seen = new Set<string>();
    for (let n = 30; n <= 90; n++) seen.add(signature(n));
    // Sixty levels should not collapse into a handful of distinct puzzles.
    expect(seen.size).toBeGreaterThan(40);
  });

  it('keeps raising collect targets past the old cap of 12', () => {
    expect(targetFor('gems', 28)).toBeGreaterThan(11);
    expect(targetFor('gems', 60)).toBeGreaterThan(targetFor('gems', 30));
  });

  it('asks for a bigger combo once a triple is routine', () => {
    expect(targetFor('combo', 10)).toBe(2);
    expect(targetFor('combo', 20)).toBe(3);
    expect(targetFor('combo', 50)).toBe(4);
  });

  it('asks for four goals only once the ladder is deep', () => {
    expect(goalsFor(1)).toHaveLength(1);
    expect(goalsFor(8)).toHaveLength(2);
    expect(goalsFor(20)).toHaveLength(3);
    expect(goalsFor(40)).toHaveLength(4);
  });

  it('never repeats a goal kind within a level', () => {
    for (let n = 1; n <= 120; n++) {
      const kinds = goalsFor(n).map((g) => g.kind);
      expect(new Set(kinds).size).toBe(kinds.length);
    }
  });

  it('always includes a goal that cannot stall out', () => {
    for (let n = 1; n <= 120; n++) {
      const kinds = goalsFor(n).map((g) => g.kind);
      expect(kinds.includes('score') || kinds.includes('lines')).toBe(true);
    }
  });

  it('is a pure function of the level number', () => {
    expect(levelFor(37)).toEqual(levelFor(37));
    expect(levelFor(37)).not.toEqual(levelFor(38));
  });
});

describe('goal progress', () => {
  it('reads the run streak', () => {
    const state = stateWith({ stats: { ...EMPTY_STATS, bestRun: 4 } });
    expect(progressOf({ kind: 'run', target: 3 }, state)).toBe(4);
    expect(goalMet({ kind: 'run', target: 3 }, state)).toBe(true);
    expect(goalMet({ kind: 'run', target: 5 }, state)).toBe(false);
  });

  it('meets a tidy goal by going down, not up', () => {
    const board = boardFromRows([
      '####....',
      '........',
      '........',
      '........',
      '........',
      '........',
      '........',
      '........',
    ]);
    const state = stateWith({ board });
    expect(popcount(board)).toBe(4);
    // Four blocks on the board clears a "get down to 10" goal...
    expect(goalMet({ kind: 'tidy', target: 10 }, state)).toBe(true);
    // ...and fails a "get down to 2" one.
    expect(goalMet({ kind: 'tidy', target: 2 }, state)).toBe(false);
  });

  it('shows a counting-down goal as an arrow rather than a fraction', () => {
    const state = stateWith({ board: boardFromRows(['###.....', ...Array(7).fill('........')]) });
    expect(shortGoal({ kind: 'tidy', target: 10 }, state)).toBe('tidy 3→10');
  });
});

describe('copy', () => {
  it('describes every goal kind', () => {
    for (const kind of KINDS) {
      const text = describeGoal({ kind, target: targetFor(kind, 20) });
      expect(text.length).toBeGreaterThan(0);
      expect(text).toBe(text.toLowerCase());
    }
  });

  it('pluralises a multi-sweep goal', () => {
    expect(describeGoal({ kind: 'sweep', target: 1 })).toBe(
      'sweep the board clean',
    );
    expect(describeGoal({ kind: 'sweep', target: 2 })).toBe(
      'sweep the board clean 2 times',
    );
  });
});
