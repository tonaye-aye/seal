// Draws the background grain: one small square of random specks that repeats
// across the window with no visible seam. The picture holds only see-through
// values, so the colour and strength come from tokens.css in each theme.
// The random sequence is fixed, so running this again gives the same file.
//
// Run: node scripts/make-grain.ts

import { writeFileSync } from "node:fs";
import { crc32, deflateSync } from "node:zlib";

const SIZE = 256;
const LEVELS = 16; // 16 strengths of speck are plenty, and keep the file small.
// Above 1, most specks are faint and a few are strong, which reads as film grain.
const FALLOFF = 1.5;
const OUTPUT = new URL("../src/assets/grain.png", import.meta.url);

// A small random number generator that starts from a fixed seed.
function random(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), seed | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// One named block of a PNG file: length, name, data, then a checksum.
function chunk(name: string, data: Buffer) {
  const label = Buffer.from(name, "latin1");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([label, data])));
  return Buffer.concat([length, label, data, checksum]);
}

const next = random(20261122);
// Each row starts with a 0 (no PNG filter), then two pixels per byte.
const rowBytes = 1 + SIZE / 2;
const pixels = Buffer.alloc(rowBytes * SIZE);
for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    const level = Math.min(LEVELS - 1, Math.floor(LEVELS * next() ** FALLOFF));
    const at = y * rowBytes + 1 + (x >> 1);
    pixels[at] |= x % 2 === 0 ? level << 4 : level;
  }
}

const header = Buffer.alloc(13);
header.writeUInt32BE(SIZE, 0);
header.writeUInt32BE(SIZE, 4);
header[8] = 4; // four bits per pixel
header[9] = 3; // colours come from a short list

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk("IHDR", header),
  chunk("PLTE", Buffer.alloc(LEVELS * 3)), // every entry is black: only its see-through value is used
  chunk("tRNS", Buffer.from(Array.from({ length: LEVELS }, (_, i) => Math.round((i / (LEVELS - 1)) * 255)))),
  chunk("IDAT", deflateSync(pixels, { level: 9 })),
  chunk("IEND", Buffer.alloc(0)),
]);

writeFileSync(OUTPUT, png);
console.log(`Wrote src/assets/grain.png: ${SIZE}x${SIZE}, ${png.length} bytes`);
