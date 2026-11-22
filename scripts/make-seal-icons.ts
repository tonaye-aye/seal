// Draws Seal's icons from the one shape in src/ui/seal-mark.ts, so the top bar,
// menu bar and app icon can never drift apart. It needs no image library, and
// running it again gives exactly the same files.
//
// - src-tauri/icons/tray.png: 44 px, black on see-through. macOS recolours it to
//   suit a light or dark menu bar (a "template image").
// - docs/brand/app-icon-1024.png: the source for `pnpm tauri icon`. It uses the
//   violet from tokens.css.
//
// Run: node scripts/make-seal-icons.ts

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { crc32, deflateSync } from "node:zlib";
import { SEAL_BODY, SEAL_EYE, SEAL_GRID } from "../src/ui/seal-mark.ts";

type Point = [number, number];

const TRAY = new URL("../src-tauri/icons/tray.png", import.meta.url);
const APP_ICON = new URL("../docs/brand/app-icon-1024.png", import.meta.url);
const TOKENS = readFileSync(new URL("../src/styles/tokens.css", import.meta.url), "utf8");

// macOS app icon layout: an 824 px rounded square centred in 1024 px.
const ICON = 1024;
const TILE = 824;
const SEAL_SCALE = 30; // pixels per grid unit on the app icon
const CORNER = 185; // the tile's corner radius, from Apple's icon grid

/** Turns the body's curves into many short straight lines. */
function bodyOutline(): Point[] {
  const parts = SEAL_BODY.match(/[MCZ]|-?\d*\.?\d+/g) ?? [];
  const points: Point[] = [];
  let i = 0;
  const number = () => Number(parts[i++]);
  while (i < parts.length) {
    const command = parts[i++];
    if (command === "M") points.push([number(), number()]);
    while (command === "C" && i < parts.length && !/[MCZ]/.test(parts[i])) {
      const a = points[points.length - 1];
      const b: Point = [number(), number()];
      const c: Point = [number(), number()];
      const d: Point = [number(), number()];
      for (let step = 1; step <= 32; step++) {
        const t = step / 32;
        const u = 1 - t;
        points.push([
          u * u * u * a[0] + 3 * u * u * t * b[0] + 3 * u * t * t * c[0] + t * t * t * d[0],
          u * u * u * a[1] + 3 * u * u * t * b[1] + 3 * u * t * t * c[1] + t * t * t * d[1],
        ]);
      }
    }
  }
  return points;
}

function eyeOutline(): Point[] {
  return Array.from({ length: 96 }, (_, n) => {
    const angle = (n / 96) * Math.PI * 2;
    return [SEAL_EYE.cx + SEAL_EYE.r * Math.cos(angle), SEAL_EYE.cy + SEAL_EYE.r * Math.sin(angle)] as Point;
  });
}

/**
 * How much of each pixel the seal covers, from 0 to 1. Each pixel row is
 * sampled 16 times, and the eye becomes a hole because a line crossing it
 * flips from inside to outside.
 */
function coverage(size: number, scale: number, offsetX: number, offsetY: number): Float32Array {
  const shapes = [bodyOutline(), eyeOutline()].map((shape) => shape.map(([x, y]) => [x * scale + offsetX, y * scale + offsetY] as Point));
  const result = new Float32Array(size * size);
  const SAMPLES = 16;
  for (let row = 0; row < size; row++) {
    for (let sample = 0; sample < SAMPLES; sample++) {
      const y = row + (sample + 0.5) / SAMPLES;
      const crossings: number[] = [];
      for (const shape of shapes) {
        for (let n = 0; n < shape.length; n++) {
          const [ax, ay] = shape[n];
          const [bx, by] = shape[(n + 1) % shape.length];
          if (ay <= y !== by <= y) crossings.push(ax + ((y - ay) / (by - ay)) * (bx - ax));
        }
      }
      crossings.sort((a, b) => a - b);
      for (let n = 0; n + 1 < crossings.length; n += 2) {
        const from = Math.max(0, crossings[n]);
        const to = Math.min(size, crossings[n + 1]);
        for (let x = Math.floor(from); x < Math.ceil(to); x++) {
          result[row * size + x] += (Math.min(to, x + 1) - Math.max(from, x)) / SAMPLES;
        }
      }
    }
  }
  return result;
}

function chunk(name: string, data: Buffer) {
  const label = Buffer.from(name, "latin1");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const check = Buffer.alloc(4);
  check.writeUInt32BE(crc32(Buffer.concat([label, data])));
  return Buffer.concat([length, label, data, check]);
}

/** Packs red, green, blue and see-through values into a PNG file. */
function png(size: number, rgba: Uint8Array) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // 8 bits per value
  header[9] = 6; // red, green, blue, alpha
  const rows = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    Buffer.from(rgba.buffer, rgba.byteOffset + y * size * 4, size * 4).copy(rows, y * (size * 4 + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(rows, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function makeTray() {
  const SIZE = 44;
  const cover = coverage(SIZE, SIZE / SEAL_GRID, 0, 0);
  const rgba = new Uint8Array(SIZE * SIZE * 4);
  for (let i = 0; i < cover.length; i++) rgba[i * 4 + 3] = Math.round(Math.min(cover[i], 1) * 255);
  writeFileSync(TRAY, png(SIZE, rgba));
}

/** Reads a colour from the first (dark theme) block of tokens.css. */
function token(name: string): [number, number, number] {
  const hex = TOKENS.match(new RegExp(`--${name}:\\s*#([0-9a-fA-F]{6})`))?.[1];
  if (!hex) throw new Error(`No hex value for --${name} in tokens.css`);
  return [0, 2, 4].map((at) => parseInt(hex.slice(at, at + 2), 16)) as [number, number, number];
}

function random(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), seed | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeAppIcon() {
  const top = token("color-accent-solid");
  const bottom = token("color-accent-solid-hover");
  const ink = token("color-on-accent");
  const noise = random(0x5ea1);
  const seal = coverage(ICON, SEAL_SCALE, ICON / 2 - 9.8 * SEAL_SCALE, ICON / 2 - 10 * SEAL_SCALE);
  const rgba = new Uint8Array(ICON * ICON * 4);
  const half = TILE / 2;
  // How far a point is from the tile's edge in pixels: positive outside, negative inside.
  const edge = (x: number, y: number) => {
    const qx = Math.abs(x) - half + CORNER;
    const qy = Math.abs(y) - half + CORNER;
    return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - CORNER;
  };
  for (let y = 0; y < ICON; y++) {
    for (let x = 0; x < ICON; x++) {
      const px = x + 0.5 - ICON / 2;
      const py = y + 0.5 - ICON / 2;
      const tile = Math.max(0, Math.min(1, 0.5 - edge(px, py)));
      // A soft shadow under the tile, as macOS icons have.
      const shadowEdge = edge(px, py - 12);
      const shadow = 0.28 * Math.max(0, Math.min(1, 1 - (shadowEdge + 6) / 30)) ** 2;
      const blend = y / ICON;
      const speck = (noise() - 0.5) * 7; // a quiet grain, like the app's background
      const ink01 = Math.min(seal[y * ICON + x], 1);
      const alpha = tile + shadow * (1 - tile);
      const i = (y * ICON + x) * 4;
      for (let c = 0; c < 3; c++) {
        const fill = top[c] + (bottom[c] - top[c]) * blend + speck;
        const face = fill + (ink[c] - fill) * ink01;
        rgba[i + c] = alpha > 0 ? Math.round(Math.max(0, Math.min(255, (face * tile) / alpha))) : 0;
      }
      rgba[i + 3] = Math.round(alpha * 255);
    }
  }
  mkdirSync(new URL(".", APP_ICON), { recursive: true });
  writeFileSync(APP_ICON, png(ICON, rgba));
}

makeTray();
makeAppIcon();
console.log("Wrote tray.png (44 px) and docs/brand/app-icon-1024.png (1024 px)");
