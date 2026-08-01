export type BBox4326 = readonly [
  west: number,
  south: number,
  east: number,
  north: number,
];

export type BBoxErrorCode =
  | 'MALFORMED'
  | 'NON_FINITE'
  | 'RANGE'
  | 'ORDER'
  | 'ANTIMERIDIAN_AMBIGUOUS'
  | 'AREA_LIMIT';

export type BBoxResult =
  | { ok: true; bbox: BBox4326; areaKm2: number }
  | { ok: false; code: BBoxErrorCode };

type ValidateBBoxOptions = {
  maxAreaKm2: number;
  areaKm2: (bbox: BBox4326) => number;
};

export function validateBBoxStructure(
  input: unknown,
  opts: ValidateBBoxOptions,
): BBoxResult {
  if (
    !Array.isArray(input) ||
    input.length !== 4 ||
    !input.every((coordinate: unknown) => typeof coordinate === 'number')
  ) {
    return { ok: false, code: 'MALFORMED' };
  }

  const [west, south, east, north] = input as [number, number, number, number];

  if (![west, south, east, north].every(Number.isFinite)) {
    return { ok: false, code: 'NON_FINITE' };
  }

  if (
    west < -180 ||
    west > 180 ||
    east < -180 ||
    east > 180 ||
    south < -90 ||
    south > 90 ||
    north < -90 ||
    north > 90
  ) {
    return { ok: false, code: 'RANGE' };
  }

  if (west > east) {
    return { ok: false, code: 'ANTIMERIDIAN_AMBIGUOUS' };
  }

  if (west === east) {
    return { ok: false, code: 'ORDER' };
  }

  if (south >= north) {
    return { ok: false, code: 'ORDER' };
  }

  const bbox: BBox4326 = [west, south, east, north];
  const areaKm2 = opts.areaKm2(bbox);

  if (areaKm2 > opts.maxAreaKm2) {
    return { ok: false, code: 'AREA_LIMIT' };
  }

  return { ok: true, bbox, areaKm2 };
}
