// The end-of-run panel, the mode switch and the level goal chips. Copy stays
// lowercase and unbothered — the category is uniformly shouty, and being calm
// is free differentiation.

import type { GameState } from '../core/game';
import { goalMet, shortGoal, type Level } from '../core/levels';

export type Mode = 'endless' | 'daily' | 'levels';

export interface PanelHandlers {
  onRestart(): void;
  onShare(): void;
  onCopy(): void;
  onNextLevel(): void;
}

/** What to show when a run stops. */
export interface PanelView {
  readonly title: string;
  readonly score: number;
  readonly best: number;
  readonly bestLabel: string;
  readonly canAdvance: boolean;
  readonly restartLabel: string;
  /** The shareable result, shown verbatim so it can always be copied by hand. */
  readonly result?: string;
  /** Whether an OS share sheet is worth offering alongside copy. */
  readonly canShareSheet?: boolean;
}

export class EndPanel {
  private readonly panel: HTMLElement;
  private readonly title: HTMLElement;
  private readonly score: HTMLElement;
  private readonly best: HTMLElement;
  private readonly bestLabel: HTMLElement;
  private readonly bestRow: HTMLElement;
  private readonly share: HTMLButtonElement;
  private readonly copy: HTMLButtonElement;
  private readonly next: HTMLButtonElement;
  private readonly result: HTMLElement;
  private readonly restart: HTMLButtonElement;
  private readonly note: HTMLElement;

  constructor(handlers: PanelHandlers, root: ParentNode = document) {
    this.panel = must(root, '#panel');
    this.title = must(root, '.panel-title');
    this.score = must(root, '#panel-score');
    this.best = must(root, '#panel-best');
    this.bestLabel = must(root, '#panel-best-label');
    this.bestRow = must(root, '.panel-best');
    this.note = must(root, '#share-note');
    this.share = must(root, '#share') as HTMLButtonElement;
    this.copy = must(root, '#copy') as HTMLButtonElement;
    this.next = must(root, '#next-level') as HTMLButtonElement;
    this.restart = must(root, '#restart') as HTMLButtonElement;
    this.result = must(root, '#share-result');

    this.restart.addEventListener('click', handlers.onRestart);
    this.share.addEventListener('click', handlers.onShare);
    this.copy.addEventListener('click', handlers.onCopy);
    this.next.addEventListener('click', handlers.onNextLevel);
  }

  show(view: PanelView): void {
    this.title.textContent = view.title;
    this.score.textContent = view.score.toLocaleString('en-US');
    this.best.textContent = view.best.toLocaleString('en-US');
    this.bestLabel.textContent = view.bestLabel;
    this.bestRow.hidden = view.best <= 0;

    const result = view.result ?? '';
    this.result.textContent = result;
    this.result.hidden = result.length === 0;
    this.copy.hidden = result.length === 0;
    this.share.hidden = result.length === 0 || view.canShareSheet !== true;

    this.next.hidden = !view.canAdvance;
    this.restart.textContent = view.restartLabel;
    this.note.textContent = '';
    this.panel.hidden = false;
  }

  hide(): void {
    this.panel.hidden = true;
    this.note.textContent = '';
  }

  says(message: string): void {
    this.note.textContent = message;
  }
}

/** Three tabs. Endless is the default; today is the reason to come back. */
export class ModeTabs {
  private readonly buttons: Record<Mode, HTMLButtonElement>;
  private readonly label: HTMLElement;

  constructor(onPick: (mode: Mode) => void, root: ParentNode = document) {
    this.buttons = {
      endless: must(root, '#mode-endless') as HTMLButtonElement,
      daily: must(root, '#mode-daily') as HTMLButtonElement,
      levels: must(root, '#mode-levels') as HTMLButtonElement,
    };
    this.label = must(root, '#daily-label');

    (Object.keys(this.buttons) as Mode[]).forEach((mode) => {
      this.buttons[mode].addEventListener('click', () => onPick(mode));
    });
  }

  set(mode: Mode, caption: string): void {
    (Object.keys(this.buttons) as Mode[]).forEach((key) => {
      const on = key === mode;
      this.buttons[key].classList.toggle('is-on', on);
      this.buttons[key].setAttribute('aria-pressed', String(on));
    });

    this.label.hidden = caption.length === 0;
    this.label.textContent = caption;
  }
}

/** The level's objectives, ticking over as they're met. */
export class GoalChips {
  private readonly root: HTMLElement;
  private rendered = '';

  constructor(root: ParentNode = document) {
    this.root = must(root, '#goals');
  }

  hide(): void {
    this.root.hidden = true;
    this.root.replaceChildren();
    this.rendered = '';
  }

  render(level: Level, state: GameState): void {
    const chips = level.goals.map((goal) => ({
      text: shortGoal(goal, state),
      met: goalMet(goal, state),
    }));

    // Rebuilding the DOM every frame would thrash; only touch it on a change.
    const key = chips.map((c) => `${c.text}${c.met ? '!' : ''}`).join('|');
    if (key === this.rendered) return;
    this.rendered = key;

    this.root.hidden = false;
    this.root.replaceChildren(
      ...chips.map((chip) => {
        const el = document.createElement('span');
        el.className = chip.met ? 'goal is-met' : 'goal';
        el.textContent = chip.text;
        return el;
      }),
    );
  }
}

function must(root: ParentNode, selector: string): HTMLElement {
  const el = root.querySelector<HTMLElement>(selector);
  if (!el) throw new Error(`missing element ${selector}`);
  return el;
}
