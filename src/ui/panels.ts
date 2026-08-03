// The end-of-run panel, the mode switch and the level goal chips. Copy stays
// lowercase and unbothered — the category is uniformly shouty, and being calm
// is free differentiation.

import type { GameState } from '../core/game';
import { goalMet, shortGoal, type Level } from '../core/levels';

export type Mode = 'endless' | 'daily' | 'levels' | 'rearrange';

export interface PanelHandlers {
  onRestart(): void;
  onShare(): void;
  onCopy(): void;
  onNextLevel(): void;
  onUseKey(): void;
  onDuel(): void;
}

/** What to show when a run stops. */
export interface PanelView {
  readonly title: string;
  readonly score: number;
  readonly best: number;
  readonly bestLabel: string;
  readonly canAdvance: boolean;
  readonly restartLabel: string;
  /** Keys in hand. Above zero, the run doesn't have to end here. */
  readonly keys?: number;
  /** This run beat the stored record. Worth saying so. */
  readonly isNewBest?: boolean;
  /** What it beat, for the delta. Only meaningful with `isNewBest`. */
  readonly previousBest?: number;
  /** Consecutive days played. Shown on the daily only. */
  readonly streak?: number;
  /** Offer to send this exact board to someone. Endless only. */
  readonly canDuel?: boolean;
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
  private readonly useKey: HTMLButtonElement;
  private readonly duel: HTMLButtonElement;
  private readonly record: HTMLElement;
  private readonly streak: HTMLElement;
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
    this.useKey = must(root, '#use-key') as HTMLButtonElement;
    this.duel = must(root, '#duel') as HTMLButtonElement;
    this.record = must(root, '#panel-record');
    this.streak = must(root, '#panel-streak');
    this.result = must(root, '#share-result');

    this.restart.addEventListener('click', handlers.onRestart);
    this.share.addEventListener('click', handlers.onShare);
    this.copy.addEventListener('click', handlers.onCopy);
    this.next.addEventListener('click', handlers.onNextLevel);
    this.useKey.addEventListener('click', handlers.onUseKey);
    this.duel.addEventListener('click', handlers.onDuel);
  }

  show(view: PanelView): void {
    this.title.textContent = view.title;
    this.score.textContent = view.score.toLocaleString('en-US');
    this.best.textContent = view.best.toLocaleString('en-US');
    this.bestLabel.textContent = view.bestLabel;
    this.bestRow.hidden = view.best <= 0;

    // A record and a mediocre loss used to render identically — the same
    // number printed twice, in the same grey. Say it.
    const isNew = view.isNewBest === true;
    this.panel.classList.toggle('is-record', isNew);
    this.record.hidden = !isNew;
    if (isNew) {
      const beat = view.score - (view.previousBest ?? 0);
      this.record.textContent =
        beat > 0 ? `new best · +${beat.toLocaleString('en-US')}` : 'new best';
    }

    const streak = view.streak ?? 0;
    this.streak.hidden = streak < 2;
    this.streak.textContent = `${streak} days running`;

    const result = view.result ?? '';
    this.renderResult(result);
    this.result.hidden = result.length === 0;
    this.copy.hidden = result.length === 0;
    this.share.hidden = result.length === 0 || view.canShareSheet !== true;

    const keys = view.keys ?? 0;
    this.useKey.hidden = keys <= 0;
    this.useKey.textContent = keys > 1 ? `use a key (${keys})` : 'use a key';

    this.duel.hidden = view.canDuel !== true;
    this.next.hidden = !view.canAdvance;
    this.restart.textContent = view.restartLabel;
    this.note.textContent = '';
    this.panel.hidden = false;
  }

  /**
   * Header, grid, notes — each sized for its job, and the grid given real
   * size because it is the part anyone actually looks at. Still one selectable
   * block, so select-all-and-copy gets the whole thing.
   */
  private renderResult(result: string): void {
    if (result.length === 0) {
      this.result.replaceChildren();
      return;
    }

    const lines = result.split('\n');
    const classes =
      lines.length >= 3
        ? ['share-head', 'share-grid', 'share-notes']
        : ['share-head', 'share-notes'];

    this.result.replaceChildren(
      ...lines.map((line, i) => {
        const el = document.createElement('div');
        el.className = classes[Math.min(i, classes.length - 1)]!;
        el.textContent = line;
        return el;
      }),
    );
  }

  hide(): void {
    this.panel.hidden = true;
    this.note.textContent = '';
  }

  says(message: string): void {
    this.note.textContent = message;
  }
}

/**
 * The settings panel.
 *
 * Three of these four toggles were already fully built and wired into the
 * engine with no way for a player to reach them — `setAudioEnabled`,
 * `setHapticsEnabled` and the generator's `fairDeal` all had zero call sites.
 * Fair Deal in particular is described in the design doc as a trust signal, and
 * a trust signal nobody can find is not one.
 */
export interface SettingsValues {
  sound: boolean;
  haptics: boolean;
  reducedMotion: boolean;
  fairDeal: boolean;
}

export class SettingsPanel {
  private readonly panel: HTMLElement;
  private readonly inputs: Record<keyof SettingsValues, HTMLInputElement>;

  constructor(
    private readonly onChange: (values: SettingsValues) => void,
    root: ParentNode = document,
  ) {
    this.panel = must(root, '#settings');
    this.inputs = {
      sound: must(root, '#set-sound') as HTMLInputElement,
      haptics: must(root, '#set-haptics') as HTMLInputElement,
      reducedMotion: must(root, '#set-motion') as HTMLInputElement,
      fairDeal: must(root, '#set-fair') as HTMLInputElement,
    };

    for (const input of Object.values(this.inputs)) {
      input.addEventListener('change', () => this.onChange(this.read()));
    }

    (must(root, '#close-settings') as HTMLButtonElement).addEventListener(
      'click',
      () => this.hide(),
    );
    (must(root, '#open-settings') as HTMLButtonElement).addEventListener(
      'click',
      () => this.show(),
    );
  }

  private read(): SettingsValues {
    return {
      sound: this.inputs.sound.checked,
      haptics: this.inputs.haptics.checked,
      reducedMotion: this.inputs.reducedMotion.checked,
      fairDeal: this.inputs.fairDeal.checked,
    };
  }

  set(values: SettingsValues): void {
    this.inputs.sound.checked = values.sound;
    this.inputs.haptics.checked = values.haptics;
    this.inputs.reducedMotion.checked = values.reducedMotion;
    this.inputs.fairDeal.checked = values.fairDeal;
  }

  /** Vibration is Android-only; hide the toggle where it does nothing. */
  setHapticsSupported(supported: boolean): void {
    const row = this.inputs.haptics.closest('label');
    if (row instanceof HTMLElement) row.hidden = !supported;
  }

  show(): void {
    this.panel.hidden = false;
  }

  hide(): void {
    this.panel.hidden = true;
  }

  get open(): boolean {
    return !this.panel.hidden;
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
      rearrange: must(root, '#mode-rearrange') as HTMLButtonElement,
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
