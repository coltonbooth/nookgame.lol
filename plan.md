# Nook — Build Plan

**Nook — Block Puzzle**
`nookgame.lol`

A complete plan for building a mobile-first block puzzle game as a static website: mechanics spec, the Nook mechanic, tech stack, algorithms, mobile UX, brand voice, and a shipping roadmap.

> **The idea in one line:** every piece finds its nook.

---

## 0. The name, and what it buys you

*Nook* names the feeling rather than the objects — quiet, warm, small-and-satisfying. That gives you a consistent voice for the whole product, and it lets the signature mechanic share the name of the game itself, which is a stronger bit of design than a descriptive title would have been.

**Lockup:** `Nook — Block Puzzle`. The subtitle carries the search work; the brand carries the memory. Use the full lockup in the page title, meta description, and any store listing. Use bare **Nook** everywhere inside the game.

**Vocabulary.** Rename everything to match, so the game reads as one deliberate object:

| Generic | In Nook |
|---|---|
| Hold slot | **the Nook** |
| Rescue token | **Key** |
| Weekly mutator | **Rearrange** |
| Daily seeded board | **Today's Nook** |
| Combo streak | **a run** |
| Full board clear | **swept clean** |
| Game over | **nowhere left to put it** |

**Voice.** Lowercase, gentle, never exclamatory. No "GAME OVER!", no "AMAZING!!", no confetti-cannon copy. The category is uniformly shouty; being calm is free differentiation. Errors and empty states stay in the same register — plain, direct, unbothered.

**Icon.** A single enamel block sitting in a brass-bezelled corner recess — the nook, literally. One block, not a grid of them. It has to read at 40px, because that is the only size that matters on a home screen.

> **One flag before the logo.** *Nook* is Barnes & Noble's e-reader and is registered in the software class, and you'll be sharing search results with Animal Crossing's Tom Nook. A browser puzzle game is unlikely to trouble either, and "nook" is a common English word so the protection isn't absolute — but this is a higher-collision name than the alternatives. Worth a real clearance check before you commit to artwork. I'm not a lawyer; thirty minutes with one is cheap insurance here.

---

## 1. The core game, specified precisely

Get this exactly right before adding anything. The whole game is about 300 lines of real logic.

### Board and pieces
- **Board:** 8×8 grid. Every cell is empty or filled (plus a colour for display).
- **Tray:** 3 pieces visible at all times. A new set of 3 is dealt **only when all three have been placed** — not one at a time. This is the most important rule for the strategic feel, because it forces you to plan a three-move sequence.
- **No rotation.** Pieces are fixed-orientation; each rotation is a *separate shape* in the catalogue. This is the defining constraint of the genre — don't "improve" it by adding rotation.
- **Placement:** legal only if every cell of the piece lands on an empty in-bounds cell. Once placed, a piece is permanent.

### Piece catalogue (~40 fixed-orientation shapes)

| Family | Shapes | Suggested weight |
|---|---|---|
| Single | 1×1 | low (2%) — a get-out-of-jail card |
| Dominoes | 1×2, 2×1 | high |
| Lines 3 | 1×3, 3×1 | high |
| Lines 4 | 1×4, 4×1 | medium |
| Lines 5 | 1×5, 5×1 | low |
| Square | 2×2 | high |
| Rectangles | 2×3, 3×2 | medium |
| Big square | 3×3 | low |
| L-triomino | 4 orientations | high |
| L / J tetromino | 8 orientations | medium |
| S / Z tetromino | 4 orientations | medium |
| T tetromino | 4 orientations | medium |
| Big corner (3+3 arms) | 4 orientations | low |

Store each piece as a list of `[dx, dy]` offsets plus its bounding box. Weights are your primary difficulty dial — tune them later with real play data.

### Clearing
1. Place piece → mark cells filled.
2. Scan all 8 rows and all 8 columns; collect every fully-filled line.
3. Clear **all of them simultaneously**. A row and column that intersect both clear; the shared cell doesn't double-count.
4. No gravity. Remaining blocks stay exactly where they are. This is not Tetris — resist the urge.

### Scoring

```
placementPoints = cellsInPiece                    // 1 per cell
lineBonus       = 10 * L * (L + 1) / 2            // L = lines cleared this placement
                                                   // 1→10, 2→30, 3→60, 4→100, 5→150
runMultiplier   = min(1 + 0.5 * (run - 1), 5)     // run = consecutive placements
                                                   // that cleared ≥1 line
turnScore = placementPoints + lineBonus * runMultiplier
```

`run` increments on any placement that clears at least one line and **resets to 0** on a placement that clears nothing. Cap the multiplier so late-game scores don't run away.

### Nowhere left to put it
After every placement, check whether **any** remaining piece — tray *or* Nook — fits **anywhere**. If none do, the run ends. Check after each placement, not only when the tray empties.

---

## 2. The Nook

**The signature mechanic, and the reason the game is called what it's called.**

One slot beside the tray. Drag any tray piece into it to stash it; it stays there across deals until you place it. It counts as a fourth placeable piece for the end-of-run check.

### Rules
- One piece capacity.
- **One swap per deal.** Dragging a tray piece in when the Nook is occupied ejects the stored piece back to the tray, and consumes your swap for that deal. Without this limit, players churn pieces to fish for good shapes and the three-piece planning tension collapses.
- A new deal arrives only when the **tray** is empty. The Nook holding a piece does not block the next deal.
- If the only placeable piece is the one in the Nook, the game is not over.

### Why it's the right addition
It converts the game's worst moment — dying to a shape you had nowhere to put — into a resource you manage from turn one. It adds real depth with a single rule and zero change to the core loop. And "I nooked a 1×1 six turns ago for exactly this" is the sentence you want players saying to each other.

### UI
Sits to the left of the three tray pieces, visually recessed — a physical alcove in the board's frame, not a fourth tray slot. Empty state shows a faint outline and the word `nook` in the ivory text colour at low opacity. When it holds a piece and your swap is spent, the alcove dims slightly. Long-press or a dedicated `Q` key stashes without dragging.

---

## 3. Everything else that's new

Ranked by impact-per-hour. The core loop above stays untouched; all of this is a layer a player could ignore.

### Tier 1 — build into v1

**Today's Nook (seeded daily board + share)**
The piece sequence is generated from a deterministic PRNG seeded with the date (`hash("2026-08-01")`). Everyone plays the identical sequence. No backend at all — the seed is a pure function of the date. Share button copies a spoiler-free result:

```
Nook #204 — 12,480
🟦🟦🟪 ⬛🟦🟨 🟪🟪🟪 🟦⬛
longest run ×4.5 · swept clean twice
```

A short brand name means the score stays the loudest thing in the line. Endless remains the default mode; Today's Nook is the reason to come back tomorrow.

**Live clear preview**
While dragging over a legal position, highlight the rows and columns that *would* clear and show the points that placement would score. Pure UX, but it makes the game vastly more readable on a small screen and teaches the run system without a tutorial.

### Tier 2 — the differentiators, ship after launch

**Keys (soft ending)**
Earn a Key each time you hit a ×3 run. When nothing fits, instead of an immediate ending you're offered a choice: spend a Key to break a 2×2 area of your choosing, or stop. Cap at 3 held. Keys are *earned by skill*, never bought, so runs stay comparable. This reframes the abrupt death into a decision and gives runs a second purpose beyond score.

**Rearrange (weekly mutator)**
One rotating rule modifier, live for seven days, in its own mode:
- *Cascade* — cleared lines cause blocks above to fall
- *Big Nook* — 9×9 board
- *Spare* — no 1×1 or 1×2 pieces in the bag
- *Mirror* — clearing row 3 also clears row 6, and so on
- *Fog* — the third tray piece is hidden until the first two are placed

One slot, rotating, so you never fragment players across a menu of dead modes.

**Same-seed duel**
Share a link containing a seed. Both players get the identical sequence and play whenever they like; compare scores. Asynchronous multiplayer for the price of a URL parameter.

### Tier 3 — bigger swings

**Charged cells** — roughly 1 in 15 dealt pieces has one cell drawn as charged. A line clearing through it also clears the 3×3 around it. Creates setup play: you start aiming charged cells at your worst clusters.

**Daily puzzle** — a fixed board plus exactly 5 pieces in order; clear the whole board. **Generate by playing backwards** — start empty, repeatedly un-clear lines and un-place pieces — which guarantees solvability and hands you the solution for free. A 60-second brain teaser beside the endless mode broadens your audience considerably.

**Replay ghosts** — a run is (seed + list of placements), a few hundred bytes. Store personal bests, replay them, overlay a friend's path on a duel seed. Also the best debugging tool you'll ever have.

**Fair Deal toggle** — expose the generator. Fair Deal turns off all adaptive assistance and gives pure weighted-random pieces. Most games in this genre quietly manipulate the bag and players resent discovering it. Being upfront is a real trust signal, and the hardcore leaderboard should be Fair-only.

### Deliberately not doing
Timers, energy systems, lives, mid-run ads, rotation, forced tutorials. The reason this genre works is that it's calm — and calm is the entire brand.

---

## 4. Tech stack

**Recommended:** TypeScript + Vite + a single `<canvas>` with a hand-written renderer. No game engine.

| Choice | Why |
|---|---|
| **TypeScript** | Small, highly type-friendly core. Piece shapes and board states benefit enormously from a type system. |
| **Vite** | Instant dev server, trivial static build, first-class PWA plugin. |
| **Canvas 2D** | 64 cells, up to 5 dragging cells, particles at 60fps. Canvas 2D is genuinely enough — you do not need WebGL or Pixi for an 8×8 grid. |
| **DOM for chrome** | Menus, settings, share sheet, leaderboard in plain HTML/CSS. Only board, tray, and Nook are canvas. Keeps accessibility and text rendering easy. |
| **No framework** | React costs build size and an update model you don't want around a 60fps canvas. If you prefer React, use it only for surrounding UI. |

**Viable alternative:** pure DOM with CSS Grid and transforms. Honestly fine here, easier to make accessible, simpler to debug; you trade away fine-grained particles. If you're more fluent in DOM, take it — the feel comes from easing and timing, not the rendering backend.

### Hosting
Static build → **Cloudflare Pages** on `nookgame.lol`. Free, global CDN, instant deploys. Add a PWA manifest and service worker so Nook installs to the home screen and works offline — a real advantage for a phone game.

### Backend (only for global leaderboards)
Start with `localStorage` and no backend. When you want leaderboards: **Cloudflare Workers + D1**. Submit the seed plus the move list; the Worker re-simulates the run using the same core module and rejects anything whose replay doesn't produce the claimed score. This is the whole reason to keep the core pure.

---

## 5. Architecture

```
src/
  core/                  # pure, no DOM, fully unit-tested
    rng.ts               # mulberry32 seeded PRNG
    pieces.ts            # shape catalogue + weights
    board.ts             # bitboard ops, placement, clearing
    generator.ts         # deals the 3-piece sets
    scoring.ts           # score + run multiplier
    game.ts              # reducer(state, action) -> state
  render/
    renderer.ts          # board, tray, nook, drag ghost
    sprites.ts           # pre-rendered block faces, offscreen canvas
    particles.ts
    easing.ts
  input/
    pointer.ts           # unified Pointer Events
    drag.ts              # drag controller: finger offset + snapping
    keyboard.ts          # desktop + accessibility
  ui/                    # DOM: menus, HUD, share, settings
  platform/
    storage.ts, audio.ts, haptics.ts, share.ts
```

**The critical rule:** `core/` must be pure — no DOM, no `Date.now()`, no `Math.random()`. All randomness comes from the injected seeded PRNG. That one discipline gives you, free: Today's Nook, replays, server-side validation, undo, and tests that never flake.

Model the game as `reducer(state, action) → newState`, with actions like `{type: 'place', source: 'tray'|'nook', index, x, y}` and `{type: 'stash', index}`. A run is then literally an array of actions.

### Bitboards
An 8×8 board is 64 bits. Represent it as a `BigInt` (or a pair of `Uint32`s if you later need speed):

```ts
const idx = (x: number, y: number) => y * 8 + x;
const bit = (x: number, y: number) => 1n << BigInt(idx(x, y));

const ROW = (y: number) => 0xFFn << BigInt(y * 8);
const COL = (x: number) => 0x0101010101010101n << BigInt(x);

const canPlace = (board: bigint, mask: bigint) => (board & mask) === 0n;
```

Precompute once at startup a mask for every (piece × anchor) — about 40 × 64 ≈ 2,500 `BigInt`s. Then:

- **Does this piece fit anywhere?** loop its 64 masks. Microseconds.
- **Any legal move at all?** four pieces (tray + Nook) × 64 anchors = 256 checks. Free.
- **Line clearing:** `(board & ROW(y)) === ROW(y)`.

This makes the expensive-sounding features — solvability lookahead, hints, puzzle generation — all trivially cheap.

### Piece generation — the actual secret sauce
Naive weighted-random deals feel terrible. Layer these:

1. **Weighted bag,** not uniform. Small pieces frequent; 3×3 and 5-lines rare.
2. **Guaranteed fit at deal time.** At least one of the three must be placeable on the current board. Non-negotiable.
3. **Sequence solvability check.** Verify that *some ordering* of the three is fully placeable (3! orderings × a bounded search). If not, redeal. Kills the "unwinnable hand" complaint outright.
4. **Openness-adaptive weighting.** Compute board pressure — e.g. count of legal 3×3 placements remaining. High pressure biases small pieces; an empty board biases large. Control strength with a `mercy` parameter that decays as score rises, so the game genuinely hardens as you improve.
5. **Anti-repetition.** Never deal three identical pieces; avoid the same shape three deals running.

Note that #2 and #3 should consider the Nook's contents — a player holding a 1×1 has more outs, and the generator should know it.

Expose #4 behind the Fair Deal toggle.

---

## 6. Mobile-first implementation details

Where most web puzzle games fall down. These specifics matter.

### The finger-occlusion problem
**Render the dragged piece offset roughly 1.5 grid cells above the touch point.** If it renders under the finger, the player can't see what they're doing and the game feels unplayable. This single detail is the difference between "nice" and "why does this feel bad." Don't apply the offset for mouse input.

### Touch handling
- **Pointer Events** only (`pointerdown` / `pointermove` / `pointerup`) — one path for touch, mouse, stylus. `setPointerCapture()` on down so drags survive leaving the element.
- `touch-action: none` on board, tray, and Nook, or the browser steals your drag for scrolling.
- `overscroll-behavior: none` on `html, body` to kill pull-to-refresh mid-drag.
- `user-select: none` and `-webkit-touch-callout: none` to prevent long-press selection menus.
- `<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, user-scalable=no">`, and respect `env(safe-area-inset-bottom)` so the tray isn't under the iPhone home indicator.

### Snapping
Snap the ghost to the nearest legal position within a generous radius (~0.6 of a cell), based on the piece's **top-left cell**, not the finger. If no legal position is in range, tint the piece invalid rather than hiding the ghost — silent failure confuses. Add drop tolerance: released 10px outside a legal snap with exactly one nearby candidate, take it. Generosity reads as responsiveness.

### Layout
```
Portrait (primary)          Landscape / desktop
┌──────────────┐            ┌─────────────────────────┐
│ score   ×3   │            │  score      ┌─────────┐ │
├──────────────┤            │  run ×3     │         │ │
│              │            │             │  board  │ │
│    board     │            │  ┌────┐     │         │ │
│    (8×8)     │            │  │nook│     └─────────┘ │
│              │            │  └────┘ ┌──┐┌──┐┌──┐    │
├──────────────┤            └─────────────────────────┘
│ ┌──┐ [1][2][3]│
│ │nk│          │  ← thumb zone
└──────────────┘
```
Board sized `min(100vw - 32px, 60vh)`, snapped to a multiple of 8 so cells land on whole pixels. Tray and Nook in the bottom third. On desktop, cap the playfield around 480px and centre it — don't stretch a phone game across a 27" monitor.

### Canvas crispness
```ts
const dpr = Math.min(window.devicePixelRatio || 1, 3); // cap at 3 — 4x on some
canvas.width  = cssWidth  * dpr;                        // Androids is wasted fill rate
canvas.height = cssHeight * dpr;
canvas.style.width  = cssWidth  + 'px';
canvas.style.height = cssHeight + 'px';
ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
```
Re-run on `ResizeObserver`. Pre-render each block face once to an offscreen canvas rather than redrawing gradients and shadows 64 times a frame.

### Haptics and audio
- `navigator.vibrate(8)` on placement, a short pattern on a clear. Android Chrome only — **iOS Safari does not support the Vibration API**, so treat it as a bonus, never a foundation.
- Web Audio with short pre-decoded buffers, never `<audio>` elements. Create or resume the `AudioContext` inside the first user gesture or iOS keeps it suspended.
- Rising pitch per run step is the cheapest dopamine in game design. Ship it — but keep it soft. Nook is not a slot machine.

### Desktop and accessibility
Same pointer code handles mouse. Add keyboard control, which serves power users and screen-reader users equally:
- `1` `2` `3` select a tray piece, `Q` stashes to the Nook, `E` retrieves from it
- Arrows / WASD move the ghost, `Enter` or `Space` places
- `aria-live="polite"` region announcing state ("placed. cleared 2 lines. score 1,240.")
- Respect `prefers-reduced-motion`: cut shake and particles, keep functional animation.

---

## 7. Game feel checklist

The mechanics are 20% of why this genre is addictive. This is the other 80%.

- [ ] Piece **lifts and scales to ~1.15×** with a shadow on pickup
- [ ] Ghost outline at the snap target, ~35% opacity
- [ ] Rows/columns that *would* clear pulse while dragging
- [ ] Placement snaps home with a short overshoot ease (~120ms)
- [ ] Cleared blocks **scale up briefly, then pop**, staggered ~15ms per cell outward from the placement — the stagger is what makes it feel like a wave
- [ ] Particle burst per cleared cell, tinted to that cell's colour
- [ ] Score **rolls up** over ~400ms rather than jumping
- [ ] Screen shake, tiny (2–4px), only on 3+ line clears
- [ ] Run counter lights along the bezel; escalating pitch per step
- [ ] Stashing to the Nook has its own soft, distinct sound — a small *tuck*
- [ ] Tray pieces **fade to 40% when they no longer fit anywhere** — vital readability, and it builds dread beautifully
- [ ] Swept clean is rare; make the celebration count
- [ ] Ending: board fades to greyscale over ~600ms *before* the panel appears. Let the moment land.
- [ ] 60fps on a 4-year-old mid-range Android. Test on real hardware, not the desktop emulator.

---

## 8. Art direction

Most games in this genre look like glossy candy plastic. Go elsewhere so Nook is recognisable in a screenshot.

**Direction: enamel pin.** Blocks are vitreous enamel set in brass cells — deep, saturated, slightly uneven colour in a thin metal bezel, recessed into a slate-felt board. Tactile and jewel-like rather than bouncy. Clearing reads as the enamel cracking with light coming through from beneath. The Nook is a genuine alcove cut into the frame — same brass bezel, deeper shadow.

```
Felt background   #23262E
Board recess      #1A1D23
Brass bezel       #C8A24A
Enamel viridian   #1E7A6A
Enamel cobalt     #2B5FBF
Enamel oxblood    #A32E3E
Enamel saffron    #E0A032
Ivory (text)      #EFE8DA
```

**Type:** a characterful grotesque for display and run text (Bricolage Grotesque or Familjen Grotesk), plus a UI face with **tabular figures** for the score — non-tabular digits jitter horribly while a counter rolls, and it's the kind of detail people feel without being able to name.

**Signature element:** the score isn't a number in a corner. It's an engraved brass plate below the board where digits roll like a mechanical odometer, and the current run lights up as filled enamel dots along the bezel. One memorable thing; everything else stays quiet.

---

## 9. Roadmap

| Phase | Deliverable | Rough effort |
|---|---|---|
| **0. Skeleton** | Vite + TS, canvas resizing correctly at DPR, empty 8×8 grid drawn | ½ day |
| **1. Core loop** | Pure `core/` with full unit tests. Ugly but complete: deal, drag, place, clear, score, end. **Playable.** | 2–3 days |
| **2. The Nook** | Stash mechanic, swap limit, end-check integration, keyboard bindings | ½ day |
| **3. Input polish** | Pointer Events, finger offset, snapping, ghost, clear preview, safe areas | 2 days |
| **4. Feel** | Every item in §7. This is what makes it good — don't rush it. | 2–3 days |
| **5. Ship** | Art pass, PWA manifest + service worker, `localStorage`, Today's Nook + share, deploy to `nookgame.lol` | 2 days |
| **6. Depth** | Keys, Rearrange, same-seed duel | 1 week |
| **7. Scale** | Worker + D1 leaderboard with replay validation, daily puzzle, charged cells | 1–2 weeks |

You have something genuinely playable at the end of phase 1 — put it on your phone that day and play it on the sofa. Every important decision after that comes from that experience, not from this document.

### Testing
- **Unit tests** (Vitest) on `core/`: placement legality, simultaneous row+column clears, run reset rules, end detection with a piece in the Nook, scoring edge cases.
- **Property test:** replay a random seeded 1,000-move run twice; final states must be byte-identical. Catches any accidental impurity in the core.
- **Fuzz the generator:** 10,000 auto-games with a random-legal-move bot. Log score distribution and run length; tune weights and the `mercy` curve from those histograms rather than by feel.

---

## 10. Legal note

Game *mechanics* aren't protected by copyright — this genre descends from a 1980s design and there are dozens of entries. What is protected is specific expression: name, logo, artwork, sound, distinctive UI. You have your own name, art direction, and signature mechanic, which is exactly right. The open question is the trademark clearance on *Nook* itself (§0) — worth resolving before the logo work, not after.

---

## First commit

```bash
npm create vite@latest nook -- --template vanilla-ts
cd nook && npm i && npm i -D vitest
```

Write `core/board.ts` and its test file before you draw a single pixel. If the core is pure and tested, the rest of this is presentation.
