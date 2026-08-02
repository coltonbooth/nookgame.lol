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
import { dateKey, dayNumber, todaySeed } from './platform/daily';
import { shareOrCopy, shareText } from './platform/share';
import {
  loadDailyBest,
  recordBest,
  recordDailyBest,
} from './platform/storage';
import { praiseFor } from './render/effects';
import { Renderer } from './render/renderer';
import { Hud, describePlacement } from './ui/hud';
import { EndPanel, ModeTabs, type Mode } from './ui/panels';

const canvas = must<HTMLCanvasElement>('#stage');

const renderer = new Renderer(canvas);
const hud = new Hud();
const panel = new EndPanel({ onRestart: restart, onShare: share });
const tabs = new ModeTabs(setMode);

let mode: Mode = 'endless';
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

  if (state.status === 'over' && before.status === 'playing') {
    end();
  }
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
    },
    renderer.layout,
    performance.now(),
  );

  // Pitch climbs with the run, which is the thing that makes a streak feel
  // like a streak rather than four unrelated clears.
  soundClear(lines, state.run);

  const now = performance.now();
  if (event.sweptClean) {
    renderer.effects.say('swept clean', now, true);
  } else if (event.unlockedNook) {
    renderer.effects.say('the nook is yours', now, true);
  } else {
    const praise = praiseFor(lines, state.run);
    if (praise) renderer.effects.say(praise, now, lines >= 3 || state.run >= 4);
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
      : recordBest(state.score);

  window.setTimeout(() => {
    panel.show(state.score, best, mode === 'daily');
  }, ENDING_MS);
}

function endProgress(now: number): number {
  if (endingStart < 0) return 0;
  return Math.min(1, (now - endingStart) / ENDING_MS);
}

function newGame(): GameState {
  // Today's Nook is a pure function of the date — no backend, no sync, and
  // everyone who starts today starts from the same stream.
  const seed =
    mode === 'daily' ? todaySeed() : (Math.random() * 0xffffffff) >>> 0;
  return createGame({ seed });
}

function setMode(next: Mode): void {
  if (next === mode) return;
  mode = next;
  restart();
}

/** Keeps the tabs and the "today's nook #N · best" label in step. */
function refreshTabs(): void {
  tabs.set(mode, dayNumber(), loadDailyBest(dateKey()));
}

async function share(): Promise<void> {
  const text = shareText({
    day: dayNumber(),
    score: state.score,
    stats: state.stats,
  });

  const outcome = await shareOrCopy(text);
  if (!outcome.ok) {
    panel.says('could not share. select and copy instead.');
    return;
  }
  panel.says(outcome.copied ? 'copied.' : 'shared.');
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
  hud.announce(mode === 'daily' ? `today's nook #${dayNumber()}.` : 'new run.');
  dirty = true;
}

function must<T extends Element>(selector: string): T {
  const el = document.querySelector<T>(selector);
  if (!el) throw new Error(`missing element ${selector}`);
  return el;
}

refreshTabs();
hud.render(state);
