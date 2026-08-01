/**
 * One error type, and a closed set of codes.
 *
 * CONTRACT.md §14: the CODE is normative, the message is free. A code is what
 * the conformance suite compares and what the Python side must emit for the
 * same input — a bare `TypeError('dataset must not contain whitespace')` is
 * untestable across languages, because no two implementations will ever write
 * the same sentence.
 */

/** Every rejection this package can produce. CONTRACT.md §14. */
export type GeoErrorCode =
  | 'NUMBER_NOT_FINITE'
  | 'PROPERTY_NUMBER_RANGE'
  | 'PROPERTY_KEY_GRAMMAR'
  | 'STRING_NOT_SCALAR'
  | 'DATASET_GRAMMAR'
  | 'TEXT_EMPTY'
  | 'MIME_GRAMMAR'
  | 'URL_GRAMMAR'
  | 'HEX64'
  | 'SIZE_RANGE'
  | 'CREATED_AT_RANGE'
  | 'TILE_ZOOM_RANGE'
  | 'TILE_XY_RANGE'
  | 'TILE_NOT_INTEGER'
  | 'DATETIME_REQUIRED'
  | 'DATETIME_GRAMMAR'
  | 'DATETIME_CALENDAR'
  | 'BBOX_NOT_FINITE'
  | 'BBOX_ANTIMERIDIAN'
  | 'BBOX_INVERTED'
  | 'BBOX_OUT_OF_RANGE'
  | 'BBOX_DEGENERATE'
  | 'GEOHASH_PRECISION_RANGE'
  | 'LATLON_RANGE'
  | 'FILTER_LIMIT_RANGE';

/** A protocol rejection, carrying the normative code. */
export class GeoProtocolError extends Error {
  readonly code: GeoErrorCode;

  constructor(code: GeoErrorCode, message: string) {
    super(`${code}: ${message}`);
    this.name = 'GeoProtocolError';
    this.code = code;
  }
}

/** Throw a coded rejection. */
export function reject(code: GeoErrorCode, message: string): never {
  throw new GeoProtocolError(code, message);
}

/** Narrow an unknown caught value to a protocol rejection. */
export function isGeoProtocolError(value: unknown): value is GeoProtocolError {
  return value instanceof GeoProtocolError;
}
