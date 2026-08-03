// Hand-written canvas renderer. Board, tray and Nook are canvas; everything
// else (score, panels, settings) is DOM, which keeps text and accessibility
// easy and leaves the canvas doing only what canvas is good at.

import { N, isFilled } from '../core/board';
import type { MarkerKind, Preview, Slot, Source } from '../core/game';
import { type GameState, markerAt, slotFits } from '../core/game';
import { fogHides } from '../core/mutators';
import { piece, type PieceId } from '../core/pieces';
import {
  JACKPOT_FULL,
  MAX_RUN_MULTIPLIER,
  jackpotReady,
  runMultiplier,
} from '../core/scoring';
import { reducedMotion } from '../platform/motion';
import { Effects } from './effects';
import { Roller } from './roller';
import { computeLayout, trayCellFor, type Layout, type Rect } from './layout';
import {
  BRASS,
  FELT,
  IVORY,
  RECESS,
  SpriteCache,
  drawGemPath,
  type SpriteSheet,
} from './sprites';

/** What the input layer is currently doing, as far as drawing is concerned. */
export interface DragView {
  readonly source: Source;
  readonly index: number;
  readonly piece: PieceId;
  readonly color: number;
  /** Where to draw the piece's top-left cell, in CSS pixels. */
  readonly ghostX: number;
  readonly ghostY: number;
  /** The board anchor it would snap to, or null if nothing is in range. */
  readonly snap: { readonly x: number; readonly y: number } | null;
  /** Index into the piece's cells carrying a marker, or NO_MARKER. */
  readonly marker: number;
  readonly markerKind: MarkerKind;
  /** performance.now() when this piece was picked up, for the lift animation. */
  readonly liftedAt: number;
  readonly preview: Preview;
  readonly overNook: boolean;
  /** A dragged piece leaves its slot; a keyboard-selected one stays put. */
  readonly hideSource: boolean;
}

const DPR_CAP = 3;
const GHOST_ALPHA = 0.35;

/** Dots on the bezel: exactly the clears it takes to reach the multiplier cap. */
const RUN_LIGHTS = (() => {
  let run = 1;
  while (runMultiplier(run) < MAX_RUN_MULTIPLIER && run < 32) run++;
  return run;
})();
const DEAD_ALPHA = 0.4;

/** How much wider than the dot the felt punch behind it is. */
const PUNCH_SCALE = 1.75;
/**
 * Vertical room a run light may occupy above the board, as a fraction of the
 * board's width. Mirrors `CROWN_RATIO` in the layout, which reserves it.
 */
const RUN_LIGHT_ROOM = 0.028;

/** Pickup lift, per the game-feel checklist: ~1.15x with a shadow. */
const LIFT_SCALE = 0.15;
const LIFT_MS = 130;

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));

/** Overshoots slightly then settles — the difference between snap and pop. */
function easeOutBack(t: number): number {
  const c = 1.9;
  return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2);
}


export class Renderer {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly sprites = new SpriteCache();
  private dpr = 1;

  /** Pops, particles and shake. Owned here so the loop can ask if it's busy. */
  readonly effects = new Effects(reducedMotion);

  private readonly roller = new Roller();

  layout: Layout;

  /** The element whose box drives the canvas size — never the canvas itself. */
  readonly host: HTMLElement;

  constructor(private readonly canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('canvas 2d context unavailable');
    this.ctx = ctx;
    this.host = canvas.parentElement ?? canvas;
    this.layout = computeLayout(1, 1);
    this.resize();
  }

  /** Re-measure and re-scale for the current size and device pixel ratio. */
  resize(): Layout {
    const rect = this.host.getBoundingClientRect();
    const cssWidth = Math.max(1, rect.width);
    const cssHeight = Math.max(1, rect.height);

    // Cap at 3 — 4× on some Androids is wasted fill rate.
    this.dpr = Math.min(window.devicePixelRatio || 1, DPR_CAP);
    this.canvas.width = Math.round(cssWidth * this.dpr);
    this.canvas.height = Math.round(cssHeight * this.dpr);
    this.canvas.style.width = `${cssWidth}px`;
    this.canvas.style.height = `${cssHeight}px`;
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    this.layout = computeLayout(cssWidth, cssHeight);
    return this.layout;
  }

  draw(
    state: GameState,
    view: DragView | null,
    now: number,
    endProgress = 0,
  ): void {
    const { ctx } = this;
    const l = this.layout;

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = FELT;
    ctx.fillRect(0, 0, l.width, l.height);

    // Shake moves the board and its debris, never the tray or the HUD —
    // shaking the thing you are about to aim at is just cruel.
    const shake = this.effects.shakeOffset(now);
    ctx.save();
    ctx.translate(shake.x, shake.y);
    this.drawBoard(state, view, now);
    this.effects.draw(ctx, l, now);
    ctx.restore();

    this.drawPlate(state, now);
    this.drawNook(state, view);
    this.drawTray(state, view);
    if (view) {
      this.drawDragged(view, now);
      this.drawGain(view);
    }

    if (endProgress > 0) this.drawEnding(endProgress);
  }

  /** Point the odometer at a new score. Called when the state changes. */
  setScore(score: number): void {
    this.roller.set(score);
  }

  /** Spin the reels up to a new score. A jackpot, and nothing else. */
  spinScore(score: number): void {
    this.roller.spin(score);
  }

  /** Jump the odometer with no roll — a fresh run, not a scoring event. */
  resetScore(score: number): void {
    this.roller.reset(score);
  }

  /** True while the digits are still moving, so the loop keeps drawing. */
  get rolling(): boolean {
    return this.roller.rolling;
  }

  /**
   * The engraved brass plate, and the signature object of the whole design:
   * "the score isn't a number in a corner. It's an engraved brass plate below
   * the board where digits roll like a mechanical odometer."
   *
   * The multiplier sits on the plate beside the score, and the keys ride the
   * right-hand end — everything about the run's state in one physical object
   * rather than scattered across DOM chrome above the board.
   */
  private drawPlate(state: GameState, now: number): void {
    const { ctx } = this;
    const p = this.layout.plate;
    const radius = p.h * 0.22;

    ctx.save();

    // The plate itself: dark metal in a gold bezel, sunk into the table.
    const metal = ctx.createLinearGradient(0, p.y, 0, p.y + p.h);
    metal.addColorStop(0, '#3B2F4D');
    metal.addColorStop(1, '#251D33');
    roundRect(ctx, p.x, p.y, p.w, p.h, radius);
    ctx.fillStyle = metal;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(240, 185, 58, 0.8)';
    ctx.stroke();

    const mid = p.y + p.h / 2;
    const pad = p.h * 0.34;
    const value = this.roller.read(now).toLocaleString('en-US');

    ctx.textBaseline = 'middle';

    // Keys ride the left end. Knowing the rescue is there changes how a tight
    // board feels long before it is ever spent.
    if (state.keys > 0) {
      ctx.font = `600 ${Math.round(p.h * 0.26)}px ui-sans-serif, system-ui, sans-serif`;
      ctx.textAlign = 'left';
      ctx.fillStyle = BRASS;
      ctx.fillText(state.keys === 1 ? 'key' : `${state.keys} keys`, p.x + pad, mid);
    }

    // The multiplier holds the right end, dormant at ×1 and lit the moment a
    // run starts. Score in the middle, so the plate reads left-to-right as
    // what you're holding, what you've scored, what it's worth.
    // The multiplier gets bigger as well as brighter as it climbs — at a
    // ceiling of ×10 it is the most exciting number on the plate and it should
    // not be sitting there in the same 30% type it wore at ×2.
    const m = runMultiplier(state.run);
    const heat = state.run <= 0 ? 0 : m / MAX_RUN_MULTIPLIER;
    ctx.font = `800 ${Math.round(p.h * (0.3 + heat * 0.16))}px ui-sans-serif, system-ui, sans-serif`;
    ctx.textAlign = 'right';
    ctx.fillStyle =
      state.run <= 0
        ? 'rgba(247, 238, 221, 0.3)'
        : m >= MAX_RUN_MULTIPLIER
          ? '#FFFFFF'
          : BRASS;
    ctx.fillText(`×${m}`, p.x + p.w - pad, mid);

    // Engraved: a dark impression offset down, then the ivory face on top.
    // Shrunk to fit if a long score would otherwise run into either end.
    const room = p.w - pad * 4.4;
    let digits = Math.round(p.h * 0.52);
    ctx.font = `600 ${digits}px ui-sans-serif, system-ui, sans-serif`;
    const width = ctx.measureText(value).width;
    if (width > room) {
      digits = Math.max(10, Math.floor(digits * (room / width)));
      ctx.font = `600 ${digits}px ui-sans-serif, system-ui, sans-serif`;
    }

    ctx.textAlign = 'center';
    const cx = p.x + p.w / 2;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
    ctx.fillText(value, cx, mid + Math.max(1, p.h * 0.035));
    ctx.fillStyle = IVORY;
    ctx.fillText(value, cx, mid);

    ctx.restore();
  }

  /**
   * The run, as filled enamel dots along the top bezel — the other half of the
   * design's signature, and the reason the streak is finally something you feel
   * rather than a number you would have to go looking for.
   *
   * On the bezel rather than above it: the run belongs to the board.
   */
  private drawRunLights(state: GameState, now: number): void {
    const { ctx } = this;
    const b = this.layout.board;

    const dots = RUN_LIGHTS;
    // The felt punch is the widest part of a light, so it — not the dot — is
    // what has to fit inside the crown `computeLayout` reserved above the
    // board. Sized from that budget rather than guessed at independently.
    const room = b.w * RUN_LIGHT_ROOM;
    const r = Math.max(2, Math.min(b.cell * 0.075, room / PUNCH_SCALE));
    const spacing = r * 3.2;
    const totalW = spacing * (dots - 1);
    const cx0 = b.x + b.w / 2 - totalW / 2;
    const cy = b.y;

    for (let i = 0; i < dots; i++) {
      const lit = i < state.run;
      const cx = cx0 + spacing * i;

      // Punch the felt back in behind each dot so it reads as set into the
      // bezel rather than floating on top of the stroke.
      ctx.beginPath();
      ctx.arc(cx, cy, r * PUNCH_SCALE, 0, Math.PI * 2);
      ctx.fillStyle = FELT;
      ctx.fill();

      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      if (lit) {
        // The newest dot breathes, so a climbing run is visible in motion.
        const newest = i === state.run - 1 && !reducedMotion();
        const pulse = newest ? 0.85 + 0.15 * Math.sin(now / 170) : 1;
        ctx.fillStyle = i >= dots - 1 ? '#FFFFFF' : BRASS;
        ctx.globalAlpha = pulse;
        ctx.fill();
        ctx.globalAlpha = 1;
      } else {
        ctx.fillStyle = 'rgba(247, 238, 221, 0.1)';
        ctx.fill();
      }
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(240, 185, 58, 0.35)';
      ctx.stroke();
    }
  }

  /**
   * The jackpot meter: a gold bar along the bottom bezel, filling as you clear.
   *
   * The crown carries the run and the skirt carries the bank, which puts the
   * two things a player is accumulating on opposite edges of the same object.
   * A meter you cannot see is not a mechanic, so this is drawn every frame
   * whether or not anything is happening to it — the point is that it is always
   * there to be glanced at, and that it is visibly *nearly* full for a while
   * before it goes off.
   */
  private drawJackpotMeter(state: GameState, now: number): void {
    const { ctx } = this;
    const b = this.layout.board;
    const skirt = this.layout.skirt;

    const h = Math.max(3, skirt * 0.5);
    const y = b.y + b.h + (skirt - h) / 2;
    const r = h / 2;
    const filled = Math.max(0, Math.min(1, state.jackpot / JACKPOT_FULL));
    const ready = jackpotReady(state.jackpot);

    ctx.save();

    // The empty channel.
    roundRect(ctx, b.x, y, b.w, h, r);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(240, 185, 58, 0.3)';
    ctx.stroke();

    if (filled > 0) {
      // Nearly full: throb. This is the visual half of the riser, and it is the
      // only thing on screen that is about something which has not happened.
      const pulse = ready && !reducedMotion() ? 0.78 + 0.22 * Math.sin(now / 110) : 1;
      const w = Math.max(h, b.w * filled);

      ctx.save();
      roundRect(ctx, b.x, y, w, h, r);
      ctx.clip();
      const fill = ctx.createLinearGradient(b.x, y, b.x + w, y);
      fill.addColorStop(0, '#B8791E');
      fill.addColorStop(1, ready ? '#FFF0B8' : BRASS);
      ctx.globalAlpha = pulse;
      ctx.fillStyle = fill;
      ctx.fillRect(b.x, y, w, h);
      ctx.restore();
    }

    ctx.restore();
  }

  /**
   * Board drains to greyscale before the panel arrives. The doc is right that
   * the moment needs to land — cutting straight to a score card reads as the
   * game being taken away from you.
   */
  private drawEnding(progress: number): void {
    const { ctx } = this;
    const b = this.layout.board;

    ctx.save();
    // 'saturation' takes the saturation of the source and the luminosity of
    // the backdrop, so filling with flat grey drains the colour out.
    ctx.globalCompositeOperation = 'saturation';
    ctx.globalAlpha = clamp01(progress);
    ctx.fillStyle = 'hsl(0, 0%, 50%)';
    ctx.fillRect(b.x - 4, b.y - 4, b.w + 8, b.h + 8);
    ctx.restore();
  }

  // --- board -------------------------------------------------------------

  private drawBoard(
    state: GameState,
    view: DragView | null,
    now: number,
  ): void {
    const { ctx } = this;
    const b = this.layout.board;
    const sheet = this.sprites.get(b.cell, this.dpr);

    // The recess the blocks sit in, with a brass bezel around the frame.
    roundRect(ctx, b.x, b.y, b.w, b.h, b.cell * 0.16);
    ctx.fillStyle = RECESS;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(240, 185, 58, 0.55)';
    ctx.stroke();

    this.drawRunLights(state, now);
    this.drawJackpotMeter(state, now);

    // Empty wells, so the grid reads as a physical object rather than lines.
    //
    // These were drawn at 2.8% white, which was survivable against the old
    // slate board and invisible against this one — and an empty grid you cannot
    // see is not a cosmetic problem, it is the game becoming unplayable. Filled
    // *and* outlined now, so every empty cell has a definite edge to aim at.
    ctx.fillStyle = 'rgba(255, 255, 255, 0.05)';
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.09)';
    ctx.lineWidth = Math.max(1, b.cell * 0.03);
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        if (isFilled(state.board, x, y)) continue;
        roundRect(
          ctx,
          b.x + x * b.cell + b.cell * 0.1,
          b.y + y * b.cell + b.cell * 0.1,
          b.cell * 0.8,
          b.cell * 0.8,
          b.cell * 0.14,
        );
        ctx.fill();
        ctx.stroke();
      }
    }

    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const color = state.colors[y * N + x] ?? 0;
        if (color === 0 || !isFilled(state.board, x, y)) continue;
        const px = b.x + x * b.cell;
        const py = b.y + y * b.cell;

        // A cell that just landed overshoots home rather than appearing.
        const scale = this.effects.landScale(y * N + x, now);
        if (scale !== 1) {
          const inset = (b.cell * (1 - scale)) / 2;
          const size = b.cell * scale;
          ctx.save();
          this.blit(sheet, color, px + inset, py + inset, size);
          const settling = markerAt(state, x, y);
          if (settling) {
            this.blitMarker(sheet, settling, px + inset, py + inset, size);
          }
          ctx.restore();
          continue;
        }

        this.blit(sheet, color, px, py, b.cell);
        const marker = markerAt(state, x, y);
        if (marker) this.blitMarker(sheet, marker, px, py, b.cell);
      }
    }

    if (view?.snap) {
      this.drawClearPreview(view, now);
      this.drawGhost(view);
    }
  }

  /**
   * Pulse the rows and columns this placement would clear. Pure UX, but it is
   * what makes the game readable on a small screen and it teaches the run
   * system without a tutorial.
   */
  private drawClearPreview(view: DragView, now: number): void {
    const { rows, cols } = view.preview.lines;
    if (rows.length === 0 && cols.length === 0) return;

    const { ctx } = this;
    const b = this.layout.board;
    // Reduced motion keeps the highlight, loses the throb.
    const alpha = reducedMotion() ? 0.22 : 0.18 + 0.09 * Math.sin(now / 190);

    ctx.save();
    ctx.fillStyle = `rgba(240, 185, 58, ${alpha})`;
    for (const y of rows) {
      ctx.fillRect(b.x, b.y + y * b.cell, b.w, b.cell);
    }
    for (const x of cols) {
      ctx.fillRect(b.x + x * b.cell, b.y, b.cell, b.h);
    }
    ctx.restore();
  }

  /** What this placement is worth, floating just above the ghost. */
  private drawGain(view: DragView): void {
    if (!view.snap || !view.preview.legal) return;

    const { ctx } = this;
    const b = this.layout.board;
    const p = piece(view.piece);

    const cx = b.x + (view.snap.x + p.w / 2) * b.cell;
    // Above the piece normally; below it when the piece is against the top
    // edge, so the label never sits on top of the blocks it describes.
    const above = b.y + view.snap.y * b.cell - b.cell * 0.42;
    const cy =
      above >= b.y + b.cell * 0.3
        ? above
        : b.y + (view.snap.y + p.h) * b.cell + b.cell * 0.42;

    ctx.save();
    ctx.font = `600 ${Math.round(b.cell * 0.42)}px ui-sans-serif, system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = Math.max(2, b.cell * 0.12);
    ctx.strokeStyle = 'rgba(11, 7, 16, 0.9)';
    ctx.fillStyle = view.preview.lines.rows.length + view.preview.lines.cols.length > 0
      ? BRASS
      : IVORY;

    const label = `+${view.preview.gained}`;
    ctx.strokeText(label, cx, cy);
    ctx.fillText(label, cx, cy);
    ctx.restore();
  }

  private drawGhost(view: DragView): void {
    const { ctx } = this;
    const b = this.layout.board;
    const snap = view.snap!;

    ctx.save();
    ctx.globalAlpha = GHOST_ALPHA;
    ctx.strokeStyle = IVORY;
    ctx.lineWidth = Math.max(1.5, b.cell * 0.07);
    for (const [dx, dy] of piece(view.piece).cells) {
      roundRect(
        ctx,
        b.x + (snap.x + dx) * b.cell + b.cell * 0.08,
        b.y + (snap.y + dy) * b.cell + b.cell * 0.08,
        b.cell * 0.84,
        b.cell * 0.84,
        b.cell * 0.15,
      );
      ctx.stroke();
    }
    ctx.restore();
  }

  // --- the Nook ----------------------------------------------------------

  private drawNook(state: GameState, view: DragView | null): void {
    const { ctx } = this;
    const r = this.layout.nook;

    // An alcove cut into the frame — same brass bezel, deeper shadow — not a
    // fourth tray slot.
    roundRect(ctx, r.x, r.y, r.w, r.h, r.w * 0.16);
    ctx.fillStyle = state.nookUnlocked ? '#1D1629' : '#150F1F';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = !state.nookUnlocked
      ? 'rgba(240, 185, 58, 0.14)'
      : state.nook && state.swapUsed
        ? 'rgba(240, 185, 58, 0.24)'
        : 'rgba(240, 185, 58, 0.5)';
    ctx.stroke();

    // Sealed: no word, just the shape of what opens it. The alcove is there
    // from the first frame so the goal teaches itself.
    if (!state.nookUnlocked) {
      // The one placement that would open it lights the alcove up, which is
      // where the gem and the alcove finally connect for the player.
      const opening = view?.preview.wouldUnlock ?? false;
      ctx.save();
      ctx.globalAlpha = opening ? 0.95 : 0.3;
      drawGemPath(ctx, r.x + r.w / 2, r.y + r.h / 2, r.w * 0.15);
      ctx.strokeStyle = BRASS;
      ctx.lineWidth = Math.max(1.5, r.w * (opening ? 0.032 : 0.022));
      ctx.stroke();
      ctx.restore();
      return;
    }

    if (view?.overNook) {
      ctx.save();
      ctx.globalAlpha = 0.5;
      ctx.strokeStyle = IVORY;
      ctx.lineWidth = 2;
      roundRect(ctx, r.x + 2, r.y + 2, r.w - 4, r.h - 4, r.w * 0.14);
      ctx.stroke();
      ctx.restore();
    }

    const lifted = view?.hideSource && view.source === 'nook';
    if (!state.nook || lifted) {
      ctx.save();
      ctx.globalAlpha = 0.28;
      ctx.fillStyle = IVORY;
      ctx.font = `${Math.round(r.h * 0.17)}px ui-sans-serif, system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('nook', r.x + r.w / 2, r.y + r.h / 2);
      ctx.restore();
      return;
    }

    // A stashed piece that no longer fits fades exactly like a tray piece.
    // It used to be pinned at full opacity, which quietly made the Nook the one
    // place the game wouldn't tell you the truth about your outs.
    this.drawPieceIn(r, state.nook, slotFits(state, state.nook) ? 1 : DEAD_ALPHA);
  }

  // --- tray --------------------------------------------------------------

  private drawTray(state: GameState, view: DragView | null): void {
    this.layout.slots.forEach((rect, i) => {
      const slot = state.tray[i];
      if (!slot) return;
      if (view?.hideSource && view.source === 'tray' && view.index === i) return;

      // Fog: the piece is real and placeable, you simply cannot read it yet.
      // Drawn as a covered slot rather than an empty one, so it is obvious
      // something is there and obvious that you are not allowed to plan it.
      if (fogHides(state.mutator, i, state.tray)) {
        this.drawFogged(rect);
        return;
      }

      // Dead pieces fade — vital readability, and it builds dread beautifully.
      this.drawPieceIn(rect, slot, slotFits(state, slot) ? 1 : DEAD_ALPHA);
    });
  }

  /** A slot under fog: something is in there, and you cannot see what. */
  private drawFogged(rect: Rect): void {
    const { ctx } = this;
    const inset = rect.w * 0.14;

    ctx.save();
    roundRect(ctx, rect.x + inset, rect.y + inset, rect.w - inset * 2, rect.h - inset * 2, rect.w * 0.14);
    ctx.fillStyle = 'rgba(247, 238, 221, 0.05)';
    ctx.fill();
    ctx.setLineDash([rect.w * 0.06, rect.w * 0.05]);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = 'rgba(240, 185, 58, 0.4)';
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.globalAlpha = 0.4;
    ctx.fillStyle = IVORY;
    ctx.font = `${Math.round(rect.h * 0.3)}px ui-sans-serif, system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('?', rect.x + rect.w / 2, rect.y + rect.h / 2);
    ctx.restore();
  }

  // --- the piece under the pointer ---------------------------------------

  private drawDragged(view: DragView, now: number): void {
    const { ctx } = this;
    const cell = this.layout.board.cell;
    const sheet = this.sprites.get(cell, this.dpr);
    const p = piece(view.piece);

    ctx.save();

    // Lift: the piece scales up as you pick it up, so it reads as coming off
    // the board rather than sliding along it. Scaled about its own centre.
    const lift = reducedMotion()
      ? 1
      : 1 + LIFT_SCALE * easeOutBack(clamp01((now - view.liftedAt) / LIFT_MS));
    if (lift !== 1) {
      const cx = view.ghostX + (p.w * cell) / 2;
      const cy = view.ghostY + (p.h * cell) / 2;
      ctx.translate(cx, cy);
      ctx.scale(lift, lift);
      ctx.translate(-cx, -cy);
    }
    // A keyboard-held piece hovers rather than being carried, and with no
    // finger on screen it would otherwise be indistinguishable from a placed
    // one. Nothing in range: tint invalid rather than hiding the piece —
    // silent failure just confuses.
    const homeless = !view.snap && !view.overNook;
    ctx.globalAlpha = view.hideSource ? 1 : 0.72;
    if (homeless) ctx.globalAlpha = 0.55;

    // The shadow used to be a real `shadowBlur` on each of up to five blits.
    // Canvas shadow blur is among the most expensive 2D operations on mobile
    // GPUs, and it ran every frame of every drag — precisely when the frame
    // budget matters most. A flat offset silhouette reads the same at a
    // fraction of the cost.
    ctx.save();
    ctx.globalAlpha *= 0.28;
    ctx.fillStyle = '#000';
    const drop = cell * 0.1;
    for (const [dx, dy] of p.cells) {
      roundRect(
        ctx,
        view.ghostX + dx * cell,
        view.ghostY + dy * cell + drop,
        cell,
        cell,
        cell * 0.18,
      );
      ctx.fill();
    }
    ctx.restore();

    p.cells.forEach(([dx, dy], i) => {
      const px = view.ghostX + dx * cell;
      const py = view.ghostY + dy * cell;
      this.blit(sheet, view.color, px, py, cell);
      if (i === view.marker) this.blitMarker(sheet, view.markerKind, px, py, cell);
    });

    // Nothing in range: wash the piece toward oxblood so refusal is a colour,
    // not just a slightly lower opacity nobody notices.
    //
    // Painted over the piece's own cells with ordinary alpha. A `source-atop`
    // composite would be the obvious way to do this and is wrong — it works
    // against everything already on the canvas, so it tinted the whole board
    // red wherever the rectangle happened to fall.
    if (homeless) {
      ctx.globalAlpha = 0.4;
      ctx.fillStyle = '#C4245E';
      for (const [dx, dy] of p.cells) {
        roundRect(
          ctx,
          view.ghostX + dx * cell,
          view.ghostY + dy * cell,
          cell,
          cell,
          cell * 0.18,
        );
        ctx.fill();
      }
    }
    ctx.restore();
  }

  // --- primitives --------------------------------------------------------

  /** Draw a piece centred inside a box, scaled to fit it. */
  private drawPieceIn(rect: Rect, slot: Slot, alpha: number): void {
    const { ctx } = this;
    const p = piece(slot.piece);
    const cell = trayCellFor(this.layout, p.w, p.h);
    const sheet = this.sprites.get(cell, this.dpr);

    const originX = rect.x + (rect.w - p.w * cell) / 2;
    const originY = rect.y + (rect.h - p.h * cell) / 2;

    ctx.save();
    ctx.globalAlpha = alpha;
    p.cells.forEach(([dx, dy], i) => {
      const px = originX + dx * cell;
      const py = originY + dy * cell;
      this.blit(sheet, slot.color, px, py, cell);
      if (i === slot.marker) this.blitMarker(sheet, slot.markerKind, px, py, cell);
    });
    ctx.restore();
  }

  private blit(
    sheet: SpriteSheet,
    color: number,
    x: number,
    y: number,
    size: number,
  ): void {
    const face = sheet.faces[color];
    if (face) this.ctx.drawImage(face, x, y, size, size);
  }

  private blitMarker(
    sheet: SpriteSheet,
    kind: MarkerKind,
    x: number,
    y: number,
    size: number,
  ): void {
    const sprite =
      kind === 'star' ? sheet.star : kind === 'charge' ? sheet.charge : sheet.gem;
    this.ctx.drawImage(sprite, x, y, size, size);
  }
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
