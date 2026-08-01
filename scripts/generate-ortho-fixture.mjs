#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync, inflateSync } from 'node:zlib';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT_PATH = resolve(ROOT, 'scripts/generate-ortho-fixture.mjs');
const PNG_PATH = resolve(ROOT, 'apps/napplet/tests/fixtures/ortho-fixture.png');
const PROVENANCE_PATH = resolve(ROOT, 'apps/napplet/tests/fixtures/ortho-fixture-provenance.json');
const WIDTH = 256;
const HEIGHT = 192;
const SEED = 0x600d;
const GENERATION_DATE = '2026-07-27';
const LABEL = 'TEST FIXTURE';

const FONT = {
  ' ': ['00000','00000','00000','00000','00000','00000','00000'],
  T: ['11111','00100','00100','00100','00100','00100','00100'],
  E: ['11111','10000','10000','11110','10000','10000','11111'],
  S: ['01111','10000','10000','01110','00001','00001','11110'],
  F: ['11111','10000','10000','11110','10000','10000','10000'],
  I: ['11111','00100','00100','00100','00100','00100','11111'],
  X: ['10001','10001','01010','00100','01010','10001','10001'],
  U: ['10001','10001','10001','10001','10001','10001','01110'],
  R: ['11110','10001','10001','11110','10100','10010','10001'],
};

function sha256(value) { return createHash('sha256').update(value).digest('hex'); }
function u32(value) { const b = Buffer.alloc(4); b.writeUInt32BE(value >>> 0); return b; }
function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const typeBuffer = Buffer.from(type, 'ascii');
  return Buffer.concat([u32(data.length), typeBuffer, data, u32(crc32(Buffer.concat([typeBuffer, data])))]);
}
function putPixel(pixels, x, y, color) {
  if (x < 0 || y < 0 || x >= WIDTH || y >= HEIGHT) return;
  const index = (y * WIDTH + x) * 3;
  pixels[index] = color[0]; pixels[index + 1] = color[1]; pixels[index + 2] = color[2];
}
function drawText(pixels, text, startX, startY, scale, color) {
  let x = startX;
  for (const character of text) {
    const glyph = FONT[character];
    if (!glyph) throw new Error(`missing fixture glyph ${character}`);
    for (let row = 0; row < glyph.length; row += 1) {
      for (let col = 0; col < glyph[row].length; col += 1) {
        if (glyph[row][col] === '1') {
          for (let dy = 0; dy < scale; dy += 1) for (let dx = 0; dx < scale; dx += 1) putPixel(pixels, x + col * scale + dx, startY + row * scale + dy, color);
        }
      }
    }
    x += 6 * scale;
  }
}
function makePng() {
  const pixels = Buffer.alloc(WIDTH * HEIGHT * 3);
  for (let y = 0; y < HEIGHT; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) {
      const noise = ((x * 31 + y * 17 + SEED) % 29);
      const grid = x % 32 === 0 || y % 32 === 0;
      putPixel(pixels, x, y, grid ? [226, 190, 92] : [18 + noise, 38 + noise, 54 + noise]);
    }
  }
  for (let x = 0; x < WIDTH; x += 1) { putPixel(pixels, x, 0, [255,255,255]); putPixel(pixels, x, HEIGHT - 1, [255,255,255]); }
  for (let y = 0; y < HEIGHT; y += 1) { putPixel(pixels, 0, y, [255,255,255]); putPixel(pixels, WIDTH - 1, y, [255,255,255]); }
  drawText(pixels, LABEL, 24, 78, 3, [255, 245, 190]);
  const scanlines = Buffer.alloc((WIDTH * 3 + 1) * HEIGHT);
  for (let y = 0; y < HEIGHT; y += 1) { scanlines[y * (WIDTH * 3 + 1)] = 0; pixels.copy(scanlines, y * (WIDTH * 3 + 1) + 1, y * WIDTH * 3, (y + 1) * WIDTH * 3); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(WIDTH, 0); ihdr.writeUInt32BE(HEIGHT, 4); ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from('\x89PNG\r\n\x1a\n', 'binary'), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(scanlines, { level: 9, strategy: 3 })), chunk('IEND', Buffer.alloc(0))]);
}
function validatePng(png) {
  if (png.subarray(0, 8).toString('binary') !== '\x89PNG\r\n\x1a\n') throw new Error('fixture is not a PNG');
  if (png.readUInt32BE(16) !== WIDTH || png.readUInt32BE(20) !== HEIGHT) throw new Error('fixture dimensions changed');
  let offset = 8; let idat = Buffer.alloc(0); let foundEnd = false;
  while (offset < png.length) {
    const length = png.readUInt32BE(offset); const type = png.subarray(offset + 4, offset + 8).toString('ascii'); const data = png.subarray(offset + 8, offset + 8 + length); const crc = png.readUInt32BE(offset + 8 + length);
    if (crc32(Buffer.concat([Buffer.from(type), data])) !== crc) throw new Error(`invalid PNG CRC in ${type}`);
    if (type === 'IDAT') idat = Buffer.concat([idat, data]);
    if (type === 'IEND') { foundEnd = true; break; }
    offset += 12 + length;
  }
  if (!foundEnd || inflateSync(idat).length !== (WIDTH * 3 + 1) * HEIGHT) throw new Error('invalid PNG payload');
}
async function render() {
  const script = await readFile(SCRIPT_PATH);
  const png = makePng(); validatePng(png);
  const provenance = {
    schema_version: 1,
    artifact: LABEL,
    owner: 'terrCVM repository; fully self-generated procedural test data',
    license: 'self-generated; no third-party imagery or asset code',
    generator: { path: 'scripts/generate-ortho-fixture.mjs', sha256: sha256(script) },
    output: { path: 'apps/napplet/tests/fixtures/ortho-fixture.png', sha256: sha256(png), width: WIDTH, height: HEIGHT },
    generation: { date: GENERATION_DATE, seed: SEED, parameters: { grid_spacing_px: 32, label: LABEL, color_mode: 'RGB8', compression: 'zlib-fixed' } },
    purpose: 'Deterministic bundled test fixture for unit/sandbox tests only.',
    never_acceptance: 'This artifact is NEVER acceptable as MAP-05/MAP-06 live-source or imagery-correspondence evidence and is NEVER presented as live orthophoto imagery.',
    binding_ui_rule: 'Any fixture rendering must carry the exact TEST FIXTURE label and fixture copy.',
  };
  return { png, provenance: Buffer.from(`${JSON.stringify(provenance, null, 2)}\n`) };
}
async function atomic(path, data) { const tmp = `${path}.tmp-${process.pid}`; await writeFile(tmp, data); await rename(tmp, path); }
const verify = process.argv.includes('--verify-deterministic');
const { png, provenance } = await render();
if (verify) {
  const [existingPng, existingProvenance] = await Promise.all([readFile(PNG_PATH), readFile(PROVENANCE_PATH)]);
  if (!existingPng.equals(png) || !existingProvenance.equals(provenance)) throw new Error('fixture is not byte-deterministic');
  console.log(`fixture deterministic: PASS (${WIDTH}x${HEIGHT}, ${sha256(png)})`);
} else {
  await atomic(PNG_PATH, png); await atomic(PROVENANCE_PATH, provenance);
  console.log(`fixture generated: PASS (${WIDTH}x${HEIGHT}, ${sha256(png)})`);
}
