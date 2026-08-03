// The screen-reader announcer, and nothing else.
//
// The score, the run multiplier and the key count used to live here as DOM
// chrome above the board. They are canvas objects now — an engraved brass plate
// and enamel lights along the bezel, per the art direction — which leaves this
// file responsible for the one thing canvas genuinely cannot do: telling a
// screen reader what just happened.
//
// That split is deliberate. Moving a HUD into a canvas is the classic way to
// silently drop accessibility, so the live region got *more* detailed in the
// move, not less: it now carries the score, the run and the keys, because they
// are no longer readable anywhere else in the DOM.

import type { GameState } from '../core/game';

export class Hud {
  private readonly announcer: HTMLElement;

  constructor(root: ParentNode = document) {
    this.announcer = must(root, '#announcer');
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
  // Flames are the one marker whose effect is not visible in the score, so a
  // screen-reader player has no other way to know the board just opened up.
  if (event.chargesFired === 1) parts.push('flame. the space around it burned.');
  else if (event.chargesFired > 1) {
    parts.push(`${event.chargesFired} flames. the space around them burned.`);
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
