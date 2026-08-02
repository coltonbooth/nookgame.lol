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
  readonly day: number;
  readonly score: number;
  readonly stats: RunStats;
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

export function shareText(result: ShareResult): string {
  const { stats } = result;
  const lines = [
    `Nook #${result.day} — ${result.score.toLocaleString('en-US')}`,
  ];

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

export interface ShareOutcome {
  readonly ok: boolean;
  /** True when it went to the clipboard rather than a share sheet. */
  readonly copied: boolean;
}

/**
 * Hand the text to the OS share sheet where there is one, otherwise the
 * clipboard. Both need to be called straight from a user gesture or the
 * browser refuses.
 */
export async function shareOrCopy(text: string): Promise<ShareOutcome> {
  if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
    try {
      await navigator.share({ text });
      return { ok: true, copied: false };
    } catch (error) {
      // A user dismissing the sheet lands here too — not worth a fallback.
      if (error instanceof DOMException && error.name === 'AbortError') {
        return { ok: false, copied: false };
      }
    }
  }

  try {
    await navigator.clipboard.writeText(text);
    return { ok: true, copied: true };
  } catch {
    return { ok: false, copied: false };
  }
}
