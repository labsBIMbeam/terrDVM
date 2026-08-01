/**
 * Bounding boxes, and the ruling that the degenerate case splits by ROLE.
 *
 * `west == east` was accepted by TypeScript's `buildCollection` and rejected by
 * Python's `BBox` dataclass. Neither blanket answer is right, because the two
 * uses are different — see CONTRACT.md §10.1:
 *
 *   - a COLLECTION EXTENT with zero width holds no tiles and cannot be
 *     covered; it is an input bug every time;
 *   - a VIEWPORT with zero width is a legitimate POINT QUERY and must return
 *     the single cell containing the point.
 *
 * The consequence is that the covering functions take a plain
 * `(west, south, east, north)` tuple rather than a dataclass whose constructor
 * forbids degenerate boxes. Coupling the protocol layer to that dataclass is
 * exactly what made the point query inexpressible in Python.
 */

import { reject } from './errors';
import { quantizeCoordinate } from './number';

/** `[west, south, east, north]` in EPSG:4326, matching the engine's tuple. */
export type BBox4326 = readonly [west: number, south: number, east: number, north: number];

/**
 * The checks both roles share.
 *
 * `west > east` is REJECTED everywhere and never wrapped: a silent wrap
 * enumerates the entire globe MINUS the viewport. The caller splits
 * `[170,-10,-170,10]` into `[170,-10,180,10]` and `[-180,-10,-170,10]`; the
 * two halves share no cell, so their union is an exact cover of the seam.
 *
 * Out-of-range coordinates are REJECTED, not clamped. Version 1 clamped them
 * into the grid, which turns a caller bug into a plausible-looking wrong
 * answer. Clamping survives only INSIDE the range check, for the exact
 * boundary `lon = 180` / `lat = 90`, which must land in the last cell because
 * half-open cells have nothing above them — see `cellRange` in `geohash.ts`.
 */
function assertBBoxShape(bbox: BBox4326, label: string): void {
  const [west, south, east, north] = bbox;

  // ORDER IS NORMATIVE (CONTRACT.md §14.1): each coordinate's own domain is
  // checked before any relation BETWEEN coordinates. A value outside
  // [-180,180] is not a longitude at all, so `west > east` says nothing about
  // it. `[200,0,100,10]` is therefore BBOX_OUT_OF_RANGE and never
  // BBOX_ANTIMERIDIAN — this side used to answer the latter and Python the
  // former, and §14 makes the code normative, so that was a contract
  // violation rather than a cosmetic difference.
  if (![west, south, east, north].every((value) => Number.isFinite(value))) {
    reject('BBOX_NOT_FINITE', `${label} coordinates must be finite`);
  }
  if (west < -180 || west > 180 || east < -180 || east > 180) {
    reject('BBOX_OUT_OF_RANGE', `${label} longitude is outside [-180,180]`);
  }
  if (south < -90 || south > 90 || north < -90 || north > 90) {
    reject('BBOX_OUT_OF_RANGE', `${label} latitude is outside [-90,90]`);
  }
  if (west > east) {
    reject('BBOX_ANTIMERIDIAN', `${label} crosses the antimeridian — split it first`);
  }
  if (south > north) {
    reject('BBOX_INVERTED', `${label} south is north of its north`);
  }
}

/**
 * A viewport or covering box: `west <= east` and `south <= north`. Degenerate
 * is legal and means a point query.
 */
export function assertViewport(bbox: BBox4326): void {
  assertBBoxShape(bbox, 'viewport');
}

/**
 * A collection extent: strictly `west < east` and `south < north`, checked
 * AFTER quantisation to `COORDINATE_DECIMALS`.
 *
 * Checking after quantisation is what guarantees the emitted tag is itself
 * valid on read-back: an extent narrower than 11 cm collapses to a point under
 * the 1e-6 grid and is refused, rather than published as
 * `["bbox","0","0","0","0"]` and silently covering nothing.
 */
export function assertExtent(bbox: BBox4326): void {
  assertBBoxShape(bbox, 'bbox');

  const west = quantizeCoordinate(bbox[0]);
  const south = quantizeCoordinate(bbox[1]);
  const east = quantizeCoordinate(bbox[2]);
  const north = quantizeCoordinate(bbox[3]);
  if (west >= east || south >= north) {
    reject(
      'BBOX_DEGENERATE',
      'a collection extent must have positive width and height after quantisation to 1e-6 deg',
    );
  }
}
