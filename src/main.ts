import './style.css';

import { createGame, reducer, type Action, type GameState } from './core/game';
import { DragController } from './input/drag';
import { KeyboardController } from './input/keyboard';
import { attachPointer } from './input/pointer';
import {
  soundClear,
  soundGameOver,
  soundPlace,
  soundStash,
  soundSweptClean,
  soundUnlock,
  unlockAudio,
} from './platform/audio';
import {
  tapClear,
  tapPlace,
  tapStash,
  tapSweptClean,
  tapUnlock,
} from './platform/haptics';
import {
  describeGoal,
  levelComplete,
  levelFor,
  type Level,
} from './core/levels';
import { dateKey, dayNumber, todaySeed } from './platform/daily';
import {
  canShareSheet,
  copyToClipboard,
  openShareSheet,
  shareText,
} from './platform/share';
import {
  loadDailyBest,
  loadLevelsCleared,
  nextLevel,
  recordBest,
  recordDailyBest,
  recordLevelCleared,
} from './platform/storage';
import { praiseFor, praiseIsHot } from './render/effects';
import { Renderer } from './render/renderer';
import { Hud, describePlacement } from './ui/hud';
import { EndPanel, GoalChips, ModeTabs, type Mode } from './ui/panels';

const canvas = must<HTMLCanvasElement>('#stage');

const renderer = new Renderer(canvas);
const hud = new Hud();
const panel = new EndPanel({
  onRestart: restart,
  onShare: share,
  onCopy: copyResult,
  onNextLevel: advanceLevel,
  onUseKey: useKey,
});
const tabs = new ModeTabs(setMode);
const chips = new GoalChips();

let mode: Mode = 'endless';
/** Only meaningful in level mode. */
let level: Level = levelFor(nextLevel());
/** Set the moment the objectives are all met, so the win fires once. */
let levelWon = false;
let state = newGame();
let dirty = true;

const drag = new DragController({
  getState: () => state,
  getLayout: () => renderer.layout,
  dispatch,
  invalidate: () => {
    dirty = true;
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

new ResizeObserver(() => {
  renderer.resize();
  dirty = true;
}).observe(renderer.host);

requestAnimationFrame(function frame(now) {
  // A live clear preview pulses, so anything with a piece in hand animates
  // continuously. Everything else redraws only on a change.
  hud.update(now);

  const view = drag.view() ?? keyboard.view();
  const ending = endProgress(now);
  if (dirty || view || renderer.effects.active || ending < 1) {
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

  dirty = true;
  hud.render(state);
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

function renderGoals(): void {
  if (mode === 'levels') chips.render(level, state);
  else chips.hide();
}

/** The bit that makes a clear feel like something rather than just happening. */
function celebrate(event: NonNullable<GameState['lastEvent']>): void {
  const lines = event.clearedRows.length + event.clearedCols.length;

  if (lines === 0) {
    tapPlace();
    soundPlace();
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

  if (event.sweptClean) {
    renderer.effects.say('swept clean', now, true);
  } else if (event.unlockedNook) {
    renderer.effects.say('the nook is yours', now, true);
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
}

/** The board drains to greyscale before the panel arrives. Let it land. */
const ENDING_MS = 600;
let endingStart = -1;

function end(): void {
  endingStart = performance.now();
  soundGameOver();
  hud.announce(`nowhere left to put it. final score ${state.score}.`);

  // Record against the right ledger before the panel reads it back.
  const best =
    mode === 'daily'
      ? recordDailyBest(dateKey(), state.score)
      : mode === 'levels'
        ? loadLevelsCleared()
        : recordBest(state.score);

  window.setTimeout(() => {
    panel.show({
      title: 'nowhere left to put it',
      score: state.score,
      best,
      bestLabel: mode === 'levels' ? 'levels cleared' : 'best',
      ...(mode === 'daily'
        ? { result: resultText(), canShareSheet: canShareSheet() }
        : {}),
      canAdvance: false,
      restartLabel: mode === 'levels' ? 'try again' : 'again',
      keys: state.keys,
    });
  }, ENDING_MS);
}

function endProgress(now: number): number {
  if (endingStart < 0) return 0;
  return Math.min(1, (now - endingStart) / ENDING_MS);
}

/** Cells the daily layout starts with. Enough to give the day a shape. */
const DAILY_LAYOUT_CELLS = 14;

function newGame(): GameState {
  // Today's Nook is a pure function of the date — no backend, no sync, and
  // everyone who starts today starts from the same board and the same stream.
  if (mode === 'daily') {
    return createGame({ seed: todaySeed(), layoutCells: DAILY_LAYOUT_CELLS });
  }

  if (mode === 'levels') {
    levelWon = false;
    // Levels hand over the Nook up front — it's the tool you need to plan
    // around an objective — and deal both marker kinds so collect-goals work.
    return createGame({
      seed: level.seed,
      layoutCells: level.layoutCells,
      markerPolicy: 'mixed',
      markerOneIn: level.markerOneIn,
      nookUnlocked: true,
    });
  }

  return createGame({ seed: (Math.random() * 0xffffffff) >>> 0 });
}

function advanceLevel(): void {
  level = levelFor(level.number + 1);
  restart();
}

/** Objectives met — stop the run and offer the next one. */
function winLevel(): void {
  levelWon = true;
  const cleared = recordLevelCleared(level.number);
  soundSweptClean();
  renderer.effects.say('level cleared', performance.now(), true);
  hud.announce(`level ${level.number} cleared. score ${state.score}.`);

  window.setTimeout(() => {
    panel.show({
      title: `level ${level.number} cleared`,
      score: state.score,
      best: cleared,
      bestLabel: 'levels cleared',
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
  if (mode !== 'daily') return '';
  const best = loadDailyBest(dateKey());
  const suffix = best > 0 ? ` · best ${best.toLocaleString('en-US')}` : '';
  return `today's nook #${dayNumber()}${suffix}`;
}

/** The shareable result for the run just finished. */
function resultText(): string {
  return shareText({
    day: dayNumber(),
    score: state.score,
    stats: state.stats,
  });
}

async function share(): Promise<void> {
  const ok = await openShareSheet(resultText());
  // A dismissed share sheet lands here too, so stay quiet rather than claim
  // something went wrong. The text is on screen either way.
  if (ok) panel.says('shared.');
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
  hud.render(state);

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
  renderer.effects.say('room to breathe', now, true);
  soundUnlock();
  tapUnlock();
  hud.announce(`key spent. ${event?.lines ?? 0} lines cleared.`);
}

function restart(): void {
  state = newGame();
  drag.cancel();
  keyboard.reset();
  renderer.effects.clear();
  endingStart = -1;
  panel.hide();
  refreshTabs();
  hud.reset(state.score);
  hud.render(state);
  renderGoals();

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
hud.render(state);
renderGoals();
