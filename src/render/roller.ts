// The odometer.
//
// Digits rolling up rather than snapping is most of why a score feels earned.
// This used to live inside the DOM `Hud`; it moved out when the score plate
// became a canvas object, because the easing is the interesting part and it
// should not be tied to whichever surface happens to be drawing the number.

import { reducedMotion } from '../platform/motion';

/** How long the counter takes to catch up. Long enough to read as motion. */
const ROLL_MS = 420;

export class Roller {
  private displayed = 0;
  private from = 0;
  private to = 0;
  private start = -1;

  /** Point it at a new value. Rolls from wherever it currently *is*. */
  set(value: number): void {
    if (value === this.to) return;

    // Under reduced motion the number simply is what it is.
    if (reducedMotion()) {
      this.reset(value);
      return;
    }

    // From the displayed value, not the last target, so scoring twice in quick
    // succession doesn't make the digits jump.
    this.from = this.displayed;
    this.to = value;
    this.start = performance.now();
  }

  /** Jump straight there with no animation — for a fresh run. */
  reset(value: number): void {
    this.displayed = value;
    this.from = value;
    this.to = value;
    this.start = -1;
  }

  /** Advance and read. Safe to call every frame. */
  read(now: number): number {
    if (this.start < 0) return this.displayed;

    const t = Math.min(1, (now - this.start) / ROLL_MS);
    // Ease out cubic: quick off the mark, gentle arrival.
    const eased = 1 - Math.pow(1 - t, 3);
    this.displayed = Math.round(this.from + (this.to - this.from) * eased);

    if (t >= 1) {
      this.displayed = this.to;
      this.start = -1;
    }
    return this.displayed;
  }

  /** True while the digits are still moving. Keeps the render loop awake. */
  get rolling(): boolean {
    return this.start >= 0;
  }
}
