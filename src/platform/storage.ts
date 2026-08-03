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

function remove(key: string): void {
  try {
    window.localStorage.removeItem(key);
  } catch {
    // As above.
  }
}

/**
 * Every key in storage, for the readers that need to enumerate.
 *
 * Uses `length`/`key(i)` — the actual Storage API — rather than `Object.keys`,
 * which only works because browsers happen to expose entries as own properties.
 */
function keys(): string[] {
  try {
    const store = window.localStorage;
    const out: string[] = [];
    for (let i = 0; i < store.length; i++) {
      const key = store.key(i);
      if (key !== null) out.push(key);
    }
    return out;
  } catch {
    return [];
  }
}

function readJson<T>(key: string, fallback: T): T {
  const raw = read(key);
  if (raw === null) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

const writeJson = (key: string, value: unknown): void =>
  write(key, JSON.stringify(value));

function readNumber(key: string): number {
  const raw = read(key);
  const value = raw === null ? 0 : Number.parseInt(raw, 10);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

/** What a record attempt did. `previous` is what it beat, if anything. */
export interface Record {
  readonly best: number;
  readonly previous: number;
  readonly isNew: boolean;
}

/**
 * Store `score` under `key` if it beats what's there.
 *
 * Returns the previous value alongside the new one, which the old version threw
 * away one line before the UI needed it — so a personal best and a mediocre
 * loss rendered identically, the same number printed twice.
 */
function recordUnder(key: string, score: number): Record {
  const previous = readNumber(key);
  if (score <= previous) return { best: previous, previous, isNew: false };
  write(key, String(score));
  return { best: score, previous, isNew: previous > 0 };
}

export const loadBest = (): number => readNumber(BEST_KEY);
export const recordBest = (score: number): Record =>
  recordUnder(BEST_KEY, score);

/**
 * Today's Nook keeps its own best, per calendar day. Replaying the day is
 * allowed — the doc rules out lives and energy systems, and locking someone
 * out of a puzzle is the same species of idea — so what gets kept is your best.
 */
const DAILY_PREFIX = 'nook.daily.';
const dailyKey = (date: string): string => `${DAILY_PREFIX}${date}`;

export const loadDailyBest = (date: string): number =>
  readNumber(dailyKey(date));
export const recordDailyBest = (date: string, score: number): Record =>
  recordUnder(dailyKey(date), score);

/**
 * Every day ever played, newest first. These keys have been accumulating since
 * the daily shipped and nothing ever read them back.
 */
export function dailyHistory(): Array<{ date: string; score: number }> {
  return keys()
    .filter((k) => k.startsWith(DAILY_PREFIX))
    .map((k) => ({ date: k.slice(DAILY_PREFIX.length), score: readNumber(k) }))
    .filter((entry) => /^\d{4}-\d{2}-\d{2}$/.test(entry.date))
    .sort((a, b) => b.date.localeCompare(a.date));
}

// --- levels ----------------------------------------------------------------

const LEVELS_KEY = 'nook.levels.cleared';

/** Highest level cleared. 0 means none yet, so level 1 is next. */
export const loadLevelsCleared = (): number => readNumber(LEVELS_KEY);

/** The level to open on: one past the highest cleared. */
export const nextLevel = (): number => loadLevelsCleared() + 1;

export const recordLevelCleared = (level: number): Record =>
  recordUnder(LEVELS_KEY, level);

/** Rearrange keeps a best per mutator, so each week's rule has its own ladder. */
const rearrangeKey = (mutator: string): string => `nook.rearrange.${mutator}`;

export const loadRearrangeBest = (mutator: string): number =>
  readNumber(rearrangeKey(mutator));
export const recordRearrangeBest = (mutator: string, score: number): Record =>
  recordUnder(rearrangeKey(mutator), score);

// --- the daily streak ------------------------------------------------------

const STREAK_KEY = 'nook.streak';

export interface Streak {
  readonly count: number;
  /** The last date counted, as a YYYY-MM-DD key. */
  readonly last: string;
}

const NO_STREAK: Streak = { count: 0, last: '' };

export const loadStreak = (): Streak => readJson<Streak>(STREAK_KEY, NO_STREAK);

/** The day before `date`, as a key. Pure string-in, string-out. */
function dayBefore(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  const t = new Date(y!, (m ?? 1) - 1, d ?? 1);
  t.setDate(t.getDate() - 1);
  const mm = `${t.getMonth() + 1}`.padStart(2, '0');
  const dd = `${t.getDate()}`.padStart(2, '0');
  return `${t.getFullYear()}-${mm}-${dd}`;
}

/**
 * Count today toward the streak. Idempotent: finishing a second run on the same
 * day does not double-count, which matters because dailies are replayable.
 */
export function recordStreak(date: string): Streak {
  const current = loadStreak();
  if (current.last === date) return current;

  const count = current.last === dayBefore(date) ? current.count + 1 : 1;
  const next: Streak = { count, last: date };
  writeJson(STREAK_KEY, next);
  return next;
}

// --- lifetime stats --------------------------------------------------------

const STATS_KEY = 'nook.stats';

export interface Lifetime {
  readonly games: number;
  readonly lines: number;
  readonly placements: number;
  readonly sweeps: number;
  readonly bestRun: number;
}

const NO_LIFETIME: Lifetime = {
  games: 0,
  lines: 0,
  placements: 0,
  sweeps: 0,
  bestRun: 0,
};

export const loadLifetime = (): Lifetime =>
  readJson<Lifetime>(STATS_KEY, NO_LIFETIME);

export function recordLifetime(run: {
  lines: number;
  placements: number;
  sweeps: number;
  bestRun: number;
}): Lifetime {
  const prior = loadLifetime();
  const next: Lifetime = {
    games: prior.games + 1,
    lines: prior.lines + run.lines,
    placements: prior.placements + run.placements,
    sweeps: prior.sweeps + run.sweeps,
    bestRun: Math.max(prior.bestRun, run.bestRun),
  };
  writeJson(STATS_KEY, next);
  return next;
}

// --- the run in progress ---------------------------------------------------

const RUN_KEY = 'nook.run';

/**
 * Bump when anything that affects replay changes — piece weights, the deal
 * algorithm, scoring. A save from an older build would otherwise replay its
 * action list into a different game and silently produce a different board.
 */
const RUN_SCHEMA = 1;

export interface SavedRun {
  readonly schema: number;
  readonly seed: number;
  readonly actions: readonly unknown[];
  readonly score: number;
  /** Only endless runs are worth resuming; the others are reproducible. */
  readonly mode: string;
  /**
   * Fair Deal changes the generator, so a run saved under it must be replayed
   * under it. Without this the resumed board would silently diverge from the
   * one that was actually played.
   */
  readonly fairDeal: boolean;
}

/**
 * A run is literally `(seed, actions)` — the whole point of keeping `core/`
 * pure. Saving one costs a few hundred bytes and restoring it is `replay()`.
 */
export function saveRun(run: Omit<SavedRun, 'schema'>): void {
  writeJson(RUN_KEY, { schema: RUN_SCHEMA, ...run });
}

export function loadRun(): SavedRun | null {
  const saved = readJson<SavedRun | null>(RUN_KEY, null);
  if (!saved || saved.schema !== RUN_SCHEMA) return null;
  if (!Array.isArray(saved.actions) || saved.actions.length === 0) return null;
  return saved;
}

export const clearRun = (): void => remove(RUN_KEY);

/**
 * How far the first-run coach has got. Stored as the number of tips retired, so
 * a returning player never sees a tip they have already outgrown, and a player
 * who learned everything sees nothing again.
 */
const COACH_KEY = 'nook.coached';

export const loadCoach = (): number => readNumber(COACH_KEY);
export const saveCoach = (step: number): void => write(COACH_KEY, String(step));

// --- preferences -----------------------------------------------------------

const PREFS_KEY = 'nook.prefs';

export interface Prefs {
  readonly sound: boolean;
  readonly haptics: boolean;
  readonly fairDeal: boolean;
  /** null follows the system's prefers-reduced-motion. */
  readonly reducedMotion: boolean | null;
}

export const DEFAULT_PREFS: Prefs = {
  sound: true,
  haptics: true,
  fairDeal: false,
  reducedMotion: null,
};

export const loadPrefs = (): Prefs => ({
  ...DEFAULT_PREFS,
  ...readJson<Partial<Prefs>>(PREFS_KEY, {}),
});

export const savePrefs = (prefs: Prefs): void => writeJson(PREFS_KEY, prefs);
