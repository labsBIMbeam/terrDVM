import { describe, expect, it } from 'vitest';

import {
  TILE_EXTENT,
  decodeFeatureTile,
  encodeFeatureTile,
} from '../../src/features/codec';
import { LANDUSE_CLASSES, ROAD_CLASSES, type FeatureTile } from '../../src/features/types';
import { tileXToLon, tileYToLat } from '../../src/terrain/dem';

const Z = 14;
const X = 7420;
const Y = 6614;

/** Quantisation step in degrees, so tolerance is derived rather than guessed. */
const LON_STEP = (tileXToLon(X + 1, Z) - tileXToLon(X, Z)) / TILE_EXTENT;
const LAT_STEP = (tileYToLat(Y, Z) - tileYToLat(Y + 1, Z)) / TILE_EXTENT;

function pointInTile(fx: number, fy: number): [number, number] {
  const west = tileXToLon(X, Z);
  const north = tileYToLat(Y, Z);
  return [west + (tileXToLon(X + 1, Z) - west) * fx, north - (north - tileYToLat(Y + 1, Z)) * fy];
}

function sampleTile(): FeatureTile {
  return {
    z: Z,
    x: X,
    y: Y,
    buildings: [
      {
        ring: [pointInTile(0.10, 0.10), pointInTile(0.12, 0.10), pointInTile(0.12, 0.13), pointInTile(0.10, 0.13)],
        heightM: 14.3,
      },
      {
        ring: [pointInTile(0.50, 0.50), pointInTile(0.53, 0.51), pointInTile(0.52, 0.55)],
        heightM: 7,
      },
    ],
    roads: [
      { line: [pointInTile(0.0, 0.3), pointInTile(0.4, 0.32), pointInTile(0.9, 0.4)], roadClass: 'primary' },
      { line: [pointInTile(0.2, 0.0), pointInTile(0.22, 0.9)], roadClass: 'residential' },
    ],
    landuse: [
      {
        ring: [pointInTile(0.70, 0.10), pointInTile(0.95, 0.12), pointInTile(0.92, 0.40), pointInTile(0.72, 0.38)],
        landuseClass: 'forest',
      },
      {
        ring: [pointInTile(0.05, 0.70), pointInTile(0.35, 0.72), pointInTile(0.30, 0.95)],
        landuseClass: 'vineyard',
      },
    ],
  };
}

/**
 * The other half of the cross-language pin.
 *
 * `services/blossom-gis/tests/test_featuretile.py` asserts that Python
 * reproduces GOLDEN_HEX, and its docstring says those bytes came from this
 * encoder — but nothing here ever checked that claim, so TypeScript could
 * drift freely and every test in the repo would still pass. The tile hash is
 * the storage key, so a one-byte disagreement silently splits one logical tile
 * into two blobs and stops deduplication.
 *
 * Same tile, same points, same expected bytes as the Python side. No new
 * golden value is invented here.
 */
const REF_Z = 14;
const REF_X = 8698;
const REF_Y = 5915;

const GOLDEN_HEX =
  '325446540efa2100001b17000000100204b406b406c60200009803c502007f03b426d827ea03' +
  '50f501be043202030300b41680205280208e050207801000a4018040020400e62cb4068010a4' +
  '01f501f411e50ca30103049a03e62c9a13a4019903dc0e';

function refPoint(fx: number, fy: number): [number, number] {
  const west = tileXToLon(REF_X, REF_Z);
  const north = tileYToLat(REF_Y, REF_Z);
  return [
    west + (tileXToLon(REF_X + 1, REF_Z) - west) * fx,
    north - (north - tileYToLat(REF_Y + 1, REF_Z)) * fy,
  ];
}

function referenceTile(): FeatureTile {
  return {
    z: REF_Z,
    x: REF_X,
    y: REF_Y,
    buildings: [
      {
        ring: [refPoint(0.10, 0.10), refPoint(0.14, 0.10), refPoint(0.14, 0.15), refPoint(0.10, 0.15)],
        heightM: 12.7,
      },
      { ring: [refPoint(0.60, 0.62), refPoint(0.66, 0.63), refPoint(0.63, 0.70)], heightM: 5 },
    ],
    roads: [
      { line: [refPoint(0.0, 0.35), refPoint(0.5, 0.36), refPoint(1.0, 0.44)], roadClass: 'secondary' },
      { line: [refPoint(0.25, 0.0), refPoint(0.27, 1.0)], roadClass: 'track' },
    ],
    landuse: [
      {
        ring: [refPoint(0.70, 0.10), refPoint(0.95, 0.12), refPoint(0.92, 0.40), refPoint(0.72, 0.38)],
        landuseClass: 'forest',
      },
      {
        ring: [refPoint(0.05, 0.70), refPoint(0.35, 0.72), refPoint(0.30, 0.95)],
        landuseClass: 'vineyard',
      },
    ],
  };
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

describe('cross-language conformance', () => {
  it('encodes the reference tile byte-for-byte like the Python implementation', () => {
    expect(toHex(encodeFeatureTile(referenceTile()))).toBe(GOLDEN_HEX);
  });

  it('decodes the bytes the Python implementation produces', () => {
    const bytes = Uint8Array.from(
      GOLDEN_HEX.match(/../g)!.map((pair) => Number.parseInt(pair, 16)),
    );
    const tile = decodeFeatureTile(bytes);

    expect([tile.z, tile.x, tile.y]).toEqual([REF_Z, REF_X, REF_Y]);
    expect(tile.buildings.map((b) => b.heightM)).toEqual([12.7, 5]);
    expect(tile.roads.map((r) => r.roadClass)).toEqual(['secondary', 'track']);
    expect(tile.landuse.map((l) => l.landuseClass)).toEqual(['forest', 'vineyard']);
  });
});

describe('feature tile codec', () => {
  it('round-trips geometry within one quantisation step', () => {
    const tile = sampleTile();
    const decoded = decodeFeatureTile(encodeFeatureTile(tile));

    expect(decoded.z).toBe(Z);
    expect(decoded.x).toBe(X);
    expect(decoded.y).toBe(Y);
    expect(decoded.buildings).toHaveLength(2);
    expect(decoded.roads).toHaveLength(2);
    expect(decoded.landuse).toHaveLength(2);

    tile.buildings.forEach((building, i) => {
      building.ring.forEach(([lon, lat], p) => {
        // Accuracy is bounded by the quantisation grid, not by float precision:
        // rounding puts every point within half a step of its original.
        expect(Math.abs(decoded.buildings[i].ring[p][0] - lon)).toBeLessThan(LON_STEP);
        expect(Math.abs(decoded.buildings[i].ring[p][1] - lat)).toBeLessThan(LAT_STEP);
      });
    });
  });

  it('preserves height to a decimetre and road class exactly', () => {
    const decoded = decodeFeatureTile(encodeFeatureTile(sampleTile()));
    expect(decoded.buildings[0].heightM).toBeCloseTo(14.3, 5);
    expect(decoded.buildings[1].heightM).toBe(7);
    expect(decoded.roads[0].roadClass).toBe('primary');
    expect(decoded.roads[1].roadClass).toBe('residential');
    expect(decoded.landuse[0].landuseClass).toBe('forest');
    expect(decoded.landuse[1].landuseClass).toBe('vineyard');
  });

  it('encodes deterministically — the same tile always yields the same bytes', () => {
    // Content addressing depends on this: identical input must hash identically.
    const a = encodeFeatureTile(sampleTile());
    const b = encodeFeatureTile(sampleTile());
    expect(Array.from(a)).toEqual(Array.from(b));
  });

  it('handles an empty tile', () => {
    const empty: FeatureTile = { z: Z, x: X, y: Y, buildings: [], roads: [], landuse: [] };
    const decoded = decodeFeatureTile(encodeFeatureTile(empty));
    expect(decoded.buildings).toEqual([]);
    expect(decoded.roads).toEqual([]);
    expect(decoded.landuse).toEqual([]);
  });

  it('survives every road class', () => {
    const tile: FeatureTile = {
      z: Z, x: X, y: Y, buildings: [], landuse: [],
      roads: ROAD_CLASSES.map((roadClass, i) => ({
        line: [pointInTile(0.1, i / 20), pointInTile(0.9, i / 20)],
        roadClass,
      })),
    };
    const decoded = decodeFeatureTile(encodeFeatureTile(tile));
    expect(decoded.roads.map((r) => r.roadClass)).toEqual([...ROAD_CLASSES]);
  });

  it('survives every landuse class', () => {
    const tile: FeatureTile = {
      z: Z, x: X, y: Y, buildings: [], roads: [],
      landuse: LANDUSE_CLASSES.map((landuseClass, i) => ({
        ring: [pointInTile(0.1, i / 30), pointInTile(0.5, i / 30), pointInTile(0.5, i / 30 + 0.02)],
        landuseClass,
      })),
    };
    const decoded = decodeFeatureTile(encodeFeatureTile(tile));
    expect(decoded.landuse.map((l) => l.landuseClass)).toEqual([...LANDUSE_CLASSES]);
  });

  it('rejects foreign or truncated payloads instead of returning garbage', () => {
    expect(() => decodeFeatureTile(new Uint8Array([1, 2, 3, 4, 5]))).toThrow(/feature tile/);
    const valid = encodeFeatureTile(sampleTile());
    expect(() => decodeFeatureTile(valid.subarray(0, valid.length - 4))).toThrow();
  });

  it('is substantially smaller than the equivalent GeoJSON', () => {
    // 400 small buildings and 60 roads: representative of one dense urban tile.
    const buildings = Array.from({ length: 400 }, (_, i) => {
      const fx = (i % 20) / 20 + 0.002;
      const fy = Math.floor(i / 20) / 20 + 0.002;
      return {
        ring: [
          pointInTile(fx, fy),
          pointInTile(fx + 0.02, fy),
          pointInTile(fx + 0.02, fy + 0.02),
          pointInTile(fx, fy + 0.02),
        ],
        heightM: 9 + (i % 7),
      };
    });
    const roads = Array.from({ length: 60 }, (_, i) => ({
      line: Array.from({ length: 12 }, (_, p) => pointInTile(p / 12, i / 60)),
      roadClass: ROAD_CLASSES[i % ROAD_CLASSES.length],
    }));

    const tile: FeatureTile = { z: Z, x: X, y: Y, buildings, roads, landuse: [] };
    const binary = encodeFeatureTile(tile);
    const geojson = new TextEncoder().encode(
      JSON.stringify({
        type: 'FeatureCollection',
        features: [
          ...buildings.map((b) => ({
            type: 'Feature',
            properties: { height: b.heightM },
            geometry: { type: 'Polygon', coordinates: [b.ring] },
          })),
          ...roads.map((r) => ({
            type: 'Feature',
            properties: { highway: r.roadClass },
            geometry: { type: 'LineString', coordinates: r.line },
          })),
        ],
      }),
    );

    const ratio = geojson.length / binary.length;
    // Round-trip must still hold at this size.
    expect(decodeFeatureTile(binary).buildings).toHaveLength(400);
    expect(ratio).toBeGreaterThan(8);
  });
});
