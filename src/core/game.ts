// The whole game as reducer(state, action) -> state.
//
// Nothing in here touches the DOM, Date.now, or Math.random. All randomness
// comes from `rngState`, which lives in the state itself. That one discipline
// is what buys Today's Nook, replays, server-side validation and tests that
// never flake — so keep it.

import {
  EMPTY_BOARD,
  bit,
  canPlace,
  cellsAt,
  clearLines,
  fitsAnywhere,
  fullLines,
  isFilled,
  lineMask,
  maskAt,
  place,
  popcount,
  CELLS,
  COL,
  N,
  ROW,
  type Board,
  type FullLines,
} from './board';
import { dealThree, generateLayout } from './generator';
import { COLOR_COUNT, piece, type PieceId } from './pieces';
import { nextInt, type RngState } from './rng';
import { scoreTurn, type TurnScore } from './scoring';

/** One dealt piece in a tray slot or the Nook. */
export interface Slot {
  readonly piece: PieceId;
  /** 1–4, an index into the enamel palette. Drawn at deal time so replays match. */
  readonly color: number;
  /** Index into the piece's cells carrying a marker, or NO_MARKER. */
  readonly marker: number;
  /** Which marker that cell carries. Meaningless when `marker` is NO_MARKER. */
  readonly markerKind: MarkerKind;
}

export const NO_MARKER = -1;

/**
 * Two kinds of marked cell. **Gems** open the Nook and count toward level
 * objectives; **stars** pay score.
 *
 * Which ones appear depends on the policy:
 *
 * - `progression` (endless, Today's Nook) — gems while the Nook is sealed,
 *   stars once it is open. The board only ever holds one kind, because
 *   unlocking wipes the gems and stars only start afterwards.
 * - `mixed` (levels) — both, side by side. Levels hand you the Nook up front,
 *   so gems have no unlocking left to do and become objective currency.
 *
 * They are stored as two separate bitboards precisely because `mixed` breaks
 * the assumption that only one kind is ever on screen.
 */
export type MarkerKind = 'gem' | 'star';

export type MarkerPolicy = 'progression' | 'mixed';

/**
 * Roughly one dealt piece in twelve carries a marker — about three or four in a
 * typical run. Rare enough that clearing one is an event, common enough that
 * most runs get there.
 */
export const MARKER_ONE_IN = 12;

export type Source = 'tray' | 'nook';

export interface ClearedCell {
  /** Board index, 0–63. */
  readonly cell: number;
  readonly color: number;
  readonly hadMarker: boolean;
}

export interface PlacementEvent {
  readonly source: Source;
  readonly piece: PieceId;
  readonly color: number;
  readonly x: number;
  readonly y: number;
  readonly clearedRows: readonly number[];
  readonly clearedCols: readonly number[];
  /**
   * Every cell this placement swept away, with the colour it was wearing.
   * The board has already forgotten them by the time anyone reads this, so
   * the renderer needs them handed over to animate the pop.
   */
  readonly clearedCells: readonly ClearedCell[];
  readonly gained: number;
  readonly multiplier: number;
  readonly sweptClean: boolean;
  readonly dealt: boolean;
  readonly gemsCleared: number;
  readonly starsCleared: number;
  /** Points those markers were worth. Zero for gems, which buy the Nook instead. */
  readonly starBonus: number;
  /** True on the one placement that opens the Nook. */
  readonly unlockedNook: boolean;
}

/**
 * What happened over a whole run. Lives in state rather than being tallied by
 * the UI so it replays identically from a seed and an action list — which is
 * what makes a shared daily result mean anything.
 */
export interface RunStats {
  /** Highest run streak reached. */
  readonly bestRun: number;
  readonly sweptClean: number;
  readonly linesCleared: number;
  readonly placements: number;
  readonly gemsCleared: number;
  readonly starsCleared: number;
  /**
   * Best single clear, in lines, during each deal in order. One square per
   * entry in the shared grid, so a run reads at a glance without spoiling the
   * board.
   */
  readonly dealClears: readonly number[];
}

export const EMPTY_STATS: RunStats = {
  bestRun: 0,
  sweptClean: 0,
  linesCleared: 0,
  placements: 0,
  gemsCleared: 0,
  starsCleared: 0,
  dealClears: [],
};

export interface GameState {
  readonly board: Board;
  readonly stats: RunStats;
  /** 64 entries. 0 is empty; 1–4 index the enamel palette. */
  readonly colors: Uint8Array;
  /** Board cells holding a gem. Always a subset of `board`. */
  readonly gems: Board;
  /** Board cells holding a star. Always a subset of `board`. */
  readonly stars: Board;
  readonly markerPolicy: MarkerPolicy;
  /** One marked cell per this many dealt pieces. */
  readonly markerOneIn: number;
  readonly tray: ReadonlyArray<Slot | null>;
  readonly nook: Slot | null;
  /**
   * The Nook is earned, not given. Every run starts sealed; clearing a line
   * through a gem opens it for the rest of that run.
   */
  readonly nookUnlocked: boolean;
  /** One swap per deal — see the ejection rule in `stash`. */
  readonly swapUsed: boolean;
  readonly score: number;
  readonly run: number;
  /** Non-clearing placements the run survives before it decays. */
  readonly runGrace: number;
  /** Rescues in hand. Spent from the game-over screen to carry on. */
  readonly keys: number;
  /** What the last spent Key cleared. Drives its pop, same as a line clear. */
  readonly keyEvent: KeyEvent | null;
  readonly status: 'playing' | 'over';
  readonly rngState: RngState;
  readonly dealCount: number;
  /** Last two deals, flattened, newest first. Feeds anti-repetition. */
  readonly recentShapes: readonly PieceId[];
  readonly fairDeal: boolean;
  /** What the last placement did. Drives the HUD and the announcer. */
  readonly lastEvent: PlacementEvent | null;
}

export type Action =
  | { type: 'place'; source: Source; index: number; x: number; y: number }
  | { type: 'stash'; index: number }
  | { type: 'key' };

/**
 * Lines a Key clears at minimum. It keeps going past this if it has to, so the
 * promise "a Key always gets you moving again" is a guarantee rather than a
 * hope — see `doKey`.
 */
export const KEY_LINES = 3;
/** Keys a run starts with. */
export const STARTING_KEYS = 1;

/** What spending a Key wiped, so the renderer can pop it like any other clear. */
export interface KeyEvent {
  readonly cells: readonly ClearedCell[];
  readonly lines: number;
}

export interface NewGameOptions {
  readonly seed: RngState;
  readonly fairDeal?: boolean;
  /**
   * Cells to pre-fill with a generated starting layout. Today's Nook uses this
   * so each day opens on a board with its own shape; endless starts empty.
   */
  readonly layoutCells?: number;
  /** Levels use 'mixed' so gems and stars can both be collected. */
  readonly markerPolicy?: MarkerPolicy;
  /** Levels hand the Nook over up front rather than making you earn it. */
  readonly nookUnlocked?: boolean;
  /**
   * One marked cell per this many dealt pieces. Levels lower it, because a
   * "collect 10 gems" goal is impossible at the endless rate — over a long run
   * the endless rate only ever produces three or four.
   */
  readonly markerOneIn?: number;
  /** Rescues the run starts with. Defaults to `STARTING_KEYS`. */
  readonly keys?: number;
}

export function createGame(options: NewGameOptions): GameState {
  const seed = options.seed >>> 0;
  const layout = options.layoutCells
    ? generateLayout(seed, options.layoutCells)
    : null;

  const base: GameState = {
    board: layout?.board ?? EMPTY_BOARD,
    stats: EMPTY_STATS,
    colors: layout?.colors ?? new Uint8Array(CELLS),
    gems: EMPTY_BOARD,
    stars: EMPTY_BOARD,
    markerPolicy: options.markerPolicy ?? 'progression',
    markerOneIn: options.markerOneIn ?? MARKER_ONE_IN,
    tray: [null, null, null],
    nook: null,
    nookUnlocked: options.nookUnlocked ?? false,
    swapUsed: false,
    score: 0,
    run: 0,
    runGrace: 0,
    keys: options.keys ?? STARTING_KEYS,
    keyEvent: null,
    status: 'playing',
    // The layout consumes part of the stream, so deals carry on from there.
    rngState: layout?.rngState ?? seed,
    dealCount: 0,
    recentShapes: [],
    fairDeal: options.fairDeal ?? false,
    lastEvent: null,
  };
  return withEndCheck(deal(base));
}

/** Every piece the player could still play: the tray plus the Nook. */
export function heldPieces(state: GameState): PieceId[] {
  const ids: PieceId[] = [];
  for (const slot of state.tray) if (slot) ids.push(slot.piece);
  if (state.nook) ids.push(state.nook.piece);
  return ids;
}

/** Is there any legal move left anywhere, from the tray or the Nook? */
export function anyLegalMove(state: GameState): boolean {
  return heldPieces(state).some((id) => fitsAnywhere(state.board, id));
}

/** Does this specific held piece fit anywhere? Drives the dead-piece fade. */
export function slotFits(state: GameState, slot: Slot | null): boolean {
  return slot !== null && fitsAnywhere(state.board, slot.piece);
}

/** Which marker, if any, is sitting on this board cell. */
export function markerAt(
  state: GameState,
  x: number,
  y: number,
): MarkerKind | null {
  if (isFilled(state.gems, x, y)) return 'gem';
  if (isFilled(state.stars, x, y)) return 'star';
  return null;
}

const trayEmpty = (tray: ReadonlyArray<Slot | null>): boolean =>
  tray.every((s) => s === null);

/**
 * How long since the player last cleared two lines at once. `dealClears`
 * already records the best clear of every deal in order, so the drought is
 * derivable and needs no state of its own.
 */
function dealsSinceCombo(dealClears: readonly number[]): number {
  let n = 0;
  for (let i = dealClears.length - 1; i >= 0; i--) {
    if (dealClears[i]! >= 2) break;
    n++;
  }
  return n;
}

/** Deal three. Only ever called with an empty tray; the Nook does not block it. */
function deal(state: GameState): GameState {
  const result = dealThree(
    {
      board: state.board,
      nook: state.nook?.piece ?? null,
      recentShapes: state.recentShapes,
      progress: state.stats.placements,
      dealsSinceCombo: dealsSinceCombo(state.stats.dealClears),
      fairDeal: state.fairDeal,
    },
    state.rngState,
  );

  let rng = result.rngState;
  const tray: Slot[] = result.pieces.map((id) => {
    const [color, afterColor] = nextInt(rng, COLOR_COUNT);
    rng = afterColor;

    // Markers keep coming at the same cadence for the whole run; what changes
    // at the halfway point is what they mean.
    let marker = NO_MARKER;
    let markerKind: MarkerKind = state.nookUnlocked ? 'star' : 'gem';
    const [roll, afterRoll] = nextInt(rng, state.markerOneIn);
    rng = afterRoll;
    if (roll === 0) {
      const [cell, afterCell] = nextInt(rng, piece(id).cells.length);
      rng = afterCell;
      marker = cell;

      if (state.markerPolicy === 'mixed') {
        const [coin, afterCoin] = nextInt(rng, 2);
        rng = afterCoin;
        markerKind = coin === 0 ? 'gem' : 'star';
      }
    }

    return { piece: id, color: color + 1, marker, markerKind };
  });

  return {
    ...state,
    tray,
    nook: state.nook,
    swapUsed: false,
    rngState: rng,
    dealCount: state.dealCount + 1,
    recentShapes: [...result.pieces, ...state.recentShapes.slice(0, 3)],
    // A fresh square in the shared grid, filled in as this deal gets played.
    stats: { ...state.stats, dealClears: [...state.stats.dealClears, 0] },
  };
}

function withEndCheck(state: GameState): GameState {
  if (state.status !== 'playing') return state;
  return anyLegalMove(state) ? state : { ...state, status: 'over' };
}

function takeSlot(
  state: GameState,
  source: Source,
  index: number,
): Slot | null {
  if (source === 'nook') return state.nook;
  return state.tray[index] ?? null;
}

interface Resolved {
  readonly board: Board;
  readonly gems: Board;
  readonly stars: Board;
  readonly lines: FullLines;
  readonly gemsCleared: number;
  readonly starsCleared: number;
  readonly unlockedNook: boolean;
  readonly turn: TurnScore;
}

/**
 * Everything a placement would do, worked out without touching state. Both
 * `preview` and the reducer go through here, so the number shown under your
 * finger is by construction the number you score.
 */
function resolve(
  state: GameState,
  slot: Slot,
  x: number,
  y: number,
  mask: bigint,
): Resolved {
  let gems = state.gems;
  let stars = state.stars;
  if (slot.marker !== NO_MARKER) {
    const offset = piece(slot.piece).cells[slot.marker];
    if (offset) {
      const at = bit(x + offset[0], y + offset[1]);
      if (slot.markerKind === 'gem') gems |= at;
      else stars |= at;
    }
  }

  const placed = place(state.board, mask);
  const lines = fullLines(placed);
  const clearedCount = lines.rows.length + lines.cols.length;

  let board = placed;
  let gemsCleared = 0;
  let starsCleared = 0;
  if (clearedCount > 0) {
    const cleared = lineMask(lines);
    board = clearLines(placed, lines);
    gemsCleared = popcount(gems & cleared);
    starsCleared = popcount(stars & cleared);
    gems &= ~cleared;
    stars &= ~cleared;
  }

  // A gem opens the Nook — decided by the state *before* this placement, so a
  // gem never both unlocks and pays. Under 'mixed' the Nook is already open,
  // which leaves gems as pure objective currency.
  const unlockedNook = !state.nookUnlocked && gemsCleared > 0;
  if (unlockedNook) gems = EMPTY_BOARD;

  return {
    board,
    gems,
    stars,
    lines,
    gemsCleared,
    starsCleared,
    unlockedNook,
    turn: scoreTurn(
      piece(slot.piece).size,
      clearedCount,
      { run: state.run, grace: state.runGrace },
      starsCleared,
    ),
  };
}

export interface Preview {
  readonly legal: boolean;
  readonly lines: FullLines;
  readonly gained: number;
  readonly multiplier: number;
  /** Markers this placement would catch. Drives the preview highlight. */
  readonly markersCleared: number;
  readonly gemsCleared: number;
  readonly starsCleared: number;
  /** True if this is the placement that would open the Nook. */
  readonly wouldUnlock: boolean;
}

/** The "nothing would happen" preview. Shared so callers can't drift. */
export const NO_PREVIEW: Preview = {
  legal: false,
  lines: { rows: [], cols: [] },
  gained: 0,
  multiplier: 1,
  markersCleared: 0,
  gemsCleared: 0,
  starsCleared: 0,
  wouldUnlock: false,
};

/**
 * What would happen if this piece landed here — which lines clear and what it
 * scores. Pure, so the renderer can call it every pointermove.
 */
export function preview(
  state: GameState,
  source: Source,
  index: number,
  x: number,
  y: number,
): Preview {
  if (state.status !== 'playing') return NO_PREVIEW;

  const slot = takeSlot(state, source, index);
  if (!slot) return NO_PREVIEW;

  const mask = maskAt(slot.piece, x, y);
  if (mask === null || !canPlace(state.board, mask)) return NO_PREVIEW;

  const outcome = resolve(state, slot, x, y, mask);

  return {
    legal: true,
    lines: outcome.lines,
    gained: outcome.turn.total,
    multiplier: outcome.turn.multiplier,
    markersCleared: outcome.gemsCleared + outcome.starsCleared,
    gemsCleared: outcome.gemsCleared,
    starsCleared: outcome.starsCleared,
    wouldUnlock: outcome.unlockedNook,
  };
}

/**
 * Illegal actions return the state unchanged rather than throwing — the UI
 * should never be able to corrupt the game.
 */
export function reducer(state: GameState, action: Action): GameState {
  switch (action.type) {
    case 'place':
      return doPlace(state, action.source, action.index, action.x, action.y);
    case 'stash':
      return doStash(state, action.index);
    case 'key':
      return doKey(state);
  }
}

/** Every row and column, most nearly full first. Ties break by index. */
function linesByFullness(board: Board): bigint[] {
  const lines: Array<{ mask: bigint; filled: number }> = [];
  for (let y = 0; y < N; y++) {
    const mask = ROW(y);
    lines.push({ mask, filled: popcount(board & mask) });
  }
  for (let x = 0; x < N; x++) {
    const mask = COL(x);
    lines.push({ mask, filled: popcount(board & mask) });
  }
  // Stable sort, so equally full lines always clear in the same order and a
  // replay lands on the same board.
  return lines
    .map((line, i) => ({ ...line, i }))
    .sort((a, b) => b.filled - a.filled || a.i - b.i)
    .map((line) => line.mask);
}

/**
 * Spend a Key: the rescue named in `plan.md`'s vocabulary and never built.
 *
 * Only legal from a finished run, which is what keeps it out of the normal
 * loop entirely — the end check that set `status` to 'over' is untouched, and
 * so is every path that leads to it.
 *
 * It clears whole lines, worst-affected first, and keeps clearing past the
 * minimum until the pieces in hand actually fit. A Key that failed to rescue
 * you would be worse than no Key at all.
 *
 * Deliberately pays nothing and does not advance the run: a rescue that scored
 * would make dying on purpose a strategy.
 */
function doKey(state: GameState): GameState {
  if (state.status !== 'over' || state.keys <= 0) return state;

  const colors = Uint8Array.from(state.colors);
  let board = state.board;
  let gems = state.gems;
  let stars = state.stars;
  let cleared = 0;

  const clearedCells: ClearedCell[] = [];

  for (const mask of linesByFullness(state.board)) {
    const alreadyClear = (board & mask) === 0n;
    if (cleared >= KEY_LINES && anyLegalMove({ ...state, board })) break;
    if (alreadyClear) continue;

    for (let cell = 0; cell < CELLS; cell++) {
      const bitAt = 1n << BigInt(cell);
      if ((mask & bitAt) === 0n || (board & bitAt) === 0n) continue;
      if (colors[cell] !== 0) {
        clearedCells.push({
          cell,
          color: colors[cell]!,
          hadMarker: ((gems | stars) & bitAt) !== 0n,
        });
      }
      colors[cell] = 0;
    }

    board &= ~mask;
    gems &= ~mask;
    stars &= ~mask;
    cleared++;
  }

  const next: GameState = {
    ...state,
    board,
    colors,
    gems,
    stars,
    keys: state.keys - 1,
    status: 'playing',
    lastEvent: null,
    keyEvent: { cells: clearedCells, lines: cleared },
  };

  // If even that left nothing playable the run really is finished, and the end
  // check says so rather than handing back a dead board.
  return withEndCheck(next);
}

function doPlace(
  state: GameState,
  source: Source,
  index: number,
  x: number,
  y: number,
): GameState {
  if (state.status !== 'playing') return state;

  const slot = takeSlot(state, source, index);
  if (!slot) return state;

  const mask = maskAt(slot.piece, x, y);
  if (mask === null || !canPlace(state.board, mask)) return state;

  const { board, gems, stars, lines, turn, gemsCleared, starsCleared, unlockedNook } = resolve(
    state,
    slot,
    x,
    y,
    mask,
  );

  const colors = Uint8Array.from(state.colors);
  for (const cell of cellsAt(slot.piece, x, y)) colors[cell] = slot.color;

  // Same mask that cleared the bits clears the colours — and on the way past,
  // note what was there so the renderer can pop it.
  const clearedCells: ClearedCell[] = [];
  if (lines.rows.length + lines.cols.length > 0) {
    for (let cell = 0; cell < CELLS; cell++) {
      if ((board & (1n << BigInt(cell))) !== 0n) continue;
      if (colors[cell] !== 0) {
        clearedCells.push({
          cell,
          color: colors[cell]!,
          hadMarker:
            ((state.gems | state.stars) & (1n << BigInt(cell))) !== 0n,
        });
      }
      colors[cell] = 0;
    }
  }

  const tray =
    source === 'tray'
      ? state.tray.map((s, i) => (i === index ? null : s))
      : state.tray;
  const nook = source === 'nook' ? null : state.nook;

  const cleared = lines.rows.length + lines.cols.length;
  const dealClears = [...state.stats.dealClears];
  if (dealClears.length > 0) {
    const last = dealClears.length - 1;
    dealClears[last] = Math.max(dealClears[last]!, cleared);
  }

  let next: GameState = {
    ...state,
    board,
    colors,
    gems,
    stars,
    tray,
    nook,
    stats: {
      bestRun: Math.max(state.stats.bestRun, turn.next.run),
      sweptClean: state.stats.sweptClean + (board === EMPTY_BOARD ? 1 : 0),
      linesCleared: state.stats.linesCleared + cleared,
      placements: state.stats.placements + 1,
      gemsCleared: state.stats.gemsCleared + gemsCleared,
      starsCleared: state.stats.starsCleared + starsCleared,
      dealClears,
    },
    nookUnlocked: state.nookUnlocked || unlockedNook,
    // Sweeping the board clean earns the next rescue. The hardest thing in the
    // game pays for the thing that saves you from the worst thing in the game.
    keys: state.keys + (board === EMPTY_BOARD ? 1 : 0),
    score: state.score + turn.total,
    run: turn.next.run,
    runGrace: turn.next.grace,
    lastEvent: {
      source,
      piece: slot.piece,
      color: slot.color,
      x,
      y,
      clearedRows: lines.rows,
      clearedCols: lines.cols,
      clearedCells,
      gained: turn.total,
      multiplier: turn.multiplier,
      sweptClean: board === EMPTY_BOARD,
      dealt: false,
      gemsCleared,
      starsCleared,
      starBonus: turn.stars,
      unlockedNook,
    },
  };

  // A new deal arrives only when the tray is empty. A piece in the Nook does
  // not block it.
  if (trayEmpty(next.tray)) {
    next = deal(next);
    next = { ...next, lastEvent: { ...next.lastEvent!, dealt: true } };
  }

  return withEndCheck(next);
}

function doStash(state: GameState, index: number): GameState {
  if (state.status !== 'playing') return state;
  // Sealed until a gem is cleared.
  if (!state.nookUnlocked) return state;

  const incoming = state.tray[index] ?? null;
  if (!incoming) return state;

  // Occupied Nook: the stored piece is ejected into the slot the incoming
  // piece just left, and that costs your one swap for this deal. Without the
  // limit, players churn pieces to fish for shapes and the three-piece
  // planning tension collapses.
  if (state.nook !== null) {
    if (state.swapUsed) return state;
    const tray = state.tray.map((s, i) => (i === index ? state.nook : s));
    return withEndCheck({ ...state, tray, nook: incoming, swapUsed: true });
  }

  const tray = state.tray.map((s, i) => (i === index ? null : s));
  let next: GameState = { ...state, tray, nook: incoming };

  if (trayEmpty(next.tray)) next = deal(next);

  return withEndCheck(next);
}

/** Stable string form. Used by the replay-determinism test and by storage. */
export function serialize(state: GameState): string {
  return JSON.stringify({
    board: state.board.toString(36),
    colors: Array.from(state.colors),
    gems: state.gems.toString(36),
    stars: state.stars.toString(36),
    tray: state.tray,
    nook: state.nook,
    nookUnlocked: state.nookUnlocked,
    swapUsed: state.swapUsed,
    score: state.score,
    run: state.run,
    runGrace: state.runGrace,
    keys: state.keys,
    status: state.status,
    rngState: state.rngState,
    dealCount: state.dealCount,
    recentShapes: state.recentShapes,
    fairDeal: state.fairDeal,
    stats: state.stats,
  });
}

/** Replay a run from its seed and action list. A run is literally this. */
export function replay(
  options: NewGameOptions,
  actions: readonly Action[],
): GameState {
  let state = createGame(options);
  for (const action of actions) state = reducer(state, action);
  return state;
}
