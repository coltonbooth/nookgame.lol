# Nook — Block Puzzle

An 8×8 block puzzle. Every piece finds its nook.

Design document and roadmap: [`plan.md`](./plan.md). This repo currently covers
roadmap phases 0–3: scaffold, pure tested core, the Nook, and input polish.

## Commands

```bash
npm run dev          # dev server, bound to the LAN so a phone can reach it
npm run build        # typecheck + production build to dist/
npm run preview      # serve the production build
npm test             # unit tests
npm run test:fuzz    # 10,000-game generator fuzz + histogram
npm run typecheck
```

To play on a phone, run `npm run dev` and open the `Network:` URL it prints.

## Markers: gems, then stars

Roughly one dealt piece in twelve carries a marker on one of its cells. What a
marker means depends on where the run is up to:

- **Sealed** — markers are **gems**. Clear a row or column through one and the
  Nook opens for the rest of that run. Gems pay no points.
- **Open** — markers are **stars**. Clearing one pays `STAR_BONUS` and, crucially,
  rides the run multiplier — so holding a star line back until you're mid-run is
  worth up to five times cashing it in cold.

The board only ever holds one kind: unlocking wipes the gems, and stars only
appear afterwards. `markerKind()` in `src/core/game.ts` is the single source of
truth for which is on screen.

Two constants to turn after playing on a phone: `MARKER_ONE_IN` in
`src/core/game.ts` and `STAR_BONUS` in `src/core/scoring.ts`.

## Controls

Drag a piece to the board, or drop it on the alcove to stash it. Long-press a
tray piece to stash without dragging. Stashing does nothing while the Nook is
sealed.

| Key | |
|---|---|
| `1` `2` `3` | select a tray piece |
| `Q` | stash to the Nook |
| `E` | take the Nook's piece |
| arrows / `WASD` | move the ghost |
| `Enter` / `Space` | place |
| `Esc` | put it back |

## How the generator picks pieces

Five layers, in `src/core/generator.ts`. The interesting one is layer 4.

As the board tightens, the generator reads it — `analyseBoard()` works out, for
every piece in the catalogue, where it could go, whether any single placement
would finish a line, and how snugly its best placement would sit in the gap it
lands in. Weights then shift toward pieces that are **longer**, that could
**finish a line**, and that **match the shape of a hole you actually have** —
and away from pieces with nowhere to go at all.

It deliberately does *not* hand out small pieces when you're cornered. That's
the obvious move and it's wrong: short pieces can't finish lines, so the board
keeps filling and the run dies anyway, slowly, on a diet of dominoes.

Tuning dials, all at the top of the file: `SIZE_PULL`, `LINE_PULL`,
`SNUG_PULL`, `DEAD_PENALTY`, and `MERCY_SPAN` (how fast assistance decays as
your score climbs). `Fair Deal` bypasses the whole layer.

## Feel

Clearing a line pops the cells outward in a wave staggered 15ms per step from
where you placed, bursts particles tinted to each cell's own colour, shakes the
board slightly on three lines or more, buzzes, and plays a note whose pitch
climbs with your run. The score counter rolls rather than jumps. Pieces lift and
scale as you pick them up. The board drains to greyscale before the end panel.

**Vibration does not work on iOS Safari** — the API simply isn't implemented
there. Android Chrome gets it. Never build a mechanic that depends on it.

Audio is synthesised with Web Audio (no asset files) and walks a pentatonic
scale, so a long run climbs without ever hitting a sour interval. The context is
created inside the first gesture, or iOS leaves it suspended and silent.

A word appears for a clear worth remarking on — `praiseFor()` in
`src/render/effects.ts` scores lines and run together, so a plain single earns
nothing and a triple or a deep streak earns its way up `nice → great → wow →
amazing → unbelievable → legendary`. Note this is a deliberate break from the
voice rule in `plan.md` §0; keeping the words lowercase is the compromise, and
the `PRAISE` array is the one place to change it.

## Layout

```
src/core/      pure game logic — no DOM, no Date.now, no Math.random
src/render/    canvas renderer, sprite cache, layout maths
src/input/     pointer, drag controller, keyboard
src/ui/        DOM chrome: score, run dots, end panel, announcer
src/platform/  localStorage
```

`core/` is pure and fully unit-tested, and must stay that way. Everything
downstream depends on it — seeded daily boards, replays, server-side score
validation and non-flaky tests all fall out of that one property. There is a
replay-determinism property test guarding it.
