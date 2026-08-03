import { describe, expect, it } from 'vitest';
import { N } from '../core/board';
import { cellAt, computeLayout, contains } from './layout';

/**
 * Viewports worth caring about: tall phones, short landscape phones, tablets,
 * desktops, and a couple of deliberately hostile ones.
 */
const VIEWPORTS: ReadonlyArray<[number, number]> = [
  [320, 568], // iPhone SE
  [390, 844], // iPhone 14
  [412, 915], // Pixel
  [768, 1024], // iPad portrait
  [1024, 768], // iPad landscape
  [1440, 900], // laptop
  [844, 390], // phone in landscape — very short
  [300, 300], // absurdly small
  [1920, 400], // very wide and very short
];

/**
 * The run lights are drawn centred on the board's top edge, so half of each one
 * lives above the board rectangle. The renderer sizes them from this same
 * fraction of the board's width — see `RUN_LIGHT_ROOM`.
 */
const RUN_LIGHT_ROOM = 0.028;

describe('computeLayout', () => {
  it('always leaves room above the board for the bezel lights', () => {
    // The bug this guards: with a tight viewport `boardY` rounded down to
    // nearly zero and the top half of every run light was sliced off by the
    // edge of the canvas.
    for (const [w, h] of VIEWPORTS) {
      const l = computeLayout(w, h);
      expect(l.board.y).toBeGreaterThanOrEqual(l.board.w * RUN_LIGHT_ROOM);
    }
  });

  it('leaves room below the board for the jackpot meter', () => {
    // The skirt is the crown's mirror image. Unlike the crown it is reported in
    // pixels on the layout, so the renderer cannot drift out of step with it.
    for (const [w, h] of VIEWPORTS) {
      const l = computeLayout(w, h);
      expect(l.skirt).toBeGreaterThan(0);
      expect(l.plate.y).toBeGreaterThanOrEqual(l.board.y + l.board.h + l.skirt);
    }
  });

  it('keeps the whole stack on screen', () => {
    for (const [w, h] of VIEWPORTS) {
      const l = computeLayout(w, h);
      expect(l.board.x).toBeGreaterThanOrEqual(0);
      expect(l.board.x + l.board.w).toBeLessThanOrEqual(w);
      // The tray is the last thing down the column.
      const tray = l.slots[l.slots.length - 1]!;
      expect(tray.y + tray.h).toBeLessThanOrEqual(h + 1);
    }
  });

  it('orders the column: board, then plate, then tray', () => {
    for (const [w, h] of VIEWPORTS) {
      const l = computeLayout(w, h);
      expect(l.plate.y).toBeGreaterThanOrEqual(l.board.y + l.board.h);
      expect(l.nook.y).toBeGreaterThanOrEqual(l.plate.y + l.plate.h);
    }
  });

  it('never overlaps the plate with the board or the tray', () => {
    for (const [w, h] of VIEWPORTS) {
      const l = computeLayout(w, h);
      const plateBottom = l.plate.y + l.plate.h;
      expect(l.board.y + l.board.h).toBeLessThanOrEqual(l.plate.y);
      expect(plateBottom).toBeLessThanOrEqual(l.nook.y);
    }
  });

  it('keeps the plate inside the board’s width', () => {
    for (const [w, h] of VIEWPORTS) {
      const l = computeLayout(w, h);
      expect(l.plate.x).toBeGreaterThanOrEqual(l.board.x);
      expect(l.plate.x + l.plate.w).toBeLessThanOrEqual(l.board.x + l.board.w);
    }
  });

  it('gives whole-pixel cells', () => {
    for (const [w, h] of VIEWPORTS) {
      const l = computeLayout(w, h);
      expect(Number.isInteger(l.board.w / N)).toBe(true);
    }
  });

  it('maps points back to the cells they are drawn in', () => {
    const l = computeLayout(390, 844);
    const b = l.board;
    expect(cellAt(l, b.x + b.cell * 0.5, b.y + b.cell * 0.5)).toEqual({ x: 0, y: 0 });
    expect(cellAt(l, b.x + b.cell * 7.5, b.y + b.cell * 7.5)).toEqual({ x: 7, y: 7 });
    // Just outside on every side.
    expect(cellAt(l, b.x - 1, b.y + 1)).toBeNull();
    expect(cellAt(l, b.x + 1, b.y - 1)).toBeNull();
    expect(cellAt(l, b.x + b.w + 1, b.y + 1)).toBeNull();
    expect(cellAt(l, b.x + 1, b.y + b.h + 1)).toBeNull();
  });

  it('puts the Nook and the tray slots side by side without overlapping', () => {
    const l = computeLayout(390, 844);
    const boxes = [l.nook, ...l.slots];
    for (let i = 1; i < boxes.length; i++) {
      expect(boxes[i]!.x).toBeGreaterThanOrEqual(boxes[i - 1]!.x + boxes[i - 1]!.w);
    }
    // And none of them claims a point inside its neighbour.
    expect(contains(l.nook, l.slots[0]!.x + 1, l.slots[0]!.y + 1)).toBe(false);
  });
});
