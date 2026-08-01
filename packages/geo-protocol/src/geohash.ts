/**
 * The geohash encoder and the covering set. CONTRACT.md §11.
 */

import { GEOHASH_ALPHABET, GEOHASH_PRECISION, SOCIAL_GEOHASH_PRECISIONS } from './kinds';
import { reject } from './errors';
import { assertViewport, type BBox4326 } from './bbox';

/**
 * Standard base-32 geohash encoder, longitude bit first.
 *
 * Geohash cells are HALF-OPEN, `[min, max)`, so a coordinate sitting exactly
 * on a cell boundary belongs to the cell ABOVE it — hence `>=` and not `>`.
 * The distinction is not academic here: p4 longitude boundaries land exactly
 * on z14 tile boundaries every 16 tiles (both grids are power-of-two
 * subdivisions of [-180, 180] anchored at -180), so an encoder that used `>`
 * would disagree on 1 tile in 16, systematically and reproducibly.
 *
 * Canonical vector: `encode(57.64911, 10.40744, 11) === 'u4pruydqqvj'`.
 */
export function encode(lat: number, lon: number, precision = GEOHASH_PRECISION): string {
  assertPrecision(precision);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    reject('LATLON_RANGE', 'geohash lat/lon must be finite');
  }
  if (lat < -90 || lat > 90) reject('LATLON_RANGE', `geohash lat out of range: ${lat}`);
  if (lon < -180 || lon > 180) reject('LATLON_RANGE', `geohash lon out of range: ${lon}`);

  let latMin = -90;
  let latMax = 90;
  let lonMin = -180;
  let lonMax = 180;
  let hash = '';
  let bit = 0;
  let value = 0;
  let evenBit = true;

  while (hash.length < precision) {
    if (evenBit) {
      const mid = (lonMin + lonMax) / 2;
      if (lon >= mid) {
        value = value * 2 + 1;
        lonMin = mid;
      } else {
        value *= 2;
        lonMax = mid;
      }
    } else {
      const mid = (latMin + latMax) / 2;
      if (lat >= mid) {
        value = value * 2 + 1;
        latMin = mid;
      } else {
        value *= 2;
        latMax = mid;
      }
    }
    evenBit = !evenBit;
    bit += 1;
    if (bit === 5) {
      hash += GEOHASH_ALPHABET[value];
      bit = 0;
      value = 0;
    }
  }

  return hash;
}

/**
 * Every prefix of the precision-6 geohash of a point, shortest first — the
 * SOCIAL ladder of CONTRACT.md §13.
 *
 * This is the OPPOSITE rule to the dataset layer's single p4 tag, and it is
 * not an inconsistency. Nostr tag filters are EXACT STRING MATCHES, so a
 * client querying precision 5 can never match a lone precision-4 tag, and a
 * continental viewport at p4 needs 43,617 cells. Version 1 collapsed every
 * event to one p4 tag and that silently killed live presence and the geo-note
 * feed: `apps/napplet/src/nostr/presence.ts` queries p5 and p2/p3/p4 by
 * viewport span, and a cap of 48 cells over a Europe-wide view is 0.1%
 * coverage with no error anywhere.
 *
 * The dataset layer gets one tag because a survey-zoom viewport is a handful
 * of cells; the social layer gets the ladder because its queries span
 * continents.
 */
export function socialGeohashTags(lat: number, lon: number): string[][] {
  const deepest = encode(lat, lon, Math.max(...SOCIAL_GEOHASH_PRECISIONS));
  return SOCIAL_GEOHASH_PRECISIONS.map((precision) => ['g', deepest.slice(0, precision)]);
}

/**
 * Grid dimensions of a geohash precision.
 *
 * Bits alternate starting with LONGITUDE, so an even precision splits them
 * evenly (p4 = 10 lon + 10 lat) while an odd one does not (p3 = 8 lon + 7 lat,
 * which is why p3 cells are square in degrees and p4 cells are 2:1 wide).
 */
export function gridSize(precision: number): { lonCells: number; latCells: number } {
  assertPrecision(precision);
  const bits = precision * 5;
  return { lonCells: 2 ** Math.ceil(bits / 2), latCells: 2 ** Math.floor(bits / 2) };
}

/**
 * Geohash for a cell index pair, by pure bit interleaving — no float, no
 * sampled point. `ix` counts longitude cells east from -180, `iy` counts
 * latitude cells north from -90.
 */
export function cellToGeohash(ix: number, iy: number, precision = GEOHASH_PRECISION): string {
  const { lonCells, latCells } = gridSize(precision);
  if (!Number.isInteger(ix) || ix < 0 || ix >= lonCells) {
    reject('LATLON_RANGE', `geohash lon cell index out of range: ${ix}`);
  }
  if (!Number.isInteger(iy) || iy < 0 || iy >= latCells) {
    reject('LATLON_RANGE', `geohash lat cell index out of range: ${iy}`);
  }

  const bits = precision * 5;
  const lonBits = Math.ceil(bits / 2);
  const latBits = Math.floor(bits / 2);

  let hash = '';
  let acc = 0;
  let held = 0;
  let lonTaken = 0;
  let latTaken = 0;

  for (let index = 0; index < bits; index += 1) {
    const bit =
      index % 2 === 0
        ? (ix >> (lonBits - 1 - lonTaken++)) & 1
        : (iy >> (latBits - 1 - latTaken++)) & 1;
    acc = acc * 2 + bit;
    held += 1;
    if (held === 5) {
      hash += GEOHASH_ALPHABET[acc];
      acc = 0;
      held = 0;
    }
  }

  return hash;
}

/**
 * Every geohash cell that intersects a bbox — a COMPLETE cover, not a sample.
 *
 * The geohash grid at a fixed precision is a perfectly regular lon/lat lattice
 * (1024 x 1024 at p4), so covering is integer index arithmetic: floor the bbox
 * edges into indices and enumerate the closed range. Interior cells are
 * included by construction.
 *
 * That is the whole point of the function. Corner sampling — the shape this
 * replaces — misses ~92% of the cells a multi-degree viewport needs, because
 * every interior column is invisible to it, with no error anywhere. The vector
 * `geohash.cover/wider-than-one-cell` is 30 cells that corner sampling would
 * have reported as 4.
 *
 * ORDER IS NORMATIVE: longitude outer (west to east), latitude inner (south to
 * north). The filter built from it is compared as a whole.
 */
export function coverCells(bbox: BBox4326, precision = GEOHASH_PRECISION): string[] {
  const { ix0, ix1, iy0, iy1 } = cellRange(bbox, precision);
  const cells: string[] = [];
  for (let ix = ix0; ix <= ix1; ix += 1) {
    for (let iy = iy0; iy <= iy1; iy += 1) {
      cells.push(cellToGeohash(ix, iy, precision));
    }
  }
  return cells;
}

/**
 * How many cells `coverCells` would return, without building them.
 *
 * Cheap enough to call on every viewport change, which is what the query gate
 * in `filters.ts` does: a Europe-wide view needs 43,617 p4 cells and the whole
 * world 1,048,576, neither of which any relay will accept in one filter.
 */
export function coverCellCount(bbox: BBox4326, precision = GEOHASH_PRECISION): number {
  const { ix0, ix1, iy0, iy1 } = cellRange(bbox, precision);
  return (ix1 - ix0 + 1) * (iy1 - iy0 + 1);
}

function assertPrecision(precision: number): void {
  if (!Number.isInteger(precision) || precision < 1 || precision > 12) {
    reject(
      'GEOHASH_PRECISION_RANGE',
      `geohash precision must be an integer in 1..12, got ${String(precision)}`,
    );
  }
}

/**
 * Closed index range of the cells intersecting a bbox.
 *
 * Clamping is to the GEOHASH domain (+-180 / +-90) and NOT to the Mercator
 * cut-off: presence and geo-notes exist above 85.05 deg even though tiles do
 * not, and the extra rows simply return empty. The only clamp left is the
 * exact upper boundary — `lon = 180` and `lat = 90` floor to one index past
 * the last cell, and half-open cells have nothing above them to go to.
 */
function cellRange(
  bbox: BBox4326,
  precision: number,
): { ix0: number; ix1: number; iy0: number; iy1: number } {
  const { lonCells, latCells } = gridSize(precision);
  assertViewport(bbox);

  const [west, south, east, north] = bbox;
  const lonWidth = 360 / lonCells;
  const latHeight = 180 / latCells;

  return {
    ix0: Math.min(Math.floor((west + 180) / lonWidth), lonCells - 1),
    ix1: Math.min(Math.floor((east + 180) / lonWidth), lonCells - 1),
    iy0: Math.min(Math.floor((south + 90) / latHeight), latCells - 1),
    iy1: Math.min(Math.floor((north + 90) / latHeight), latCells - 1),
  };
}
