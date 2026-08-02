import { tileXToLon, tileYToLat } from '../terrain/dem';
import {
  LANDUSE_CLASSES,
  ROAD_CLASSES,
  landuseClassIndex,
  roadClassIndex,
  type FeatureTile,
} from './types';

/**
 * Binary feature-tile codec.
 *
 * Designed for content-addressed storage: a tile's bytes depend only on its
 * contents, so the same tile encoded twice yields the same SHA-256 and
 * deduplicates on Blossom. That is what makes continent-scale coverage
 * composable — Europe is just the union of independently addressable tiles.
 *
 * Three things do the compression work:
 *   1. Coordinates are quantised to a tile-local integer grid, so absolute
 *      precision costs nothing and the numbers stay small.
 *   2. Points are delta-encoded against the previous point.
 *   3. Deltas are zigzag varints, so short edges cost one byte per axis.
 */

export const TFT_MAGIC = 0x54465432; // 'TFT2' — adds the landuse layer
export const TFT_HEADER_BYTES = 15;

/** Quantisation grid per axis. 4096 is sub-metre at z14 and fits 12 bits. */
export const TILE_EXTENT = 4096;

class ByteWriter {
  private buffer = new Uint8Array(1024);
  private length = 0;

  private ensure(extra: number): void {
    if (this.length + extra <= this.buffer.length) return;
    let size = this.buffer.length * 2;
    while (size < this.length + extra) size *= 2;
    const grown = new Uint8Array(size);
    grown.set(this.buffer.subarray(0, this.length));
    this.buffer = grown;
  }

  byte(value: number): void {
    this.ensure(1);
    this.buffer[this.length++] = value & 0xff;
  }

  uint16(value: number): void {
    this.ensure(2);
    this.buffer[this.length++] = value & 0xff;
    this.buffer[this.length++] = (value >>> 8) & 0xff;
  }

  uint32(value: number): void {
    this.ensure(4);
    for (let shift = 0; shift < 32; shift += 8) {
      this.buffer[this.length++] = (value >>> shift) & 0xff;
    }
  }

  varint(value: number): void {
    let remaining = value >>> 0;
    this.ensure(5);
    while (remaining >= 0x80) {
      this.buffer[this.length++] = (remaining & 0x7f) | 0x80;
      remaining >>>= 7;
    }
    this.buffer[this.length++] = remaining;
  }

  zigzag(value: number): void {
    this.varint((value << 1) ^ (value >> 31));
  }

  finish(): Uint8Array {
    return this.buffer.slice(0, this.length);
  }
}

class ByteReader {
  private offset = 0;

  constructor(private readonly data: Uint8Array) {}

  get exhausted(): boolean {
    return this.offset >= this.data.length;
  }

  byte(): number {
    if (this.offset >= this.data.length) throw new RangeError('feature tile truncated');
    return this.data[this.offset++];
  }

  uint16(): number {
    return this.byte() | (this.byte() << 8);
  }

  uint32(): number {
    return (this.byte() | (this.byte() << 8) | (this.byte() << 16) | (this.byte() << 24)) >>> 0;
  }

  varint(): number {
    let result = 0;
    let shift = 0;
    for (;;) {
      const current = this.byte();
      result |= (current & 0x7f) << shift;
      if ((current & 0x80) === 0) return result >>> 0;
      shift += 7;
      if (shift > 35) throw new RangeError('varint overflow in feature tile');
    }
  }

  zigzag(): number {
    const raw = this.varint();
    return (raw >>> 1) ^ -(raw & 1);
  }
}

/** Tile bounds in degrees. */
function tileBounds(z: number, x: number, y: number) {
  return {
    west: tileXToLon(x, z),
    east: tileXToLon(x + 1, z),
    north: tileYToLat(y, z),
    south: tileYToLat(y + 1, z),
  };
}

function quantiser(z: number, x: number, y: number) {
  const { west, east, north, south } = tileBounds(z, x, y);
  const spanLon = east - west;
  const spanLat = north - south;
  return (lon: number, lat: number): [number, number] => [
    Math.max(0, Math.min(TILE_EXTENT, Math.round(((lon - west) / spanLon) * TILE_EXTENT))),
    Math.max(0, Math.min(TILE_EXTENT, Math.round(((north - lat) / spanLat) * TILE_EXTENT))),
  ];
}

function dequantiser(z: number, x: number, y: number) {
  const { west, east, north, south } = tileBounds(z, x, y);
  const spanLon = east - west;
  const spanLat = north - south;
  return (qx: number, qy: number): [number, number] => [
    west + (qx / TILE_EXTENT) * spanLon,
    north - (qy / TILE_EXTENT) * spanLat,
  ];
}

export function encodeFeatureTile(tile: FeatureTile): Uint8Array {
  const writer = new ByteWriter();
  writer.uint32(TFT_MAGIC);
  writer.byte(tile.z);
  writer.uint32(tile.x);
  writer.uint32(tile.y);
  writer.uint16(TILE_EXTENT);

  const quantise = quantiser(tile.z, tile.x, tile.y);

  writer.varint(tile.buildings.length);
  for (const building of tile.buildings) {
    writer.varint(building.ring.length);
    let previousX = 0;
    let previousY = 0;
    for (const [lon, lat] of building.ring) {
      const [qx, qy] = quantise(lon, lat);
      writer.zigzag(qx - previousX);
      writer.zigzag(qy - previousY);
      previousX = qx;
      previousY = qy;
    }
    // Decimetres: 0.1 m is finer than any surveyed building height.
    writer.varint(Math.max(0, Math.round(building.heightM * 10)));
  }

  writer.varint(tile.roads.length);
  for (const road of tile.roads) {
    writer.varint(road.line.length);
    writer.byte(roadClassIndex(road.roadClass));
    let previousX = 0;
    let previousY = 0;
    for (const [lon, lat] of road.line) {
      const [qx, qy] = quantise(lon, lat);
      writer.zigzag(qx - previousX);
      writer.zigzag(qy - previousY);
      previousX = qx;
      previousY = qy;
    }
  }

  writer.varint(tile.landuse.length);
  for (const area of tile.landuse) {
    writer.varint(area.ring.length);
    writer.byte(landuseClassIndex(area.landuseClass));
    let previousX = 0;
    let previousY = 0;
    for (const [lon, lat] of area.ring) {
      const [qx, qy] = quantise(lon, lat);
      writer.zigzag(qx - previousX);
      writer.zigzag(qy - previousY);
      previousX = qx;
      previousY = qy;
    }
  }

  return writer.finish();
}

export function decodeFeatureTile(bytes: Uint8Array): FeatureTile {
  const reader = new ByteReader(bytes);
  if (reader.uint32() !== TFT_MAGIC) {
    throw new Error('not a terrCVM feature tile');
  }
  const z = reader.byte();
  const x = reader.uint32();
  const y = reader.uint32();
  const extent = reader.uint16();
  if (extent !== TILE_EXTENT) {
    throw new Error(`unsupported feature-tile extent ${extent}`);
  }

  const dequantise = dequantiser(z, x, y);
  const tile: FeatureTile = { z, x, y, buildings: [], roads: [], landuse: [] };

  const buildingCount = reader.varint();
  for (let i = 0; i < buildingCount; i += 1) {
    const pointCount = reader.varint();
    const ring: [number, number][] = [];
    let qx = 0;
    let qy = 0;
    for (let p = 0; p < pointCount; p += 1) {
      qx += reader.zigzag();
      qy += reader.zigzag();
      ring.push(dequantise(qx, qy));
    }
    tile.buildings.push({ ring, heightM: reader.varint() / 10 });
  }

  const roadCount = reader.varint();
  for (let i = 0; i < roadCount; i += 1) {
    const pointCount = reader.varint();
    const classIndex = reader.byte();
    const line: [number, number][] = [];
    let qx = 0;
    let qy = 0;
    for (let p = 0; p < pointCount; p += 1) {
      qx += reader.zigzag();
      qy += reader.zigzag();
      line.push(dequantise(qx, qy));
    }
    tile.roads.push({
      line,
      roadClass: ROAD_CLASSES[classIndex] ?? 'residential',
    });
  }

  const landuseCount = reader.varint();
  for (let i = 0; i < landuseCount; i += 1) {
    const pointCount = reader.varint();
    const classIndex = reader.byte();
    const ring: [number, number][] = [];
    let qx = 0;
    let qy = 0;
    for (let p = 0; p < pointCount; p += 1) {
      qx += reader.zigzag();
      qy += reader.zigzag();
      ring.push(dequantise(qx, qy));
    }
    tile.landuse.push({
      ring,
      landuseClass: LANDUSE_CLASSES[classIndex] ?? 'grass',
    });
  }

  return tile;
}
