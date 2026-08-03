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
import { BRASS, ENAMEL, IVORY } from './sprites';

/** Cell pop, start to finish. */
const POP_MS = 260;
/** Delay per step of distance from the placement — the wave. */
const STAGGER_MS = 15;
const PARTICLE_MS = 520;
const PARTICLES_PER_CELL = 9;
/** Hard cap so a five-line sweep can't tank the frame rate on an old phone. */
const MAX_PARTICLES = 600;

/** Coins live longer than debris — they are the payout, so let them land. */
const COIN_MS = 900;

const SHAKE_MS = 220;
/** Every clear shakes now; the amount is what separates a single from a sweep. */
const SHAKE_PX = 7;

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
  /** Palette index, or `COIN` for a gold disc. */
  readonly color: number;
  readonly start: number;
  readonly size: number;
  /** Coins tumble; debris does not. Radians per second. */
  readonly spin: number;
  readonly life: number;
}

/** Sentinel colour: not a palette index, a minted coin. */
const COIN = -1;

export interface ClearBurst {
  readonly cells: readonly ClearedCell[];
  /** Where the piece landed — the wave travels out from here. */
  readonly originX: number;
  readonly originY: number;
  readonly lines: number;
  /** Streak after this clear. A long run earns impact a single wouldn't. */
  readonly run: number;
}

const PRAISE_MS = 950;

/**
 * The praise ladder.
 *
 * The house voice is the machine's voice: every rung shouts, and the ladder is
 * about *how much*, not about whether. This used to climb out of a deliberately
 * quiet register — the low rungs were lowercase and the shouting was rationed
 * for a clear that had earned it. That reservation is gone; what remains is the
 * escalation itself, which is the part that was actually doing the work.
 */
export const PRAISE = [
  'NICE',
  'SWEET',
  'BIG WIN',
  'HUGE',
  'MEGA WIN',
  'JACKPOT',
  'LEGENDARY',
] as const;

/** At and above this rung the word is drawn hot, in gold rather than bone. */
const HOT_RUNG = 2;

/**
 * How impressive a clear was. Lines and streak both feed it, so a single row
 * deep into a run earns praise the same way a triple does cold.
 *
 * Every clear says *something*. The old threshold started at two, which meant
 * the overwhelmingly common case — a single line at the start of a run — got a
 * silent pop and nothing else. "Praising everything praises nothing" is true of
 * praising everything *equally*; a ladder that starts quietly and climbs is a
 * different thing, and the bottom rung still has to exist for the climb to read.
 */
export function praiseFor(lines: number, run: number): string | null {
  if (lines <= 0) return null;
  const heat = lines + Math.max(0, run - 1);
  return PRAISE[Math.min(heat - 1, PRAISE.length - 1)]!;
}

/** Whether a clear of this size deserves the brass treatment. */
export function praiseIsHot(lines: number, run: number): boolean {
  const heat = lines + Math.max(0, run - 1);
  return heat - 1 >= HOT_RUNG;
}

interface Praise {
  readonly text: string;
  readonly start: number;
  readonly hot: boolean;
}

/** How long a score reading floats before it's gone. */
const SCORE_MS = 900;
/** A gain at or above this is drawn big and hot. */
const SCORE_HOT = 100;

interface ScorePop {
  readonly text: string;
  /** Board cell the piece landed on. Resolved to pixels at draw time. */
  readonly x: number;
  readonly y: number;
  readonly start: number;
  readonly hot: boolean;
}

/**
 * The settle, start to finish. The checklist asks for ~120ms with a short
 * overshoot; this is that, spent on scale rather than on position.
 *
 * Tweening the sprite from where the finger let go to where it landed would
 * fight the reducer, which has already applied the placement — the cells are
 * on the board the instant the action returns. Overshooting their scale reads
 * as the same thing: the piece arrives with weight instead of teleporting.
 */
const LAND_MS = 130;

interface Landing {
  /** Board cell index. */
  readonly cell: number;
  readonly start: number;
}

export class Effects {
  private pops: Pop[] = [];
  private particles: Particle[] = [];
  private praise: Praise | null = null;
  private scores: ScorePop[] = [];
  private landings: Landing[] = [];
  private shakeStart = -1;
  private shakeAmount = 0;

  constructor(private reducedMotion: () => boolean) {}

  /** Anything still animating? Drives whether the loop keeps drawing. */
  get active(): boolean {
    return (
      this.pops.length > 0 ||
      this.particles.length > 0 ||
      this.praise !== null ||
      this.scores.length > 0 ||
      this.landings.length > 0 ||
      this.shakeStart >= 0
    );
  }

  clear(): void {
    this.pops = [];
    this.particles = [];
    this.praise = null;
    this.scores = [];
    this.landings = [];
    this.shakeStart = -1;
  }

  /** A piece has just landed: overshoot its cells home. */
  land(cells: readonly number[], now: number): void {
    if (this.reducedMotion()) return;
    for (const cell of cells) this.landings.push({ cell, start: now });
  }

  /**
   * Scale for a cell the renderer is about to draw, or 1 if it isn't settling.
   * The renderer asks per cell rather than the effects layer drawing over the
   * top, so the settle applies to the real block with its real sprite.
   */
  landScale(cell: number, now: number): number {
    for (const landing of this.landings) {
      if (landing.cell !== cell) continue;
      const t = (now - landing.start) / LAND_MS;
      if (t < 0 || t >= 1) continue;
      // 0.82 up through a slight overshoot and back to 1.
      return 0.82 + easeOutBack(t) * 0.18;
    }
    return 1;
  }

  /** Drop finished landings. Called once a frame by the renderer. */
  private reapLandings(now: number): void {
    if (this.landings.length === 0) return;
    this.landings = this.landings.filter(
      (l) => now - l.start < LAND_MS,
    );
  }

  /** One word, over the board. Replaces any word still on screen. */
  say(text: string, now: number, hot = false): void {
    this.praise = { text, start: now, hot };
  }

  /**
   * The number, floating up from where the piece landed.
   *
   * The score plate already rolls, but it lives up in the header, away from
   * where the player is looking. Putting the gain at the point of contact is
   * what connects the placement to the reward.
   */
  score(gained: number, x: number, y: number, now: number): void {
    // A number flying across the board is motion, not decoration — it belongs
    // behind the same gate as the particles and the shake.
    if (this.reducedMotion()) return;
    this.scores.push({
      text: `+${gained.toLocaleString('en-US')}`,
      x,
      y,
      start: now,
      hot: gained >= SCORE_HOT,
    });
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

      const px = layout.board.x + (x + 0.5) * cell;
      const py = layout.board.y + (y + 0.5) * cell;

      for (let i = 0; i < PARTICLES_PER_CELL; i++) {
        const angle = (Math.PI * 2 * i) / PARTICLES_PER_CELL + Math.random();
        const speed = (0.35 + Math.random() * 0.5) * cell;
        // Every third one is money. Mixing coins into the debris rather than
        // spawning a separate wave keeps the count — and the frame budget —
        // where it was, and reads better anyway: the block breaks and pays.
        const coin = i % 3 === 0;
        this.particles.push({
          x: px,
          y: py,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed - cell * (coin ? 0.9 : 0.35),
          color: coin ? COIN : color,
          size: cell * (coin ? 0.15 : 0.09 + Math.random() * 0.08),
          spin: coin ? (Math.random() - 0.5) * 18 : 0,
          life: coin ? COIN_MS : PARTICLE_MS,
          start: now + distance * STAGGER_MS,
        });
      }
    }

    // Every clear shakes. The old floor of two lines meant the single — by far
    // the most common clear in the game — landed with no impact at all, which
    // is exactly the wrong place to be economical.
    const impact = burst.lines + Math.max(0, burst.run - 2);
    if (!reduced) {
      this.shakeStart = now;
      this.shakeAmount = Math.min(1, impact / 4);
    }
  }

  /**
   * The jackpot. A fountain of coins up the whole board, and the word.
   *
   * Its own method rather than a flag on `spawn()` because it is not a per-cell
   * effect — nothing cleared, the meter simply filled, so there are no cells to
   * radiate from. The coins come up off the bottom edge like a payout tray.
   */
  jackpot(layout: Layout, now: number): void {
    this.say('JACKPOT', now, true);
    if (this.reducedMotion()) return;

    const b = layout.board;
    this.shakeStart = now;
    this.shakeAmount = 1;

    const coins = Math.min(90, MAX_PARTICLES - this.particles.length);
    for (let i = 0; i < coins; i++) {
      const speed = (1.1 + Math.random() * 1.1) * b.cell;
      const angle = -Math.PI / 2 + (Math.random() - 0.5) * 1.5;
      this.particles.push({
        x: b.x + Math.random() * b.w,
        y: b.y + b.h,
        vx: Math.cos(angle) * speed * 0.6,
        vy: Math.sin(angle) * speed,
        color: COIN,
        size: b.cell * (0.13 + Math.random() * 0.1),
        spin: (Math.random() - 0.5) * 22,
        life: COIN_MS * 1.5,
        // Staggered over a third of a second so it pours rather than puffs.
        start: now + Math.random() * 320,
      });
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
    this.reapLandings(now);
    this.drawPops(ctx, layout, now);
    this.drawParticles(ctx, now);
    this.drawScores(ctx, layout, now);
    this.drawPraise(ctx, layout, now);
  }

  private drawScores(
    ctx: CanvasRenderingContext2D,
    layout: Layout,
    now: number,
  ): void {
    const b = layout.board;
    const alive: ScorePop[] = [];

    for (const pop of this.scores) {
      const t = (now - pop.start) / SCORE_MS;
      if (t >= 1) continue;
      alive.push(pop);

      // Overshoot in, then drift steadily upward and fade.
      const grow = t < 0.2 ? easeOutBack(t / 0.2) : 1;
      const size = b.cell * (pop.hot ? 0.62 : 0.46) * (0.6 + grow * 0.4);
      const rise = t * b.cell * 1.3;
      const alpha = t > 0.55 ? 1 - (t - 0.55) / 0.45 : 1;

      const cx = b.x + (pop.x + 0.5) * b.cell;
      const cy = b.y + (pop.y + 0.5) * b.cell - rise;

      ctx.save();
      ctx.globalAlpha = Math.max(0, alpha);
      ctx.font = `700 ${Math.round(size)}px ui-sans-serif, system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineJoin = 'round';
      ctx.lineWidth = Math.max(2, size * 0.2);
      ctx.strokeStyle = 'rgba(11, 7, 16, 0.92)';
      ctx.strokeText(pop.text, cx, cy);
      ctx.fillStyle = pop.hot ? BRASS : IVORY;
      ctx.fillText(pop.text, cx, cy);
      ctx.restore();
    }

    this.scores = alive;
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
    ctx.strokeStyle = 'rgba(11, 7, 16, 0.92)';
    ctx.strokeText(praise.text, cx, cy);
    ctx.fillStyle = praise.hot ? BRASS : IVORY;
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
      if (elapsed >= p.life) continue;
      alive.push(p);
      if (elapsed < 0) continue;

      const t = elapsed / p.life;
      // Seconds since spawn, with a little gravity.
      const s = elapsed / 1000;
      const x = p.x + p.vx * s;
      const y = p.y + p.vy * s + 900 * s * s * 0.5;

      ctx.save();
      // Coins hold their opacity until near the end — a coin that fades out
      // halfway through its arc reads as a spark, and the whole point is that
      // it is money that lands.
      ctx.globalAlpha = p.color === COIN
        ? Math.max(0, Math.min(1, (1 - t) * 3))
        : Math.max(0, 1 - t);

      if (p.color === COIN) drawCoin(ctx, x, y, p.size, s * p.spin);
      else {
        ctx.fillStyle = ENAMEL[p.color] ?? ENAMEL[1]!;
        ctx.beginPath();
        ctx.arc(x, y, p.size * (1 - t * 0.4), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    this.particles = alive;
  }
}

/**
 * A coin, tumbling. Drawn as an ellipse whose width is the cosine of its spin,
 * which is what an actual spinning disc does — and it costs one `Math.cos`
 * rather than a transform and a second path.
 */
function drawCoin(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  angle: number,
): void {
  const face = Math.abs(Math.cos(angle));
  ctx.beginPath();
  ctx.ellipse(x, y, Math.max(0.4, size * face), size, 0, 0, Math.PI * 2);
  ctx.fillStyle = BRASS;
  ctx.fill();
  // A darker edge, so the coin has a thickness when it turns side-on.
  ctx.lineWidth = Math.max(0.5, size * 0.22);
  ctx.strokeStyle = '#A2721A';
  ctx.stroke();
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
