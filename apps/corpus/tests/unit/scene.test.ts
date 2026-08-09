import { describe, expect, it } from 'vitest';
import { tileBBox } from '@terrcvm/geo-protocol';
import type { DemTileRaster } from '@terrcvm/terrain-engine/terrain/heightfield';
import type { FeatureTile } from '@terrcvm/terrain-engine/features/types';
import { buildCorpusFeatures, buildCorpusTerrain, corpusGround } from '../../src/corpus/scene';

const DEM_PARENT = { z: 13, x: 3711, y: 3309 };
/** North-west child of DEM_PARENT — the covered Funchal tile. */
const FUNCHAL = { z: 14, x: 7422, y: 6618 };
/** North-east child of the same parent — the negative-case neighbour. */
const NEIGHBOUR = { z: 14, x: 7423, y: 6618 };

/**
 * A synthetic Terrarium tile whose elevation is its own pixel column: the
 * height at pixel x is exactly x metres. That makes the crop observable —
 * whichever pixels a sample reads, the metres say so.
 */
function rampRaster(size = 256): DemTileRaster {
  const data = new Uint8ClampedArray(size * size * 4);
  for (let py = 0; py < size; py += 1) {
    for (let px = 0; px < size; px += 1) {
      const encoded = 32768 + px; // Terrarium: (R*256 + G + B/256) - 32768
      const offset = (py * size + px) * 4;
      data[offset] = Math.floor(encoded / 256);
      data[offset + 1] = encoded % 256;
      data[offset + 2] = 0;
      data[offset + 3] = 255;
    }
  }
  return { ...DEM_PARENT, data, size };
}

describe('buildCorpusTerrain — the cross-zoom crop', () => {
  it('samples only the part of the z13 tile the z14 tile covers', () => {
    const mesh = buildCorpusTerrain(rampRaster(), tileBBox(FUNCHAL), 32);

    // Funchal is the NW child, so it lives in pixel columns 0..127 and must
    // never see the ramp's upper half. Sampling the whole parent would reach
    // ~255 m; a correct crop stops near 128.
    expect(mesh.stats.minElevationM).toBeLessThan(5);
    expect(mesh.stats.maxElevationM).toBeGreaterThan(100);
    expect(mesh.stats.maxElevationM).toBeLessThan(135);
  });

  it('gives the neighbour child a different crop of the same parent tile', () => {
    const covered = buildCorpusTerrain(rampRaster(), tileBBox(FUNCHAL), 32);
    const neighbour = buildCorpusTerrain(rampRaster(), tileBBox(NEIGHBOUR), 32);

    // Same bytes, same parent, different ground — which is the whole point of
    // a coarser dataset answering for a finer tile.
    expect(neighbour.stats.minElevationM).toBeGreaterThan(covered.stats.maxElevationM - 5);
    expect(neighbour.stats.maxElevationM).toBeGreaterThan(240);
  });

  it('renders at true scale — no vertical exaggeration', () => {
    const mesh = buildCorpusTerrain(rampRaster(), tileBBox(FUNCHAL), 32);
    const relief = mesh.stats.maxElevationM - mesh.stats.minElevationM;

    let lowest = Infinity;
    let highest = -Infinity;
    for (let i = 1; i < mesh.positions.length; i += 3) {
      lowest = Math.min(lowest, mesh.positions[i]);
      highest = Math.max(highest, mesh.positions[i]);
    }
    // The datum shifts to zero, but the span must equal the real relief.
    expect(highest - lowest).toBeCloseTo(relief, 3);
  });
});

describe('buildCorpusFeatures', () => {
  const bbox = tileBBox(FUNCHAL);
  const [west, south, east, north] = bbox;
  const midLon = (west + east) / 2;
  const midLat = (south + north) / 2;

  const featureTile = (): FeatureTile => ({
    ...FUNCHAL,
    buildings: [
      {
        ring: [
          [midLon, midLat],
          [midLon + 0.0002, midLat],
          [midLon + 0.0002, midLat + 0.0002],
          [midLon, midLat + 0.0002],
        ],
        heightM: 12,
      },
    ],
    roads: [
      {
        line: [
          [west + 0.001, midLat],
          [east - 0.001, midLat],
        ],
        roadClass: 'residential',
      },
    ],
    landuse: [
      {
        ring: [
          [west + 0.001, south + 0.001],
          [west + 0.003, south + 0.001],
          [west + 0.003, south + 0.003],
          [west + 0.001, south + 0.003],
        ],
        landuseClass: 'forest',
      },
    ],
  });

  it('builds geometry for every layer the tile carries and counts it honestly', () => {
    const mesh = buildCorpusTerrain(rampRaster(), bbox, 32);
    const built = buildCorpusFeatures(featureTile(), bbox, corpusGround(mesh));

    expect(built.counts).toEqual({ buildings: 1, roads: 1, landuse: 1 });
    expect(built.buildings?.indices.length).toBeGreaterThan(0);
    expect(built.roads?.indices.length).toBeGreaterThan(0);
    // Land cover is grouped per class rather than flattened, so its geometry
    // is counted through the class meshes.
    expect(built.landcover?.classes.length).toBeGreaterThan(0);
    expect(built.landcover?.stats.triangles).toBeGreaterThan(0);
  });

  it('returns no geometry, and says zero, for an empty tile', () => {
    const mesh = buildCorpusTerrain(rampRaster(), bbox, 32);
    const empty: FeatureTile = { ...FUNCHAL, buildings: [], roads: [], landuse: [] };
    const built = buildCorpusFeatures(empty, bbox, corpusGround(mesh));

    expect(built.counts).toEqual({ buildings: 0, roads: 0, landuse: 0 });
    expect(built.buildings).toBeUndefined();
    expect(built.roads).toBeUndefined();
    expect(built.landcover).toBeUndefined();
  });
});
