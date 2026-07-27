import { describe, expect, it } from 'vitest';

import {
  geodesicAreaKm2,
  validateBBox,
} from '../../src/bbox/area';

const EQUATOR_ORACLE_KM2 = 12308;
const EQUATOR_ORACLE_MIN_KM2 = 12246.5;
const EQUATOR_ORACLE_MAX_KM2 = 12369.5;
const HIGH_LATITUDE_ORACLE_RATIO = Math.cos((60.5 * Math.PI) / 180);

const AUDITED_OVER_LIMIT_AREA_KM2 = 100.15116034642301;
const AUDITED_UNDER_LIMIT_AREA_KM2 = 99.70653883387968;

describe('geodesic bbox area', () => {
  it('bbox_area_is_geodesic_at_equator', () => {
    const areaKm2 = geodesicAreaKm2([0, 0, 1, 1]);

    expect(EQUATOR_ORACLE_KM2).toBe(12308);
    expect(areaKm2).toBeGreaterThanOrEqual(EQUATOR_ORACLE_MIN_KM2);
    expect(areaKm2).toBeLessThanOrEqual(EQUATOR_ORACLE_MAX_KM2);
  });

  it('bbox_area_is_geodesic_at_high_latitude', () => {
    const equatorAreaKm2 = geodesicAreaKm2([0, 0, 1, 1]);
    const highLatitudeAreaKm2 = geodesicAreaKm2([0, 60, 1, 61]);
    const observedRatio = highLatitudeAreaKm2 / equatorAreaKm2;

    expect(observedRatio).toBeCloseTo(HIGH_LATITUDE_ORACLE_RATIO, 2);
    expect(observedRatio).toBeLessThan(0.51);
  });

  it('bbox_rejects_configured_area_limit_with_real_wrapper', () => {
    expect(geodesicAreaKm2([0, 0, 0.09, 0.09])).toBeCloseTo(
      AUDITED_OVER_LIMIT_AREA_KM2,
      10,
    );
    expect(validateBBox([0, 0, 0.09, 0.09])).toEqual({
      ok: false,
      code: 'AREA_LIMIT',
    });

    expect(geodesicAreaKm2([0, 0, 0.0898, 0.0898])).toBeCloseTo(
      AUDITED_UNDER_LIMIT_AREA_KM2,
      10,
    );
    expect(validateBBox([0, 0, 0.0898, 0.0898])).toEqual({
      ok: true,
      bbox: [0, 0, 0.0898, 0.0898],
      areaKm2: AUDITED_UNDER_LIMIT_AREA_KM2,
    });

    expect(validateBBox([0, 0, 0.2, 0.2])).toEqual({
      ok: false,
      code: 'AREA_LIMIT',
    });
  });
});
