// Pre-rendered block faces. Drawing the gradient, bezel and highlight for 64
// cells every frame is wasteful; drawing one image 64 times is not.
//
// Art direction is "neon & chrome": backlit acrylic jewels with a hot gold
// rim-light, sunk into a black lacquer table. Lit from within rather than lit
// from above — the old enamel-pin direction was a quiet object catching the
// light, and this one is a machine making its own.

export const FELT = '#191324';
export const RECESS = '#241C33';
export const BRASS = '#F0B93A';
export const IVORY = '#F7EEDD';

/**
 * Index 0 is unused so a colour of 0 can mean "empty".
 *
 * The names below are kept — `ENAMEL`, and the export names throughout — because
 * every call site indexes this array by number and renaming them buys nothing.
 * The values are what changed.
 *
 * These are rich rather than fluorescent, and the table they sit on is a dark
 * plum rather than a black hole. Full-saturation neon against near-black is a
 * genuinely painful combination to look at for more than a minute — the eye has
 * no mid-tone anywhere to rest on — and it also destroys the empty grid, which
 * has to stay legible against the board for the game to be playable at all.
 * Loud is a matter of contrast and motion, not of turning every channel to 255.
 */
export const ENAMEL = [
  '#000000',
  '#E23C86', // magenta
  '#2FB6D9', // cyan
  '#7FC94A', // lime
  '#EDA531', // gold
] as const;

export interface SpriteSheet {
  readonly cell: number;
  /** Indexed by colour, 1–4. Slot 0 is a placeholder. */
  readonly faces: readonly HTMLCanvasElement[];
  /** Overlaid on a block face to mark a cell. Cool stone vs. warm star. */
  readonly gem: HTMLCanvasElement;
  readonly star: HTMLCanvasElement;
  readonly charge: HTMLCanvasElement;
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

/** Lighten or darken a #rrggbb by `amount` in [-1, 1]. */
function shade(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16);
  const mix = (c: number): number =>
    Math.round(amount >= 0 ? c + (255 - c) * amount : c * (1 + amount));
  const r = mix((n >> 16) & 255);
  const g = mix((n >> 8) & 255);
  const b = mix(n & 255);
  return `rgb(${r}, ${g}, ${b})`;
}

function drawFace(cell: number, dpr: number, color: string): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(cell * dpr));
  canvas.height = Math.max(1, Math.round(cell * dpr));

  const ctx = canvas.getContext('2d')!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const inset = Math.max(0.75, cell * 0.045);
  const w = cell - inset * 2;
  const radius = cell * 0.17;

  // Backlit acrylic: hot in the middle where the lamp is, falling off toward
  // the edges. A radial gradient rather than the old vertical one, because a
  // block lit from *inside* has its brightest point in the centre of its face,
  // not along its top edge.
  const body = ctx.createRadialGradient(
    cell * 0.5,
    cell * 0.42,
    cell * 0.05,
    cell * 0.5,
    cell * 0.5,
    cell * 0.62,
  );
  body.addColorStop(0, shade(color, 0.3));
  body.addColorStop(0.45, shade(color, 0.04));
  body.addColorStop(1, shade(color, -0.28));

  roundRect(ctx, inset, inset, w, w, radius);
  ctx.fillStyle = body;
  ctx.fill();

  // The rim-light: what makes the board look like it is plugged in. Warm gold
  // at three-quarters rather than a full-opacity outline — at full strength on
  // every one of 64 cells it stopped reading as light and started reading as a
  // gold grid drawn over the top of the game.
  ctx.lineWidth = Math.max(0.75, cell * 0.055);
  ctx.strokeStyle = 'rgba(240, 185, 58, 0.75)';
  ctx.stroke();

  ctx.save();
  ctx.clip();

  // A bright specular streak across the top, and a dimmer one at the bottom so
  // the face reads as a curved slab of acrylic rather than a flat sticker.
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
  ctx.lineWidth = Math.max(0.75, cell * 0.06);
  ctx.beginPath();
  ctx.moveTo(inset + radius * 0.7, inset + cell * 0.1);
  ctx.lineTo(inset + w - radius * 0.7, inset + cell * 0.1);
  ctx.stroke();

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.14)';
  ctx.lineWidth = Math.max(0.5, cell * 0.045);
  ctx.beginPath();
  ctx.moveTo(inset + radius * 0.9, inset + w - cell * 0.08);
  ctx.lineTo(inset + w - radius * 0.9, inset + w - cell * 0.08);
  ctx.stroke();

  ctx.restore();

  return canvas;
}

/**
 * A brilliant set into the enamel: a brass collet with a pale stone in it.
 * Deliberately a different *shape* from everything else on the board, because
 * at 40px on a phone shape reads long before colour does.
 */
export function drawGemPath(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radius: number,
): void {
  ctx.beginPath();
  ctx.moveTo(cx, cy - radius);
  ctx.lineTo(cx + radius, cy);
  ctx.lineTo(cx, cy + radius);
  ctx.lineTo(cx - radius, cy);
  ctx.closePath();
}

function drawGem(cell: number, dpr: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(cell * dpr));
  canvas.height = Math.max(1, Math.round(cell * dpr));

  const ctx = canvas.getContext('2d')!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const c = cell / 2;
  const r = cell * 0.27;

  // A dark seat so the stone reads against any of the four enamels.
  drawGemPath(ctx, c, c, r * 1.3);
  ctx.fillStyle = 'rgba(16, 18, 22, 0.5)';
  ctx.fill();

  const stone = ctx.createLinearGradient(c - r, c - r, c + r, c + r);
  stone.addColorStop(0, '#FFFFFF');
  stone.addColorStop(0.45, '#CFE9F2');
  stone.addColorStop(1, '#7FB6C9');

  drawGemPath(ctx, c, c, r);
  ctx.fillStyle = stone;
  ctx.fill();
  ctx.lineWidth = Math.max(0.75, cell * 0.045);
  ctx.strokeStyle = BRASS;
  ctx.stroke();

  // One facet line, so it catches the eye as a cut stone rather than a pip.
  ctx.beginPath();
  ctx.moveTo(c - r * 0.5, c);
  ctx.lineTo(c, c - r * 0.5);
  ctx.lineTo(c + r * 0.5, c);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
  ctx.lineWidth = Math.max(0.5, cell * 0.03);
  ctx.stroke();

  return canvas;
}

export function drawStarPath(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radius: number,
): void {
  const inner = radius * 0.44;
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? radius : inner;
    // Start at the top point, so the star reads upright at any size.
    const angle = -Math.PI / 2 + (i * Math.PI) / 5;
    const px = cx + Math.cos(angle) * r;
    const py = cy + Math.sin(angle) * r;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

/**
 * The post-unlock marker. Deliberately warm where the gem is cool, and
 * five-pointed where the gem is a diamond — at tray size the silhouette is
 * doing all the work, so shape and temperature both have to differ.
 */
function drawStar(cell: number, dpr: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(cell * dpr));
  canvas.height = Math.max(1, Math.round(cell * dpr));

  const ctx = canvas.getContext('2d')!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const c = cell / 2;
  const r = cell * 0.3;

  // Same dark seat as the gem, so it holds up over saffron blocks too.
  drawStarPath(ctx, c, c, r * 1.28);
  ctx.fillStyle = 'rgba(16, 18, 22, 0.5)';
  ctx.fill();

  const gold = ctx.createLinearGradient(c, c - r, c, c + r);
  gold.addColorStop(0, '#FFF3CE');
  gold.addColorStop(0.5, '#F0C25A');
  gold.addColorStop(1, '#C8892A');

  drawStarPath(ctx, c, c, r);
  ctx.fillStyle = gold;
  ctx.fill();
  ctx.lineWidth = Math.max(0.6, cell * 0.035);
  ctx.strokeStyle = 'rgba(80, 54, 12, 0.65)';
  ctx.stroke();

  return canvas;
}

/**
 * A flame, for a charged cell.
 *
 * Read as a silhouette: the gem is a faceted diamond, the star is spiked, and
 * this is a teardrop with a point at the top. At tray size the outline is doing
 * all the work, so all three have to differ in shape before they differ in
 * colour — and a flame says "this is going to go off" in a way a ring never did.
 */
export function drawFlamePath(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radius: number,
): void {
  const r = radius;
  ctx.beginPath();
  // Tip, leaning very slightly so it reads as alight rather than as a droplet.
  ctx.moveTo(cx + r * 0.08, cy - r);
  ctx.bezierCurveTo(
    cx + r * 0.82, cy - r * 0.2,
    cx + r * 0.72, cy + r * 0.62,
    cx, cy + r,
  );
  ctx.bezierCurveTo(
    cx - r * 0.72, cy + r * 0.62,
    cx - r * 0.8, cy - r * 0.18,
    cx + r * 0.08, cy - r,
  );
  ctx.closePath();
}

function drawCharge(cell: number, dpr: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(cell * dpr));
  canvas.height = Math.max(1, Math.round(cell * dpr));

  const ctx = canvas.getContext('2d')!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const c = cell / 2;
  const r = cell * 0.3;

  // The same dark seat the other two markers use, so it holds over any colour.
  drawFlamePath(ctx, c, c, r * 1.26);
  ctx.fillStyle = 'rgba(16, 18, 22, 0.55)';
  ctx.fill();

  // Hot at the base, bright at the tip — the way a flame actually reads.
  const body = ctx.createLinearGradient(c, c - r, c, c + r);
  body.addColorStop(0, '#FFD98A');
  body.addColorStop(0.45, '#E8892E');
  body.addColorStop(1, '#B33A28');

  drawFlamePath(ctx, c, c, r);
  ctx.fillStyle = body;
  ctx.fill();
  ctx.lineWidth = Math.max(0.6, cell * 0.03);
  ctx.strokeStyle = 'rgba(90, 30, 14, 0.6)';
  ctx.stroke();

  // An inner flame, offset up, so there is something burning inside it.
  drawFlamePath(ctx, c, c + r * 0.22, r * 0.46);
  ctx.fillStyle = '#FFF3CE';
  ctx.fill();

  return canvas;
}

/**
 * Pre-rendered sheets, keyed by cell size. Board cell plus one per distinct
 * tray footprint are live at once; anything beyond that is history left behind
 * by a window resize or a device rotation, each holding several canvases alive.
 */
const MAX_SHEETS = 16;

export class SpriteCache {
  private dpr = 0;
  private sheets = new Map<number, SpriteSheet>();

  get(cell: number, dpr: number): SpriteSheet {
    if (dpr !== this.dpr) {
      this.dpr = dpr;
      this.sheets.clear();
    }

    const key = Math.round(cell * 4) / 4;
    const existing = this.sheets.get(key);
    if (existing) {
      // Re-insert so insertion order tracks recency; the eviction below then
      // drops the coldest size rather than an arbitrary one.
      this.sheets.delete(key);
      this.sheets.set(key, existing);
      return existing;
    }

    const sheet: SpriteSheet = {
      cell: key,
      faces: ENAMEL.map((color) => drawFace(key, dpr, color)),
      gem: drawGem(key, dpr),
      star: drawStar(key, dpr),
      charge: drawCharge(key, dpr),
    };

    if (this.sheets.size >= MAX_SHEETS) {
      const coldest = this.sheets.keys().next().value;
      if (coldest !== undefined) this.sheets.delete(coldest);
    }
    this.sheets.set(key, sheet);
    return sheet;
  }
}
