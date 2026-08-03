// The shareable result. Spoiler-free by construction: it says how the run went
// without saying anything about how to play the board.
//
//   Nook #204 — 12,480
//   🟦🟦🟪 ⬛🟦🟨 🟪🟪🟪 🟦⬛
//   longest run ×4.5 · swept clean twice
//
// One square per deal, coloured by the best clear that deal produced. A short
// brand name keeps the score the loudest thing in the line.

import type { RunStats } from '../core/game';
import { runMultiplier } from '../core/scoring';

/**
 * Indexed by lines cleared in a deal. Anything past four shares the top
 * colour. Swept-clean doesn't get its own square — it already gets a mention
 * on the notes line, and a sixth colour makes the grid harder to read at a
 * glance, which is the only thing the grid is for.
 */
const SQUARES = ['⬛', '🟦', '🟪', '🟨', '🟧'] as const;

/** Beyond this the line wraps badly in most chat apps. */
const MAX_SQUARES = 24;

export interface ShareResult {
  /** Only meaningful for the daily. */
  readonly day: number;
  readonly score: number;
  readonly stats: RunStats;
  /**
   * Which headline to write. The grid and the notes are the same in every
   * mode — an endless best and a cleared level are just as worth sending as a
   * daily, and gating the artefact on `mode === 'daily'` meant the two modes
   * where most play happens produced nothing to share at all.
   */
  readonly mode?: 'daily' | 'endless' | 'levels' | 'rearrange';
  /** The level number, for the levels headline. */
  readonly level?: number;
  /** The week's Rearrange rule, for its headline. */
  readonly mutator?: string;
  readonly isBest?: boolean;
}

function grid(dealClears: readonly number[]): string {
  const shown = dealClears.slice(0, MAX_SQUARES);
  const squares = shown.map((n) => SQUARES[Math.min(n, SQUARES.length - 1)]!);

  // Grouped in threes, matching the three pieces a deal hands you.
  const groups: string[] = [];
  for (let i = 0; i < squares.length; i += 3) {
    groups.push(squares.slice(i, i + 3).join(''));
  }

  const line = groups.join(' ');
  return dealClears.length > MAX_SQUARES ? `${line} …` : line;
}

function countWord(n: number): string {
  if (n === 1) return 'once';
  if (n === 2) return 'twice';
  return `${n} times`;
}

/** The first line: what this run was. */
function headline(result: ShareResult): string {
  const score = result.score.toLocaleString('en-US');
  if (result.mode === 'levels') {
    return `Nook — level ${result.level ?? 1} — ${score}`;
  }
  if (result.mode === 'rearrange') {
    return `Nook — rearrange: ${result.mutator ?? ''} — ${score}`.replace('  ', ' ');
  }
  if (result.mode === 'endless') {
    return result.isBest ? `Nook — new best ${score}` : `Nook — ${score}`;
  }
  return `Nook #${result.day} — ${score}`;
}

export function shareText(result: ShareResult): string {
  const { stats } = result;
  const lines = [headline(result)];

  const squares = grid(stats.dealClears);
  if (squares) lines.push(squares);

  // Lowercase, plain, unbothered — same register as everything else.
  const notes: string[] = [];
  if (stats.bestRun > 1) {
    notes.push(`longest run ×${runMultiplier(stats.bestRun)}`);
  }
  if (stats.sweptClean > 0) {
    notes.push(`swept clean ${countWord(stats.sweptClean)}`);
  }
  notes.push(`${stats.linesCleared} lines`);
  lines.push(notes.join(' · '));

  return lines.join('\n');
}

/** Is there an OS share sheet worth offering? Mostly phones. */
export const canShareSheet = (): boolean =>
  typeof navigator !== 'undefined' && typeof navigator.share === 'function';

/**
 * Open the OS share sheet. Separate from copying on purpose: awaiting
 * `navigator.share` and *then* falling back to the clipboard doesn't work,
 * because the await spends the transient user activation and the clipboard
 * call is refused. Two buttons, two independent paths, each called straight
 * from its own gesture.
 */
export async function openShareSheet(text: string): Promise<boolean> {
  if (!canShareSheet()) return false;
  try {
    await navigator.share({ text });
    return true;
  } catch {
    // Includes the user simply dismissing the sheet.
    return false;
  }
}

/**
 * Copy to the clipboard. The async clipboard call is the *first* thing that
 * happens, so the gesture is still live; the textarea path covers browsers
 * that refuse it outright.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return legacyCopy(text);
  }
}

function legacyCopy(text: string): boolean {
  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.append(area);
    area.select();
    const ok = document.execCommand('copy');
    area.remove();
    return ok;
  } catch {
    return false;
  }
}
