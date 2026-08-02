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
  type Board,
  type FullLines,
} from './board';
import { dealThree } from './generator';
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
}

export const NO_MARKER = -1;

/**
 * A marked cell means one of two things depending on where the run is up to.
 * While the Nook is sealed, markers are **gems** and clearing one opens it.
 * Once it is open they are **stars**, and clearing one pays score.
 *
 * The board never holds both: unlocking wipes the gems, and stars only appear
 * afterwards. `markerKind` is the single source of truth for which is on screen.
 */
export type MarkerKind = 'gem' | 'star';

export const markerKind = (state: GameState): MarkerKind =>
  state.nookUnlocked ? 'star' : 'gem';

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
  /** Markers caught by this clear — gems while sealed, stars once open. */
  readonly markersCleared: number;
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
  dealClears: [],
};

export interface GameState {
  readonly board: Board;
  readonly stats: RunStats;
  /** 64 entries. 0 is empty; 1–4 index the enamel palette. */
  readonly colors: Uint8Array;
  /** Board cells holding a marker. Always a subset of `board`. */
  readonly markers: Board;
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
  | { type: 'stash'; index: number };

export interface NewGameOptions {
  readonly seed: RngState;
  readonly fairDeal?: boolean;
}

export function createGame(options: NewGameOptions): GameState {
  const base: GameState = {
    board: EMPTY_BOARD,
    stats: EMPTY_STATS,
    colors: new Uint8Array(CELLS),
    markers: EMPTY_BOARD,
    tray: [null, null, null],
    nook: null,
    nookUnlocked: false,
    swapUsed: false,
    score: 0,
    run: 0,
    status: 'playing',
    rngState: options.seed >>> 0,
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

/** Is there a marker sitting on this board cell? */
export const markerAt = (state: GameState, x: number, y: number): boolean =>
  isFilled(state.markers, x, y);

const trayEmpty = (tray: ReadonlyArray<Slot | null>): boolean =>
  tray.every((s) => s === null);

/** Deal three. Only ever called with an empty tray; the Nook does not block it. */
function deal(state: GameState): GameState {
  const result = dealThree(
    {
      board: state.board,
      nook: state.nook?.piece ?? null,
      recentShapes: state.recentShapes,
      score: state.score,
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
    const [roll, afterRoll] = nextInt(rng, MARKER_ONE_IN);
    rng = afterRoll;
    if (roll === 0) {
      const [cell, afterCell] = nextInt(rng, piece(id).cells.length);
      rng = afterCell;
      marker = cell;
    }

    return { piece: id, color: color + 1, marker };
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
  readonly markers: Board;
  readonly lines: FullLines;
  readonly markersCleared: number;
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
  let markers = state.markers;
  if (slot.marker !== NO_MARKER) {
    const offset = piece(slot.piece).cells[slot.marker];
    if (offset) markers |= bit(x + offset[0], y + offset[1]);
  }

  const placed = place(state.board, mask);
  const lines = fullLines(placed);
  const clearedCount = lines.rows.length + lines.cols.length;

  let board = placed;
  let markersCleared = 0;
  if (clearedCount > 0) {
    const cleared = lineMask(lines);
    board = clearLines(placed, lines);
    markersCleared = popcount(markers & cleared);
    markers &= ~cleared;
  }

  // A gem buys the Nook, a star buys points, and one placement never does both:
  // the unlock is decided by the state *before* this placement.
  const unlockedNook = !state.nookUnlocked && markersCleared > 0;
  if (unlockedNook) markers = EMPTY_BOARD;
  const starsCleared = state.nookUnlocked ? markersCleared : 0;

  return {
    board,
    markers,
    lines,
    markersCleared,
    unlockedNook,
    turn: scoreTurn(piece(slot.piece).size, clearedCount, state.run, starsCleared),
  };
}

export interface Preview {
  readonly legal: boolean;
  readonly lines: FullLines;
  readonly gained: number;
  readonly multiplier: number;
  /** Markers this placement would catch. Drives the preview highlight. */
  readonly markersCleared: number;
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
    markersCleared: outcome.markersCleared,
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
  }
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

  const { board, markers, lines, turn, markersCleared, unlockedNook } = resolve(
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
          hadMarker: (state.markers & (1n << BigInt(cell))) !== 0n,
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
    markers,
    tray,
    nook,
    stats: {
      bestRun: Math.max(state.stats.bestRun, turn.nextRun),
      sweptClean: state.stats.sweptClean + (board === EMPTY_BOARD ? 1 : 0),
      linesCleared: state.stats.linesCleared + cleared,
      placements: state.stats.placements + 1,
      dealClears,
    },
    nookUnlocked: state.nookUnlocked || unlockedNook,
    score: state.score + turn.total,
    run: turn.nextRun,
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
      markersCleared,
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
    markers: state.markers.toString(36),
    tray: state.tray,
    nook: state.nook,
    nookUnlocked: state.nookUnlocked,
    swapUsed: state.swapUsed,
    score: state.score,
    run: state.run,
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
