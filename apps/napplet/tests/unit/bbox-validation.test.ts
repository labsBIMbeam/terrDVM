import { describe, expect, it } from 'vitest';

import {
  validateBBoxStructure,
  type BBox4326,
  type BBoxErrorCode,
} from '../../src/bbox/validate';

const validBBox: BBox4326 = [13, 47, 13.1, 47.1];

function validate(
  input: unknown,
  areaKm2: (bbox: BBox4326) => number = () => 1,
  maxAreaKm2 = 100,
) {
  return validateBBoxStructure(input, { areaKm2, maxAreaKm2 });
}

function expectCode(input: unknown, code: BBoxErrorCode): void {
  expect(validate(input)).toEqual({ ok: false, code });
}

describe('bbox structure validation', () => {
  it('bbox_rejects_non_array_or_wrong_arity', () => {
    for (const input of [
      null,
      '13,47,13.1,47.1',
      [13, 47, 13.1],
      [13, 47, 13.1, 47.1, 48],
      { west: 13, south: 47, east: 13.1, north: 47.1 },
      [13, 47, '13.1', 47.1],
    ]) {
      expectCode(input, 'MALFORMED');
    }
  });

  it('bbox_rejects_non_finite_each_position', () => {
    for (const nonFinite of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      for (let position = 0; position < 4; position += 1) {
        const input = [...validBBox];
        input[position] = nonFinite;
        expectCode(input, 'NON_FINITE');
      }
    }
  });

  it('bbox_rejects_longitude_out_of_range', () => {
    for (const [position, value] of [
      [0, -180.01],
      [0, 180.01],
      [2, -180.01],
      [2, 180.01],
    ] as const) {
      const input = [...validBBox];
      input[position] = value;
      expectCode(input, 'RANGE');
    }
  });

  it('bbox_rejects_latitude_out_of_range', () => {
    for (const [position, value] of [
      [1, -90.01],
      [1, 90.01],
      [3, -90.01],
      [3, 90.01],
    ] as const) {
      const input = [...validBBox];
      input[position] = value;
      expectCode(input, 'RANGE');
    }
  });

  it('bbox_rejects_west_greater_or_equal_east', () => {
    expectCode([10, 0, 10, 1], 'ORDER');
  });

  it('bbox_rejects_south_greater_or_equal_north', () => {
    expectCode([0, 10, 1, 5], 'ORDER');
    expectCode([0, 10, 1, 10], 'ORDER');
  });

  it('bbox_rejects_antimeridian_crossing_or_ambiguity', () => {
    expectCode([170, 0, -170, 1], 'ANTIMERIDIAN_AMBIGUOUS');
    expectCode([170, 5, -170, 5], 'ANTIMERIDIAN_AMBIGUOUS');
  });

  it('bbox_rejects_zero_area', () => {
    expectCode([10, 0, 10, 1], 'ORDER');
    expectCode([0, 5, 1, 5], 'ORDER');
  });

  it('bbox_rejects_configured_area_limit', () => {
    expect(validate(validBBox, () => 100.01, 100)).toEqual({
      ok: false,
      code: 'AREA_LIMIT',
    });
    expect(validate(validBBox, () => 100, 100)).toEqual({
      ok: true,
      bbox: validBBox,
      areaKm2: 100,
    });
  });

  it('bbox_accepts_valid_box', () => {
    expect(validate([13, 47, 13.1, 47.1], () => 12.5)).toEqual({
      ok: true,
      bbox: [13, 47, 13.1, 47.1],
      areaKm2: 12.5,
    });
  });
});
