// Rasterises the app icon to PNG at the sizes the platforms actually demand.
//
// `public/icon.svg` is the source of truth and covers the manifest and the
// favicon on its own. iOS is the reason this file exists: `apple-touch-icon`
// does not accept SVG, and without a PNG the home screen falls back to a
// screenshot of the page, which for a canvas game is a grey rectangle.
//
// No image library, no build step, no dependency — the icon is a handful of
// rounded rectangles and PNG is a handful of chunks around a zlib stream.
//
//   node scripts/make-icons.mjs

import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');

// --- colour ----------------------------------------------------------------

const hex = (s) => [
  parseInt(s.slice(1, 3), 16),
  parseInt(s.slice(3, 5), 16),
  parseInt(s.slice(5, 7), 16),
];

const mix = (a, b, t) => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];

/** Paint `src` over `dst` with coverage `alpha`. */
const over = (dst, src, alpha) => mix(dst, src, Math.max(0, Math.min(1, alpha)));

// --- geometry --------------------------------------------------------------

/**
 * Signed distance from a point to a rounded rectangle: negative inside,
 * positive outside. Gives free antialiasing — coverage is just the distance
 * clamped across one pixel — and makes the bezel a band around the same shape
 * rather than a second shape that has to line up.
 */
function roundRectDistance(px, py, x, y, w, h, r) {
  const cx = Math.abs(px - (x + w / 2)) - (w / 2 - r);
  const cy = Math.abs(py - (y + h / 2)) - (h / 2 - r);
  const dx = Math.max(cx, 0);
  const dy = Math.max(cy, 0);
  return Math.min(Math.max(cx, cy), 0) + Math.hypot(dx, dy) - r;
}

const FELT_TOP = hex('#282C35');
const FELT_BOTTOM = hex('#1E212A');
const RECESS = hex('#161920');
const BRASS_LIGHT = hex('#E0C079');
const BRASS_MID = hex('#C8A24A');
const BRASS_DARK = hex('#9A7A2E');
const ENAMEL_LIGHT = hex('#2A9D88');
const ENAMEL_DARK = hex('#166052');
const ENAMEL_EDGE = hex('#4FC7AE');

/**
 * The icon, in a 512-unit space. `pad` insets the artwork for the maskable
 * variant, where platforms may crop to a circle.
 */
function shade(ux, uy, pad) {
  const s = (v) => pad + (v / 512) * (512 - pad * 2);

  // Felt field, top to bottom.
  let rgb = mix(FELT_TOP, FELT_BOTTOM, uy / 512);

  const recess = roundRectDistance(ux, uy, s(96), s(96), s(320) - pad, s(320) - pad, s(44) - pad / 2);
  // Inside the alcove, darker than the felt so the block sits *in* it.
  rgb = over(rgb, RECESS, 0.5 - recess);

  // The bezel is a band centred on the recess edge.
  const half = ((14 / 512) * (512 - pad * 2)) / 2;
  const bezel = half - Math.abs(recess);
  if (bezel > -1) {
    // Light from the top-left, so the metal reads as metal.
    const t = (ux + uy) / (512 * 2);
    const brass = t < 0.5 ? mix(BRASS_LIGHT, BRASS_MID, t * 2) : mix(BRASS_MID, BRASS_DARK, (t - 0.5) * 2);
    rgb = over(rgb, brass, bezel + 0.5);
  }

  const block = roundRectDistance(ux, uy, s(150), s(192), s(212) - pad, s(212) - pad, s(30) - pad / 2);
  if (block < 1) {
    const t = Math.min(1, Math.max(0, (uy - s(192)) / (s(212) - pad)));
    rgb = over(rgb, mix(ENAMEL_LIGHT, ENAMEL_DARK, t), 0.5 - block);
  }

  // Light catching the rim — vitreous enamel, not plastic.
  const rim = (7 / 512) * (512 - pad * 2) - Math.abs(block + 3);
  if (rim > -1) rgb = over(rgb, ENAMEL_EDGE, (rim + 0.5) * 0.55);

  return rgb;
}

// --- PNG -------------------------------------------------------------------

const CRC = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function png(size, pad) {
  // Raw scanlines, each prefixed with filter byte 0.
  const raw = Buffer.alloc(size * (size * 3 + 1));
  let p = 0;
  for (let y = 0; y < size; y++) {
    raw[p++] = 0;
    for (let x = 0; x < size; x++) {
      // Sample at the pixel centre, in the 512-unit design space.
      const ux = ((x + 0.5) / size) * 512;
      const uy = ((y + 0.5) / size) * 512;
      const [r, g, b] = shade(ux, uy, pad);
      raw[p++] = Math.round(Math.max(0, Math.min(255, r)));
      raw[p++] = Math.round(Math.max(0, Math.min(255, g)));
      raw[p++] = Math.round(Math.max(0, Math.min(255, b)));
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // truecolour
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const targets = [
  ['icon-192.png', 192, 0],
  ['icon-512.png', 512, 0],
  ['icon-maskable-512.png', 512, 56],
  ['apple-touch-icon.png', 180, 0],
];

for (const [name, size, pad] of targets) {
  const buf = png(size, pad);
  writeFileSync(join(OUT, name), buf);
  console.log(`${name}  ${size}x${size}  ${(buf.length / 1024).toFixed(1)}kB`);
}
