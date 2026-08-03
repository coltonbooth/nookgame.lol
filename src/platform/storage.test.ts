import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearRun,
  dailyHistory,
  loadPrefs,
  loadRun,
  loadStreak,
  recordBest,
  recordDailyBest,
  recordLifetime,
  recordStreak,
  saveRun,
  savePrefs,
} from './storage';

// A minimal localStorage. The real one isn't available under node, and the
// module reads `window.localStorage` behind try/catch by design.
class MemoryStorage {
  private map = new Map<string, string>();
  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
  clear(): void {
    this.map.clear();
  }
  key(i: number): string | null {
    return [...this.map.keys()][i] ?? null;
  }
  get length(): number {
    return this.map.size;
  }
}

const store = new MemoryStorage();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).window = { localStorage: store };

beforeEach(() => store.clear());

describe('records', () => {
  it('reports what a new best beat, so it can be celebrated', () => {
    // The old version returned only the post-write value, so the panel printed
    // the same number twice and a record looked like an ordinary loss.
    expect(recordBest(500)).toEqual({ best: 500, previous: 0, isNew: false });
    expect(recordBest(900)).toEqual({ best: 900, previous: 500, isNew: true });
  });

  it('does not treat a first-ever score as beating a record', () => {
    expect(recordBest(120).isNew).toBe(false);
  });

  it('keeps the old value when a run falls short', () => {
    recordBest(900);
    expect(recordBest(400)).toEqual({ best: 900, previous: 900, isNew: false });
  });
});

describe('daily history', () => {
  it('reads back every day ever played, newest first', () => {
    recordDailyBest('2026-08-01', 100);
    recordDailyBest('2026-08-03', 300);
    recordDailyBest('2026-08-02', 200);
    expect(dailyHistory()).toEqual([
      { date: '2026-08-03', score: 300 },
      { date: '2026-08-02', score: 200 },
      { date: '2026-08-01', score: 100 },
    ]);
  });

  it('ignores keys that are not dates', () => {
    recordBest(999);
    recordDailyBest('2026-08-01', 100);
    expect(dailyHistory()).toHaveLength(1);
  });
});

describe('streak', () => {
  it('counts consecutive days', () => {
    expect(recordStreak('2026-08-01').count).toBe(1);
    expect(recordStreak('2026-08-02').count).toBe(2);
    expect(recordStreak('2026-08-03').count).toBe(3);
  });

  it('does not double-count a replayed day', () => {
    recordStreak('2026-08-01');
    expect(recordStreak('2026-08-01').count).toBe(1);
  });

  it('resets after a missed day', () => {
    recordStreak('2026-08-01');
    recordStreak('2026-08-02');
    expect(recordStreak('2026-08-05').count).toBe(1);
  });

  it('crosses a month boundary', () => {
    recordStreak('2026-07-31');
    expect(recordStreak('2026-08-01').count).toBe(2);
  });

  it('crosses a year boundary', () => {
    recordStreak('2026-12-31');
    expect(recordStreak('2027-01-01').count).toBe(2);
  });

  it('starts empty', () => {
    expect(loadStreak()).toEqual({ count: 0, last: '' });
  });
});

describe('lifetime stats', () => {
  it('accumulates across runs and keeps the best run', () => {
    recordLifetime({ lines: 10, placements: 40, sweeps: 1, bestRun: 3 });
    const total = recordLifetime({
      lines: 5,
      placements: 20,
      sweeps: 0,
      bestRun: 7,
    });
    expect(total).toEqual({
      games: 2,
      lines: 15,
      placements: 60,
      sweeps: 1,
      bestRun: 7,
    });
  });
});

describe('saved runs', () => {
  const run = {
    seed: 42,
    actions: [{ type: 'place', source: 'tray', index: 0, x: 0, y: 0 }],
    score: 120,
    mode: 'endless',
    fairDeal: false,
  };

  it('round-trips', () => {
    saveRun(run);
    expect(loadRun()).toMatchObject(run);
  });

  it('refuses a save from an incompatible build', () => {
    saveRun(run);
    store.setItem(
      'nook.run',
      JSON.stringify({ ...run, schema: 999 }),
    );
    expect(loadRun()).toBeNull();
  });

  it('refuses an empty run — there is nothing to resume', () => {
    saveRun({ ...run, actions: [] });
    expect(loadRun()).toBeNull();
  });

  it('clears', () => {
    saveRun(run);
    clearRun();
    expect(loadRun()).toBeNull();
  });

  it('survives corrupt JSON rather than throwing', () => {
    store.setItem('nook.run', '{not json');
    expect(loadRun()).toBeNull();
  });
});

describe('prefs', () => {
  it('fills in defaults for anything missing', () => {
    store.setItem('nook.prefs', JSON.stringify({ sound: false }));
    expect(loadPrefs()).toEqual({
      sound: false,
      haptics: true,
      fairDeal: false,
      reducedMotion: null,
    });
  });

  it('round-trips', () => {
    const prefs = {
      sound: false,
      haptics: false,
      fairDeal: true,
      reducedMotion: true,
    };
    savePrefs(prefs);
    expect(loadPrefs()).toEqual(prefs);
  });
});
