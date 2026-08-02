// localStorage, defensively. Safari in private mode throws on access rather
// than returning null, and a puzzle game should not die over a high score.

const BEST_KEY = 'nook.best';

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Nothing to do, and nothing worth telling the player about.
  }
}

function readNumber(key: string): number {
  const raw = read(key);
  const value = raw === null ? 0 : Number.parseInt(raw, 10);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

/** Store `score` under `key` if it beats what's there. Returns the best after. */
function recordUnder(key: string, score: number): number {
  const best = readNumber(key);
  if (score <= best) return best;
  write(key, String(score));
  return score;
}

export const loadBest = (): number => readNumber(BEST_KEY);
export const recordBest = (score: number): number =>
  recordUnder(BEST_KEY, score);

/**
 * Today's Nook keeps its own best, per calendar day. Replaying the day is
 * allowed — the doc rules out lives and energy systems, and locking someone
 * out of a puzzle is the same species of idea — so what gets kept is your best.
 */
const dailyKey = (date: string): string => `nook.daily.${date}`;

export const loadDailyBest = (date: string): number =>
  readNumber(dailyKey(date));
export const recordDailyBest = (date: string, score: number): number =>
  recordUnder(dailyKey(date), score);
