// mulberry32 — small, fast, good enough, and the whole state is one uint32 so
// it serialises straight into GameState. Nothing in core/ may call Math.random.

export type RngState = number;

/** Advance the generator. Returns the drawn uint32 and the next state. */
export function nextU32(state: RngState): [value: number, next: RngState] {
  let t = (state + 0x6d2b79f5) >>> 0;
  let r = t;
  r = Math.imul(r ^ (r >>> 15), r | 1);
  r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
  return [(r ^ (r >>> 14)) >>> 0, t];
}

/** Uniform float in [0, 1). */
export function nextFloat(state: RngState): [value: number, next: RngState] {
  const [v, next] = nextU32(state);
  return [v / 4294967296, next];
}

/** Uniform integer in [0, bound). Returns 0 for a non-positive bound. */
export function nextInt(
  state: RngState,
  bound: number,
): [value: number, next: RngState] {
  if (bound <= 0) return [0, state];
  const [f, next] = nextFloat(state);
  return [Math.floor(f * bound), next];
}

/**
 * Pick an index from `weights` proportionally. Weights must be non-negative;
 * an all-zero array falls back to a uniform pick.
 */
export function weightedPick(
  state: RngState,
  weights: readonly number[],
): [index: number, next: RngState] {
  let total = 0;
  for (const w of weights) total += w > 0 ? w : 0;
  if (total <= 0) return nextInt(state, weights.length);

  const [f, next] = nextFloat(state);
  let target = f * total;
  for (let i = 0; i < weights.length; i++) {
    const w = weights[i]!;
    if (w > 0) {
      target -= w;
      if (target < 0) return [i, next];
    }
  }
  // Floating-point slack only.
  return [weights.length - 1, next];
}

/** FNV-1a. Used to seed Today's Nook from a date string. */
export function hashString(s: string): RngState {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
