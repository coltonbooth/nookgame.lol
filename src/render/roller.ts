// The odometer.
//
// Digits rolling up rather than snapping is most of why a score feels earned.
// This used to live inside the DOM `Hud`; it moved out when the score plate
// became a canvas object, because the easing is the interesting part and it
// should not be tied to whichever surface happens to be drawing the number.

import { reducedMotion } from '../platform/motion';

/** How long the counter takes to catch up. Long enough to read as motion. */
const ROLL_MS = 420;

/** How long the reels spin before landing on a jackpot total. */
const SPIN_MS = 900;

export class Roller {
  private displayed = 0;
  private from = 0;
  private to = 0;
  private start = -1;
  /** Set while the reels are spinning; the digits are noise until it passes. */
  private spinUntil = -1;

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

  /**
   * Spin the reels, then land on `value`.
   *
   * Reserved for a jackpot. The odometer normally eases straight to its target,
   * which is the right behaviour for the twenty-odd scoring events a minute
   * this game produces — a machine that made a production of every placement
   * would be exhausting inside a deal. A payout is rare enough to earn one.
   */
  spin(value: number): void {
    if (reducedMotion()) {
      this.reset(value);
      return;
    }
    this.from = this.displayed;
    this.to = value;
    this.start = performance.now();
    this.spinUntil = this.start + SPIN_MS;
  }

  /** Jump straight there with no animation — for a fresh run. */
  reset(value: number): void {
    this.displayed = value;
    this.from = value;
    this.to = value;
    this.start = -1;
    this.spinUntil = -1;
  }

  /** Advance and read. Safe to call every frame. */
  read(now: number): number {
    if (this.start < 0) return this.displayed;

    // Spinning: show scrambled digits of roughly the right magnitude, so the
    // plate is visibly *working* rather than counting. Landing is the payoff.
    if (now < this.spinUntil) {
      const magnitude = Math.max(this.to, 10);
      return Math.floor(Math.random() * magnitude);
    }

    const duration = this.spinUntil > 0 ? ROLL_MS * 0.6 : ROLL_MS;
    const began = this.spinUntil > 0 ? this.spinUntil : this.start;
    const t = Math.min(1, (now - began) / duration);
    // Ease out cubic: quick off the mark, gentle arrival.
    const eased = 1 - Math.pow(1 - t, 3);
    this.displayed = Math.round(this.from + (this.to - this.from) * eased);

    if (t >= 1) {
      this.displayed = this.to;
      this.start = -1;
      this.spinUntil = -1;
    }
    return this.displayed;
  }

  /** True while the digits are still moving. Keeps the render loop awake. */
  get rolling(): boolean {
    return this.start >= 0;
  }
}
