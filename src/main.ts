import './style.css';

import { cellsAt } from './core/board';
import {
  createGame,
  reducer,
  replay,
  type Action,
  type GameState,
} from './core/game';
import { DragController } from './input/drag';
import { KeyboardController } from './input/keyboard';
import { attachPointer } from './input/pointer';
import {
  soundClear,
  soundGameOver,
  soundInvalid,
  soundJackpot,
  soundKey,
  soundLevelClear,
  soundNewBest,
  soundPickup,
  soundPlace,
  soundRiser,
  soundStash,
  soundSweptClean,
  soundUnlock,
  setAudioEnabled,
  unlockAudio,
} from './platform/audio';
import {
  hapticsAvailable,
  setHapticsEnabled,
  tapClear,
  tapGameOver,
  tapInvalid,
  tapJackpot,
  tapPlace,
  tapStash,
  tapSweptClean,
  tapUnlock,
} from './platform/haptics';
import { jackpotReady } from './core/scoring';
import {
  describeGoal,
  levelComplete,
  levelFor,
  type Level,
} from './core/levels';
import { dateKey, dayNumber, todaySeed, weekNumber } from './platform/daily';
import {
  CHARGED_MARKER_ONE_IN,
  describeMutator,
  mutatorForWeek,
  type Mutator,
} from './core/mutators';
import {
  canShareSheet,
  copyToClipboard,
  openShareSheet,
  shareText,
} from './platform/share';
import {
  reducedMotionOverride,
  setReducedMotion,
  systemReducedMotion,
} from './platform/motion';
import {
  clearRun,
  loadDailyBest,
  loadLevelsCleared,
  loadCoach,
  loadPrefs,
  loadRun,
  loadStreak,
  nextLevel,
  recordBest,
  recordDailyBest,
  recordLevelCleared,
  recordLifetime,
  recordRearrangeBest,
  recordStreak,
  saveCoach,
  savePrefs,
  saveRun,
} from './platform/storage';
import { praiseFor, praiseIsHot } from './render/effects';
import { Renderer } from './render/renderer';
import { Hud, describePlacement } from './ui/hud';
import {
  EndPanel,
  GoalChips,
  ModeTabs,
  SettingsPanel,
  type Mode,
} from './ui/panels';

const canvas = must<HTMLCanvasElement>('#stage');
const coachEl = must<HTMLElement>('#coach');

const renderer = new Renderer(canvas);
const hud = new Hud();
const panel = new EndPanel({
  onRestart: restart,
  onShare: share,
  onCopy: copyResult,
  onNextLevel: advanceLevel,
  onUseKey: useKey,
  onDuel: shareDuel,
});
const tabs = new ModeTabs(setMode);
const chips = new GoalChips();

/**
 * Cells the daily layout starts with. Enough to give the day a shape.
 *
 * Declared up here because `gameOptions` reads it and is reachable from the
 * module-level `startGame()` call below — a `const` further down the file would
 * still be in its temporal dead zone at that point.
 */
const DAILY_LAYOUT_CELLS = 14;

/** Rearrange's rule for this week. One slot, rotating, the same for everyone. */
const WEEKLY_MUTATOR: Mutator = mutatorForWeek(weekNumber());

let prefs = loadPrefs();
const settings = new SettingsPanel((values) => {
  const fairDealChanged = values.fairDeal !== prefs.fairDeal;
  prefs = {
    sound: values.sound,
    haptics: values.haptics,
    fairDeal: values.fairDeal,
    // Ticking the box is an explicit choice; unticking it goes back to
    // following the system rather than forcing motion on.
    reducedMotion: values.reducedMotion ? true : systemReducedMotion() ? null : false,
  };
  savePrefs(prefs);
  applyPrefs();
  // Fair Deal is a `createGame` option, so it can only take hold on a new run.
  if (fairDealChanged) restart();
});

function applyPrefs(): void {
  setAudioEnabled(prefs.sound);
  setHapticsEnabled(prefs.haptics);
  setReducedMotion(prefs.reducedMotion);
  dirty = true;
}


let mode: Mode = 'endless';
/** Only meaningful in level mode. */
let level: Level = levelFor(nextLevel());
/** Set the moment the objectives are all met, so the win fires once. */
let levelWon = false;
/** Drives the share headline; set when a run ends. */
let lastRecordWasBest = false;

/**
 * The run so far, as the seed it started from and every action since. That is
 * the entire run — `replay()` turns it back into a board — which is what makes
 * "close the tab and come back" cost a few hundred bytes instead of a schema.
 */
let runSeed = 0;
let runActions: Action[] = [];

let state = startGame();
let dirty = true;

// Only once `dirty` exists: `applyPrefs` touches it, and running this any
// earlier is a temporal-dead-zone error that aborts the rest of module init.
settings.set({
  sound: prefs.sound,
  haptics: prefs.haptics,
  reducedMotion: reducedMotionOverride() ?? systemReducedMotion(),
  fairDeal: prefs.fairDeal,
});
// Vibration is Android-only; a dead toggle is worse than no toggle.
settings.setHapticsSupported(hapticsAvailable());
applyPrefs();

const drag = new DragController({
  getState: () => state,
  getLayout: () => renderer.layout,
  dispatch,
  invalidate: () => {
    dirty = true;
  },
  onPickup: () => {
    soundPickup();
  },
  onInvalidDrop: () => {
    soundInvalid();
    tapInvalid();
  },
});

const keyboard = new KeyboardController({
  getState: () => state,
  getLayout: () => renderer.layout,
  dispatch,
  announce: (message) => hud.announce(message),
  invalidate: () => {
    dirty = true;
  },
});

attachPointer(canvas, {
  onDown: (p) => {
    // Audio has to be created or resumed inside a real gesture or iOS keeps
    // the context suspended and the game is silent with nothing to explain it.
    unlockAudio();
    // A hand on the screen takes over from the keyboard.
    keyboard.reset();
    drag.onDown(p);
  },
  onMove: (p) => drag.onMove(p),
  onUp: (p) => drag.onUp(p),
  onCancel: () => drag.cancel(),
});

keyboard.attach();
window.addEventListener('keydown', unlockAudio, { once: true });

// Offline and installable. Registered after load so it never competes with the
// first paint, and failure is silent — a service worker is an enhancement and
// the game works exactly the same without one.
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  const registerWorker = (): void => {
    void navigator.serviceWorker.register('/sw.js').catch(() => undefined);
  };
  // Waiting on `load` unconditionally silently did nothing: module scripts can
  // run after the event has already fired, and a listener added late never
  // gets called. Check the state we actually care about instead.
  if (document.readyState === 'complete') registerWorker();
  else window.addEventListener('load', registerWorker, { once: true });
}

/**
 * Park the coach strip in the empty band between the score plate and the tray.
 *
 * That band is a canvas measurement, so CSS cannot find it on its own — the
 * tray is drawn rather than laid out. Handing the midpoint over as a custom
 * property is the smallest bridge between the two coordinate systems, and it
 * keeps the strip off the tray pieces at every viewport size.
 */
function placeCoach(): void {
  const l = renderer.layout;
  const band = (l.plate.y + l.plate.h + l.nook.y) / 2;
  coachEl.style.setProperty('--coach-y', `${canvas.offsetTop + band}px`);
}

new ResizeObserver(() => {
  renderer.resize();
  placeCoach();
  dirty = true;
}).observe(renderer.host);

requestAnimationFrame(function frame(now) {
  // A live clear preview pulses, so anything with a piece in hand animates
  // continuously. Everything else redraws only on a change.
  const view = drag.view() ?? keyboard.view();
  const ending = endProgress(now);
  if (dirty || view || renderer.effects.active || renderer.rolling || ending < 1) {
    dirty = false;
    renderer.draw(state, view, now, ending);
  }
  requestAnimationFrame(frame);
});

// --- plumbing --------------------------------------------------------------

function dispatch(action: Action): void {
  // A won level is still technically playable — the board hasn't run out of
  // room — so stop taking input rather than letting pieces land behind the
  // panel.
  if (levelWon) return;

  const before = state;
  state = reducer(state, action);
  if (state === before) return;

  // Only actions the reducer actually accepted go on the tape, so the replay
  // can never diverge from what was played.
  runActions.push(action);
  scheduleSave();

  dirty = true;
  renderer.setScore(state.score);
  keyboard.syncTo(state);

  const event = state.lastEvent;
  if (event && event !== before.lastEvent) {
    hud.announce(describePlacement(state));
    celebrate(event);
  } else if (action.type === 'stash') {
    tapStash();
    soundStash();
  }

  renderGoals();
  renderCoach();

  // A level is won the moment every objective is met — check before the
  // end-of-run check, so meeting the last goal with your last legal placement
  // reads as a win rather than a loss.
  if (mode === 'levels' && !levelWon && levelComplete(level, state)) {
    winLevel();
    return;
  }

  if (state.status === 'over' && before.status === 'playing') {
    end();
  }
}

/**
 * Persist the run, coalesced. Writing on every placement would hit localStorage
 * several times a second during fast play for no benefit; a short debounce plus
 * a flush when the page goes away covers every way a run actually gets
 * interrupted, including the one that matters most on mobile — the tab being
 * evicted in the background, where no unload event is guaranteed to fire.
 */
let saveTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleSave(): void {
  if (mode !== 'endless' || state.status !== 'playing') return;
  if (saveTimer !== null) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    flushSave();
  }, 800);
}

function flushSave(): void {
  if (saveTimer !== null) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  if (mode !== 'endless' || state.status !== 'playing') return;
  if (runActions.length === 0) return;
  saveRun({
    seed: runSeed,
    actions: runActions,
    score: state.score,
    mode: 'endless',
    fairDeal: state.fairDeal,
  });
}

// `visibilitychange` is the only one of these iOS reliably delivers.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') flushSave();
});
window.addEventListener('pagehide', flushSave);

/**
 * The first-run coach.
 *
 * Three things in this game are genuinely undiscoverable: that pieces are
 * dragged rather than tapped, that a line clears when a row *or column* fills,
 * and that the alcove opens by clearing a line through a gem. The design doc
 * rules out forced tutorials, and rightly — so this teaches by naming the next
 * thing you have not done yet, one line at a time, and retires each tip
 * permanently the moment you do it.
 */
const COACH_TIPS: ReadonlyArray<{
  readonly text: string;
  readonly done: (s: GameState) => boolean;
}> = [
  {
    text: 'drag a piece onto the board',
    done: (s) => s.stats.placements > 0,
  },
  {
    text: 'fill a whole row or column to clear it',
    done: (s) => s.stats.linesCleared > 0,
  },
  {
    text: 'clear a line through a gem to open the nook',
    done: (s) => s.nookUnlocked,
  },
  {
    text: 'fill the gold bar for the jackpot',
    done: (s) => s.stats.jackpots > 0,
  },
];

let coachStep = loadCoach();

function renderCoach(): void {
  // Retire every tip the player has already satisfied, not just the current
  // one — someone who clears a line on their first placement should never be
  // told to make a placement.
  while (coachStep < COACH_TIPS.length && COACH_TIPS[coachStep]!.done(state)) {
    coachStep++;
    saveCoach(coachStep);
  }

  const tip = COACH_TIPS[coachStep];
  // Levels have their own goal chips saying the same kind of thing, and two
  // instruction strips at once is one too many.
  const show = tip !== undefined && mode !== 'levels' && state.status === 'playing';
  coachEl.hidden = !show;
  if (show && tip) coachEl.textContent = tip.text;
}

function renderGoals(): void {
  if (mode === 'levels') chips.render(level, state);
  else chips.hide();
}

/** The bit that makes a clear feel like something rather than just happening. */
function celebrate(event: NonNullable<GameState['lastEvent']>): void {
  const lines = event.clearedRows.length + event.clearedCols.length;

  // The piece settles home on every placement, clearing or not — this is the
  // common case, and it's what stops pieces reading as teleporting into place.
  renderer.effects.land(cellsAt(event.piece, event.x, event.y), performance.now());

  if (lines === 0) {
    tapPlace();
    soundPlace();
    // The meter only ever moves on a clear, so a non-clearing placement is
    // exactly when the player has time to notice how close it is getting.
    armRiser();
    return;
  }

  renderer.effects.spawn(
    {
      cells: event.clearedCells,
      originX: event.x,
      originY: event.y,
      lines,
      run: state.run,
    },
    renderer.layout,
    performance.now(),
  );

  // Pitch climbs with the run, which is the thing that makes a streak feel
  // like a streak rather than four unrelated clears.
  soundClear(lines, state.run);

  const now = performance.now();
  renderer.effects.score(event.gained, event.x, event.y, now);

  // The jackpot outranks everything. It is the rarest and largest thing that
  // can happen, so it takes the word, the burst and the reels — and the ordinary
  // praise ladder stands down for the one placement it fires on.
  if (event.jackpot) {
    renderer.effects.jackpot(renderer.layout, now);
    renderer.spinScore(state.score);
    soundJackpot();
    tapJackpot();
    return;
  }

  if (event.sweptClean) {
    renderer.effects.say('SWEPT CLEAN', now, true);
  } else if (event.unlockedNook) {
    renderer.effects.say('NOOK UNLOCKED', now, true);
  } else {
    const praise = praiseFor(lines, state.run);
    if (praise) renderer.effects.say(praise, now, praiseIsHot(lines, state.run));
  }

  if (event.unlockedNook) {
    tapUnlock();
    soundUnlock();
  } else if (event.sweptClean) {
    tapSweptClean();
    soundSweptClean();
  } else {
    tapClear(lines);
  }

  armRiser();
}

/**
 * The anticipation. Once the meter is within two lines of paying out, the
 * machine starts spinning up between placements.
 *
 * Fired at most once per approach rather than on every placement: a ratchet
 * that goes off three times a deal stops meaning "nearly" and starts meaning
 * "nothing". The latch resets when the meter empties, which only happens when
 * the jackpot actually lands.
 */
let riserArmed = false;

function armRiser(): void {
  const ready = jackpotReady(state.jackpot);
  if (ready && !riserArmed) soundRiser();
  riserArmed = ready;
}

/** The board drains to greyscale before the panel arrives. Let it land. */
const ENDING_MS = 600;
let endingStart = -1;

function end(): void {
  endingStart = performance.now();
  soundGameOver();
  tapGameOver();
  hud.announce(`nowhere left to put it. final score ${state.score}.`);

  // The run is over: nothing left to resume.
  clearRun();

  // Record against the right ledger before the panel reads it back.
  const record =
    mode === 'daily'
      ? recordDailyBest(dateKey(), state.score)
      : mode === 'levels'
        ? { best: loadLevelsCleared(), previous: 0, isNew: false }
        : mode === 'rearrange'
          ? recordRearrangeBest(WEEKLY_MUTATOR, state.score)
          : recordBest(state.score);

  recordLifetime({
    lines: state.stats.linesCleared,
    placements: state.stats.placements,
    sweeps: state.stats.sweptClean,
    bestRun: state.stats.bestRun,
  });

  // A day counts toward the streak once it has actually been played out.
  const streak = mode === 'daily' ? recordStreak(dateKey()).count : 0;
  lastRecordWasBest = record.isNew;

  if (record.isNew) {
    hud.announce(`new best. ${state.score.toLocaleString('en-US')}.`);
  }

  window.setTimeout(() => {
    if (record.isNew) soundNewBest();
    panel.show({
      title: record.isNew ? 'a new best' : 'nowhere left to put it',
      score: state.score,
      best: record.best,
      bestLabel: mode === 'levels' ? 'levels cleared' : 'best',
      result: resultText(),
      canShareSheet: canShareSheet(),
      canAdvance: false,
      restartLabel: mode === 'levels' ? 'try again' : 'again',
      keys: state.keys,
      isNewBest: record.isNew,
      previousBest: record.previous,
      streak,
      canDuel: mode === 'endless',
    });
  }, ENDING_MS);
}

function endProgress(now: number): number {
  if (endingStart < 0) return 0;
  return Math.min(1, (now - endingStart) / ENDING_MS);
}

/** The options that define the current mode's run. Seed included. */
function gameOptions(seed?: number): Parameters<typeof createGame>[0] {
  // Today's Nook is the same puzzle for everybody, so it is the one mode where
  // the generator must not be quietly reconfigured per player.
  if (mode === 'daily') {
    return { seed: seed ?? todaySeed(), layoutCells: DAILY_LAYOUT_CELLS };
  }
  if (mode === 'levels') {
    return {
      seed: seed ?? level.seed,
      layoutCells: level.layoutCells,
      markerPolicy: 'mixed',
      markerOneIn: level.markerOneIn,
      nookUnlocked: true,
      fairDeal: prefs.fairDeal,
    };
  }
  if (mode === 'rearrange') {
    return {
      seed: seed ?? (Math.random() * 0xffffffff) >>> 0,
      fairDeal: prefs.fairDeal,
      mutator: WEEKLY_MUTATOR,
      // Charged only works as a rule if charges actually turn up.
      ...(WEEKLY_MUTATOR === 'charged'
        ? { markerOneIn: CHARGED_MARKER_ONE_IN, nookUnlocked: true }
        : {}),
    };
  }
  return {
    seed: seed ?? (Math.random() * 0xffffffff) >>> 0,
    fairDeal: prefs.fairDeal,
  };
}

/**
 * Open on a fresh run, or on the one that was interrupted.
 *
 * Only endless is worth resuming: the daily and a level are both reproducible
 * from their own seed, so the worst an interruption costs there is the replay.
 * An endless run is unrepeatable, and losing an hour of one to a backgrounded
 * tab is the single most annoying thing this game could do to somebody.
 */
/**
 * A seed handed over in the URL: `?seed=12345`.
 *
 * Asynchronous multiplayer for the price of a query parameter — both players
 * get the identical piece sequence and play whenever they like. Nothing to
 * host, nothing to sync, because a run is already a pure function of its seed.
 */
function seedFromUrl(): number | null {
  const raw = new URLSearchParams(window.location.search).get('seed');
  if (raw === null) return null;
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) && value > 0 ? value >>> 0 : null;
}

function startGame(): GameState {
  // A shared seed always wins: someone followed a link to play *that* board.
  //
  // Read lazily rather than held in a module-level const: `startGame` is called
  // during module initialisation, and a `const` declared below that call site
  // is still in its temporal dead zone when the call happens.
  const duel = seedFromUrl();
  if (duel !== null) {
    runSeed = duel;
    runActions = [];
    return createGame({ seed: duel, fairDeal: prefs.fairDeal });
  }

  const saved = loadRun();
  if (saved && saved.mode === 'endless' && mode === 'endless') {
    try {
      const actions = saved.actions as Action[];
      const restored = replay(
        { seed: saved.seed, fairDeal: saved.fairDeal === true },
        actions,
      );
      if (restored.status === 'playing') {
        runSeed = saved.seed;
        runActions = [...actions];
        return restored;
      }
    } catch {
      // A save that won't replay is a save from a different game. Drop it.
    }
    clearRun();
  }
  return newGame();
}

function newGame(): GameState {
  const options = gameOptions();
  runSeed = options.seed;
  runActions = [];
  clearRun();
  return createGame(options);
}

function advanceLevel(): void {
  level = levelFor(level.number + 1);
  restart();
}

/** Objectives met — stop the run and offer the next one. */
function winLevel(): void {
  levelWon = true;
  const cleared = recordLevelCleared(level.number);
  soundLevelClear();
  renderer.effects.say('LEVEL CLEARED', performance.now(), true);
  hud.announce(`level ${level.number} cleared. score ${state.score}.`);

  window.setTimeout(() => {
    panel.show({
      title: `level ${level.number} cleared`,
      score: state.score,
      best: cleared.best,
      bestLabel: 'levels cleared',
      result: resultText(),
      canShareSheet: canShareSheet(),
      canAdvance: true,
      restartLabel: 'replay',
    });
  }, 700);
}

function setMode(next: Mode): void {
  if (next === mode) return;
  mode = next;
  // Resume the ladder wherever it was left.
  if (mode === 'levels') level = levelFor(nextLevel());
  restart();
}

/** Keeps the tabs and the caption under the score in step. */
function refreshTabs(): void {
  tabs.set(mode, captionFor());
}

function captionFor(): string {
  if (mode === 'levels') return `level ${level.number}`;
  if (mode === 'rearrange') return describeMutator(WEEKLY_MUTATOR);
  if (mode !== 'daily') return '';

  const parts = [`today's nook #${dayNumber()}`];
  const best = loadDailyBest(dateKey());
  if (best > 0) parts.push(`best ${best.toLocaleString('en-US')}`);

  // A streak only exists once it is worth protecting, so it stays hidden at 1.
  const streak = loadStreak();
  const live = streak.last === dateKey() || streak.last === yesterdayKey();
  if (live && streak.count > 1) parts.push(`${streak.count} days running`);

  return parts.join(' · ');
}

/** Yesterday's key, so a streak still counts as live before today is played. */
function yesterdayKey(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return dateKey(d);
}

/** The shareable result for the run just finished. */
function resultText(): string {
  return shareText({
    day: dayNumber(),
    score: state.score,
    stats: state.stats,
    mode,
    level: level.number,
    mutator: WEEKLY_MUTATOR,
    isBest: lastRecordWasBest,
  });
}

async function share(): Promise<void> {
  const ok = await openShareSheet(resultText());
  // A dismissed share sheet lands here too, so stay quiet rather than claim
  // something went wrong. The text is on screen either way.
  if (ok) panel.says('shared.');
}

/**
 * Hand this exact board to somebody else. The seed is the whole game, so the
 * link needs nothing but a number and there is no backend to build.
 */
async function shareDuel(): Promise<void> {
  const url = `${window.location.origin}${window.location.pathname}?seed=${runSeed}`;
  const text = `beat my ${state.score.toLocaleString('en-US')} on this board — ${url}`;
  const ok = (await openShareSheet(text)) || (await copyToClipboard(text));
  panel.says(ok ? 'link copied.' : url);
}

async function copyResult(): Promise<void> {
  const ok = await copyToClipboard(resultText());
  panel.says(ok ? 'copied.' : 'select the text above and copy it.');
}

/**
 * Spend a Key and carry on. The run keeps its score and its streak — this is a
 * rescue, not a restart, and that distinction is the whole value of the thing.
 */
function useKey(): void {
  const before = state;
  state = reducer(state, { type: 'key' });
  if (state === before || state.status !== 'playing') return;

  panel.hide();
  endingStart = -1;
  dirty = true;
  drag.cancel();
  keyboard.reset();
  keyboard.syncTo(state);
  renderer.setScore(state.score);

  const event = state.keyEvent;
  const now = performance.now();
  if (event && event.cells.length > 0) {
    renderer.effects.spawn(
      {
        cells: event.cells,
        // No placement to radiate from, so the wave starts at the middle.
        originX: 3,
        originY: 3,
        lines: event.lines,
        run: 0,
      },
      renderer.layout,
      now,
    );
  }
  renderer.effects.say('BACK IN PLAY', now, true);
  soundKey();
  tapUnlock();
  hud.announce(`key spent. ${event?.lines ?? 0} lines cleared.`);
}

function restart(): void {
  // Clear the win latch on *every* path, not just the levels one. `dispatch`
  // refuses input while it is set, so a stale `true` after switching out of
  // levels left the board rendering normally and silently swallowing every
  // placement until a reload.
  levelWon = false;
  riserArmed = false;
  state = newGame();
  drag.cancel();
  keyboard.reset();
  renderer.effects.clear();
  endingStart = -1;
  panel.hide();
  refreshTabs();
  renderer.resetScore(state.score);
  renderGoals();
  renderCoach();

  if (mode === 'levels') {
    hud.announce(
      `level ${level.number}. ${level.goals.map(describeGoal).join(', then ')}.`,
    );
  } else {
    hud.announce(mode === 'daily' ? `today's nook #${dayNumber()}.` : 'new run.');
  }
  dirty = true;
}

function must<T extends Element>(selector: string): T {
  const el = document.querySelector<T>(selector);
  if (!el) throw new Error(`missing element ${selector}`);
  return el;
}

refreshTabs();
renderer.resetScore(state.score);
renderGoals();
renderCoach();
placeCoach();
