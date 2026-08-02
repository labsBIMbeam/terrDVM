import { describe, expect, it } from 'vitest';

import {
  isApprovedWienBuildingsUrl,
  parseWienBuildings,
  wienBuildingsUrl,
} from '../../src/buildings/source-wien';
import type { BBox4326 } from '@terrcvm/terrain-engine/bbox/validate';

const RING: BBox4326 = [16.355, 48.195, 16.385, 48.215];

const feature = (
  top: number | null,
  terrain: number | null,
  ring: [number, number][] = [
    [16.36, 48.2],
    [16.361, 48.2],
    [16.361, 48.201],
    [16.36, 48.2],
  ],
) => ({
  geometry: { type: 'Polygon', coordinates: [ring] },
  properties: { O_KOTE: top, T_KOTE: terrain },
});

describe('vienna building bodies', () => {
  it('derives measured part heights from the elevation pair', () => {
    const footprints = parseWienBuildings({ features: [feature(46.7, 33.9)] });
    expect(footprints).toHaveLength(1);
    expect(footprints[0].heightM).toBeCloseTo(12.8);
    expect(footprints[0].ring.length).toBeGreaterThanOrEqual(3);
  });

  it('drops parts without both elevations or with nonsense heights', () => {
    const footprints = parseWienBuildings({
      features: [
        feature(null, 33.9), // no top
        feature(34.2, 33.9), // 30 cm — a kerb, not a building
        feature(500, 33.9), // 466 m — data error
      ],
    });
    expect(footprints).toHaveLength(0);
  });

  it('unrolls multipolygon parts into one footprint per outer ring', () => {
    const square: [number, number][] = [
      [16.36, 48.2],
      [16.361, 48.2],
      [16.361, 48.201],
      [16.36, 48.2],
    ];
    const footprints = parseWienBuildings({
      features: [
        {
          geometry: { type: 'MultiPolygon', coordinates: [[square], [square]] },
          properties: { O_KOTE: 40, T_KOTE: 30 },
        },
      ],
    });
    expect(footprints).toHaveLength(2);
  });

  it('pins the proxy URL to the registered source and bbox only', () => {
    const url = new URL(wienBuildingsUrl(RING));
    expect(url.pathname).toBe('/wfs');
    expect(url.searchParams.get('src')).toBe('vienna-bkm');
    expect(isApprovedWienBuildingsUrl(url.toString())).toBe(true);
    expect(isApprovedWienBuildingsUrl(`${url.origin}/wfs?src=vienna-bkm&bbox=1,2,3,4&x=1`)).toBe(
      false,
    );
    expect(isApprovedWienBuildingsUrl('https://data.wien.gv.at/wfs?src=vienna-bkm&bbox=1,2,3,4')).toBe(
      false,
    );
  });
});
