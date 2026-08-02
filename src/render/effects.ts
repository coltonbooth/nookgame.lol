// Clear feedback: the staggered pop, the particle burst, and the shake.
//
// Mechanically a clear is instantaneous — the cells are gone the moment the
// reducer returns. Everything here is a lie told afterwards, drawn on top of a
// board that has already moved on. That is fine, and it is most of why the
// genre feels good: the stagger is what turns "some cells vanished" into a
// wave travelling out from where you put the piece.

import type { ClearedCell } from '../core/game';
import { N } from '../core/board';
import type { Layout } from './layout';
import { ENAMEL } from './sprites';

/** Cell pop, start to finish. */
const POP_MS = 260;
/** Delay per step of distance from the placement — the wave. */
const STAGGER_MS = 15;
const PARTICLE_MS = 520;
const PARTICLES_PER_CELL = 5;
/** Hard cap so a five-line sweep can't tank the frame rate on an old phone. */
const MAX_PARTICLES = 320;

const SHAKE_MS = 220;
/** Tiny, and only for a properly big clear. */
const SHAKE_PX = 3.5;

interface Pop {
  readonly x: number;
  readonly y: number;
  readonly color: number;
  readonly start: number;
  readonly marker: boolean;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  readonly color: number;
  readonly start: number;
  readonly size: number;
}

export interface ClearBurst {
  readonly cells: readonly ClearedCell[];
  /** Where the piece landed — the wave travels out from here. */
  readonly originX: number;
  readonly originY: number;
  readonly lines: number;
}

const PRAISE_MS = 950;

/**
 * The praise ladder.
 *
 * This is the one place Nook deliberately breaks its own voice rule — the
 * design doc asks for "lowercase, gentle, never exclamatory", and a word
 * flying across the board is none of those things. Keeping it lowercase is the
 * compromise: the escalation lands without the game starting to shout.
 *
 * Swap this array for capitals if you want the full arcade treatment.
 */
export const PRAISE = [
  'nice',
  'great',
  'wow',
  'amazing',
  'unbelievable',
  'legendary',
] as const;

/**
 * How impressive a clear was. Lines and streak both feed it, so a single row
 * deep into a run earns praise the same way a triple does cold — and a plain
 * single with no run earns none, because praising everything praises nothing.
 */
export function praiseFor(lines: number, run: number): string | null {
  if (lines <= 0) return null;
  const heat = lines + Math.max(0, run - 1);
  if (heat < 2) return null;
  return PRAISE[Math.min(heat - 2, PRAISE.length - 1)]!;
}

interface Praise {
  readonly text: string;
  readonly start: number;
  readonly hot: boolean;
}

export class Effects {
  private pops: Pop[] = [];
  private particles: Particle[] = [];
  private praise: Praise | null = null;
  private shakeStart = -1;
  private shakeAmount = 0;

  constructor(private reducedMotion: () => boolean) {}

  /** Anything still animating? Drives whether the loop keeps drawing. */
  get active(): boolean {
    return (
      this.pops.length > 0 ||
      this.particles.length > 0 ||
      this.praise !== null ||
      this.shakeStart >= 0
    );
  }

  clear(): void {
    this.pops = [];
    this.particles = [];
    this.praise = null;
    this.shakeStart = -1;
  }

  /** One word, over the board. Replaces any word still on screen. */
  say(text: string, now: number, hot = false): void {
    this.praise = { text, start: now, hot };
  }

  spawn(burst: ClearBurst, layout: Layout, now: number): void {
    const cell = layout.board.cell;
    const reduced = this.reducedMotion();

    for (const { cell: index, color, hadMarker } of burst.cells) {
      const x = index % N;
      const y = Math.floor(index / N);
      // Chebyshev distance reads as a square wave rolling outward, which
      // matches the grid better than a circular one.
      const distance = Math.max(
        Math.abs(x - burst.originX),
        Math.abs(y - burst.originY),
      );

      this.pops.push({
        x,
        y,
        color,
        marker: hadMarker,
        start: now + (reduced ? 0 : distance * STAGGER_MS),
      });

      if (reduced || this.particles.length >= MAX_PARTICLES) continue;

      for (let i = 0; i < PARTICLES_PER_CELL; i++) {
        const angle = (Math.PI * 2 * i) / PARTICLES_PER_CELL + Math.random();
        const speed = (0.35 + Math.random() * 0.5) * cell;
        this.particles.push({
          x: layout.board.x + (x + 0.5) * cell,
          y: layout.board.y + (y + 0.5) * cell,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed - cell * 0.35,
          color,
          size: cell * (0.09 + Math.random() * 0.08),
          start: now + distance * STAGGER_MS,
        });
      }
    }

    // Screen shake only on three lines or more. Any lower and it reads as a
    // bug rather than as impact.
    if (burst.lines >= 3 && !reduced) {
      this.shakeStart = now;
      this.shakeAmount = Math.min(1, (burst.lines - 2) / 3);
    }
  }

  /** Current shake offset in CSS pixels. Applied to the whole board. */
  shakeOffset(now: number): { x: number; y: number } {
    if (this.shakeStart < 0) return { x: 0, y: 0 };
    const t = (now - this.shakeStart) / SHAKE_MS;
    if (t >= 1) {
      this.shakeStart = -1;
      return { x: 0, y: 0 };
    }
    const decay = (1 - t) * this.shakeAmount * SHAKE_PX;
    return {
      x: Math.sin(now / 11) * decay,
      y: Math.cos(now / 8) * decay,
    };
  }

  draw(ctx: CanvasRenderingContext2D, layout: Layout, now: number): void {
    this.drawPops(ctx, layout, now);
    this.drawParticles(ctx, now);
    this.drawPraise(ctx, layout, now);
  }

  private drawPraise(
    ctx: CanvasRenderingContext2D,
    layout: Layout,
    now: number,
  ): void {
    const praise = this.praise;
    if (!praise) return;

    const t = (now - praise.start) / PRAISE_MS;
    if (t >= 1) {
      this.praise = null;
      return;
    }

    const b = layout.board;
    // Overshoot in, hold, drift up and out.
    const grow = t < 0.18 ? easeOutBack(t / 0.18) : 1;
    const scale = 0.75 + grow * 0.25;
    const rise = t > 0.55 ? ((t - 0.55) / 0.45) * b.cell * 0.7 : 0;
    const alpha = t > 0.6 ? 1 - (t - 0.6) / 0.4 : Math.min(1, t / 0.12);

    const cx = b.x + b.w / 2;
    const cy = b.y + b.h * 0.42 - rise;

    ctx.save();
    ctx.globalAlpha = Math.max(0, alpha);

    // Long phrases ("unbelievable", "the nook is yours") would run off the
    // board at the headline size, so measure once and shrink to fit.
    const face = (px: number): string =>
      `700 ${px}px ui-sans-serif, system-ui, sans-serif`;
    let size = b.cell * 0.86;
    ctx.font = face(size);
    const width = ctx.measureText(praise.text).width;
    const maxWidth = b.w * 0.88;
    if (width > maxWidth) size *= maxWidth / width;

    ctx.font = face(Math.round(size * scale));
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.lineWidth = Math.max(3, size * 0.16);
    ctx.strokeStyle = 'rgba(26, 29, 35, 0.9)';
    ctx.strokeText(praise.text, cx, cy);
    ctx.fillStyle = praise.hot ? '#E0A032' : '#EFE8DA';
    ctx.fillText(praise.text, cx, cy);
    ctx.restore();
  }

  private drawPops(
    ctx: CanvasRenderingContext2D,
    layout: Layout,
    now: number,
  ): void {
    const b = layout.board;
    const alive: Pop[] = [];

    for (const pop of this.pops) {
      const t = (now - pop.start) / POP_MS;
      if (t >= 1) continue;
      alive.push(pop);
      if (t < 0) continue;

      // Up to 1.35x on the way out, then gone. The overshoot is the "pop".
      const scale = t < 0.35 ? 1 + (t / 0.35) * 0.35 : 1.35 - ((t - 0.35) / 0.65) * 1.35;
      const size = b.cell * Math.max(0, scale);
      const cx = b.x + (pop.x + 0.5) * b.cell;
      const cy = b.y + (pop.y + 0.5) * b.cell;

      ctx.save();
      ctx.globalAlpha = Math.max(0, 1 - t * t);
      ctx.fillStyle = pop.marker ? '#FFF3CE' : (ENAMEL[pop.color] ?? ENAMEL[1]!);
      const r = size * 0.17;
      roundRect(ctx, cx - size / 2, cy - size / 2, size, size, r);
      ctx.fill();
      ctx.restore();
    }

    this.pops = alive;
  }

  private drawParticles(ctx: CanvasRenderingContext2D, now: number): void {
    const alive: Particle[] = [];

    for (const p of this.particles) {
      const elapsed = now - p.start;
      if (elapsed >= PARTICLE_MS) continue;
      alive.push(p);
      if (elapsed < 0) continue;

      const t = elapsed / PARTICLE_MS;
      // Seconds since spawn, with a little gravity.
      const s = elapsed / 1000;
      const x = p.x + p.vx * s;
      const y = p.y + p.vy * s + 900 * s * s * 0.5;

      ctx.save();
      ctx.globalAlpha = Math.max(0, 1 - t);
      ctx.fillStyle = ENAMEL[p.color] ?? ENAMEL[1]!;
      ctx.beginPath();
      ctx.arc(x, y, p.size * (1 - t * 0.4), 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    this.particles = alive;
  }
}

/** Overshoots then settles. */
function easeOutBack(t: number): number {
  const c = 2.2;
  return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2);
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}
