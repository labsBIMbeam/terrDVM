import { MAX_TILE_ZOOM } from './kinds';
import { reject } from './errors';
import type { BBox4326 } from './bbox';

/** A slippy-map tile address (XYZ / Web Mercator, EPSG:3857). */
export type Tile = { z: number; x: number; y: number };

/**
 * Throws unless `tile` is a real slippy address at a zoom we publish.
 *
 * INTEGRALITY IS A TEST ON THE VALUE, NOT ON THE TYPE. `{z: 14.0, x: 8593.0,
 * y: 5677.0}` must produce the same event as `{z: 14, x: 8593, y: 5677}`:
 * JavaScript cannot tell the two apart at all, so any rule that rejects the
 * float form is unimplementable here. Python must coerce to `int` before
 * formatting — naive f-string interpolation writes
 * `"terrain:14.0/8593.0/5677.0"`, which is a different `d`, a different
 * address and a different event. The reference generator for the contract made
 * exactly that mistake and the vector caught it.
 */
export function assertTile(tile: Tile): void {
  const { z, x, y } = tile;
  if (!Number.isInteger(z) || z < 0 || z > MAX_TILE_ZOOM) {
    reject(
      'TILE_ZOOM_RANGE',
      `tile zoom must be an integer in 0..${MAX_TILE_ZOOM}, got ${String(z)}`,
    );
  }
  const span = 2 ** z;
  if (!Number.isInteger(x) || x < 0 || x >= span) {
    reject('TILE_XY_RANGE', `tile x must be an integer in 0..${span - 1} at z${z}, got ${String(x)}`);
  }
  if (!Number.isInteger(y) || y < 0 || y >= span) {
    reject('TILE_XY_RANGE', `tile y must be an integer in 0..${span - 1} at z${z}, got ${String(y)}`);
  }
}

function tileXToLon(x: number, z: number): number {
  return (x / 2 ** z) * 360 - 180;
}

function tileYToLat(y: number, z: number): number {
  const n = Math.PI * (1 - (2 * y) / 2 ** z);
  return (Math.atan(Math.sinh(n)) * 180) / Math.PI;
}

/**
 * Exact geographic bounds of a tile, `[west, south, east, north]`.
 *
 * This is the ONLY source of an item's bbox. CONTRACT.md §7.2 removed the
 * `bbox` parameter from `build_item` entirely: Python used to take a
 * caller-supplied bbox while TypeScript derived it here, so Python could
 * publish an item whose `content.bbox` contradicted its own `d` and `g` tags
 * with no error. The test that was meant to catch that was circular — it read
 * the expected bbox out of the fixture and passed it straight back into the
 * builder, asserting the fixture equalled itself.
 */
export function tileBBox(tile: Tile): BBox4326 {
  assertTile(tile);
  const { z, x, y } = tile;
  return [tileXToLon(x, z), tileYToLat(y + 1, z), tileXToLon(x + 1, z), tileYToLat(y, z)];
}

/**
 * Centre of a tile — the ONLY point that may ever be geohashed for an item's
 * `g` tag.
 *
 * A tile's west edge lands exactly on a p4 geohash boundary every 16 tiles
 * (both grids are power-of-two subdivisions of [-180, 180] anchored at -180),
 * so encoding a corner or an edge would sit on the encoder's half-open
 * boundary for 1 tile in 16, systematically and reproducibly. A centre never
 * can: `x + 0.5` is never a multiple of 16, and the latitude centre is a
 * transcendental function of the row index.
 */
export function tileCenter(tile: Tile): { lat: number; lon: number } {
  assertTile(tile);
  const { z, x, y } = tile;
  return { lat: tileYToLat(y + 0.5, z), lon: tileXToLon(x + 0.5, z) };
}
