// The end-of-run panel and the mode switch. Copy stays lowercase and
// unbothered — the category is uniformly shouty, and being calm is free
// differentiation.

export type Mode = 'endless' | 'daily';

export class EndPanel {
  private readonly panel: HTMLElement;
  private readonly score: HTMLElement;
  private readonly best: HTMLElement;
  private readonly share: HTMLButtonElement;
  private readonly note: HTMLElement;

  constructor(
    handlers: { onRestart(): void; onShare(): void },
    root: ParentNode = document,
  ) {
    this.panel = must(root, '#panel');
    this.score = must(root, '#panel-score');
    this.best = must(root, '#panel-best');
    this.note = must(root, '#share-note');
    this.share = must(root, '#share') as HTMLButtonElement;

    must(root, '#restart').addEventListener('click', handlers.onRestart);
    this.share.addEventListener('click', handlers.onShare);
  }

  show(score: number, best: number, canShare: boolean): void {
    this.score.textContent = score.toLocaleString('en-US');
    this.best.textContent = best.toLocaleString('en-US');
    this.share.hidden = !canShare;
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

/** Two tabs. Endless is the default; today is the reason to come back. */
export class ModeTabs {
  private readonly buttons: Record<Mode, HTMLButtonElement>;
  private readonly label: HTMLElement;

  constructor(onPick: (mode: Mode) => void, root: ParentNode = document) {
    this.buttons = {
      endless: must(root, '#mode-endless') as HTMLButtonElement,
      daily: must(root, '#mode-daily') as HTMLButtonElement,
    };
    this.label = must(root, '#daily-label');

    (Object.keys(this.buttons) as Mode[]).forEach((mode) => {
      this.buttons[mode].addEventListener('click', () => onPick(mode));
    });
  }

  set(mode: Mode, dayNumber: number, todaysBest = 0): void {
    (Object.keys(this.buttons) as Mode[]).forEach((key) => {
      const on = key === mode;
      this.buttons[key].classList.toggle('is-on', on);
      this.buttons[key].setAttribute('aria-pressed', String(on));
    });

    this.label.hidden = mode !== 'daily';
    if (mode !== 'daily') {
      this.label.textContent = '';
      return;
    }

    const best =
      todaysBest > 0 ? ` · best ${todaysBest.toLocaleString('en-US')}` : '';
    this.label.textContent = `today's nook #${dayNumber}${best}`;
  }
}

function must(root: ParentNode, selector: string): HTMLElement {
  const el = root.querySelector<HTMLElement>(selector);
  if (!el) throw new Error(`missing element ${selector}`);
  return el;
}
