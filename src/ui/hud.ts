// Score, run indicator and the screen-reader announcer. Plain DOM — text
// rendering and accessibility are things the browser is already good at.

import type { GameState } from '../core/game';
import { MAX_RUN_MULTIPLIER } from '../core/scoring';

/** Nine steps takes the multiplier from x1 to the x5 cap. */
const RUN_DOTS = (MAX_RUN_MULTIPLIER - 1) / 0.5 + 1;

/** How long the counter takes to catch up. Long enough to read as motion. */
const ROLL_MS = 420;

export class Hud {
  private readonly score: HTMLElement;
  private readonly dots: HTMLElement[] = [];
  private readonly announcer: HTMLElement;
  private shownRun = -1;

  /** The counter lags the real score and chases it — see `update`. */
  private displayed = 0;
  private rollFrom = 0;
  private rollTo = 0;
  private rollStart = -1;
  private rendered = -1;

  constructor(root: ParentNode = document) {
    this.score = must(root, '#score');
    this.announcer = must(root, '#announcer');

    const indicator = must(root, '#run-indicator');
    for (let i = 0; i < RUN_DOTS; i++) {
      const dot = document.createElement('span');
      dot.className = 'run-dot';
      indicator.append(dot);
      this.dots.push(dot);
    }
  }

  render(state: GameState): void {
    if (state.score !== this.rollTo) {
      // Roll from wherever the counter currently is, not from the last target,
      // so scoring twice in quick succession doesn't make it jump.
      this.rollFrom = this.displayed;
      this.rollTo = state.score;
      this.rollStart = performance.now();
    }
    if (state.run !== this.shownRun) {
      this.shownRun = state.run;
      this.dots.forEach((dot, i) => dot.classList.toggle('lit', i < state.run));
    }
  }

  /** True while the counter is still catching up. */
  get rolling(): boolean {
    return this.rollStart >= 0;
  }

  /**
   * Advance the counter. Digits rolling up rather than snapping is most of why
   * a score feels earned — and it's why the plate uses tabular figures, since
   * proportional digits jitter horribly while a number is moving.
   */
  update(now: number): void {
    if (this.rollStart < 0) {
      this.paint(this.displayed);
      return;
    }

    const t = Math.min(1, (now - this.rollStart) / ROLL_MS);
    // Ease out cubic: quick off the mark, gentle arrival.
    const eased = 1 - Math.pow(1 - t, 3);
    this.displayed = Math.round(this.rollFrom + (this.rollTo - this.rollFrom) * eased);

    if (t >= 1) {
      this.displayed = this.rollTo;
      this.rollStart = -1;
    }
    this.paint(this.displayed);
  }

  /** Jump straight to a value with no animation — for a fresh run. */
  reset(score: number): void {
    this.displayed = score;
    this.rollFrom = score;
    this.rollTo = score;
    this.rollStart = -1;
    this.paint(score);
  }

  private paint(value: number): void {
    if (value === this.rendered) return;
    this.rendered = value;
    this.score.textContent = value.toLocaleString('en-US');
  }

  /** Lowercase, plain, unbothered — same register as everything else. */
  announce(message: string): void {
    this.announcer.textContent = message;
  }
}

export function describePlacement(state: GameState): string {
  const event = state.lastEvent;
  if (!event) return '';

  const cleared = event.clearedRows.length + event.clearedCols.length;
  const parts = ['placed.'];
  if (event.sweptClean) parts.push('swept clean.');
  else if (cleared > 0) {
    parts.push(`cleared ${cleared} ${cleared === 1 ? 'line' : 'lines'}.`);
  }
  if (event.unlockedNook) parts.push('gem cleared. the nook is yours.');
  else {
    if (event.gemsCleared === 1) parts.push('gem.');
    else if (event.gemsCleared > 1) parts.push(`${event.gemsCleared} gems.`);
    if (event.starsCleared === 1) parts.push('star.');
    else if (event.starsCleared > 1) parts.push(`${event.starsCleared} stars.`);
  }
  if (state.run > 1) parts.push(`run x${event.multiplier}.`);
  parts.push(`score ${state.score.toLocaleString('en-US')}.`);
  return parts.join(' ');
}

function must(root: ParentNode, selector: string): HTMLElement {
  const el = root.querySelector<HTMLElement>(selector);
  if (!el) throw new Error(`missing element ${selector}`);
  return el;
}
