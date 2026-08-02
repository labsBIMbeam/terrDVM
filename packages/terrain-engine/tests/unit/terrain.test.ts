import { describe, expect, it } from 'vitest';

import {
  DEM_SOURCE,
  MAX_DEM_TILES,
  chooseDemZoom,
  decodeTerrarium,
  demTileUrl,
  demTilesForBBox,
  isApprovedDemUrl,
  latToTileY,
  lonToTileX,
  tileXToLon,
  tileYToLat,
} from '../../src/terrain/dem';
import { sampleHeightfield, type DemTileRaster } from '../../src/terrain/heightfield';
import { bboxExtentMetres, buildTerrainMesh } from '../../src/terrain/mesh';
import type { BBox4326 } from '../../src/bbox/validate';

const MADEIRA: BBox4326 = [-17.05, 32.7, -16.95, 32.78];
const TILE_SIZE = 64;

/** Terrarium encodes elevation as (R * 256 + G + B / 256) - 32768. */
function encodeTerrarium(metres: number): [number, number, number] {
  const value = metres + 32768;
  const red = Math.floor(value / 256);
  const green = Math.floor(value) % 256;
  const blue = Math.round((value - Math.floor(value)) * 256) % 256;
  return [red, green, blue];
}

function rasterOf(
  tile: { z: number; x: number; y: number },
  elevationAt: (localX: number, localY: number) => number,
): DemTileRaster {
  const data = new Uint8ClampedArray(TILE_SIZE * TILE_SIZE * 4);
  for (let y = 0; y < TILE_SIZE; y += 1) {
    for (let x = 0; x < TILE_SIZE; x += 1) {
      const [r, g, b] = encodeTerrarium(elevationAt(x, y));
      const offset = (y * TILE_SIZE + x) * 4;
      data[offset] = r;
      data[offset + 1] = g;
      data[offset + 2] = b;
      data[offset + 3] = 255;
    }
  }
  return { ...tile, data, size: TILE_SIZE };
}

describe('terrarium DEM decoding', () => {
  it('round-trips integer elevations', () => {
    for (const metres of [-500, 0, 1, 861, 1862, 8000]) {
      const [r, g, b] = encodeTerrarium(metres);
      expect(decodeTerrarium(r, g, b)).toBeCloseTo(metres, 6);
    }
  });

  it('decodes the encoding zero point to -32768 m', () => {
    expect(decodeTerrarium(0, 0, 0)).toBe(-32768);
  });
});

describe('slippy tile math', () => {
  it('round-trips lon/lat through tile coordinates', () => {
    const zoom = 12;
    for (const [lon, lat] of [[-16.9, 32.75], [0, 0], [12.5, -40.25]] as const) {
      expect(tileXToLon(lonToTileX(lon, zoom), zoom)).toBeCloseTo(lon, 9);
      expect(tileYToLat(latToTileY(lat, zoom), zoom)).toBeCloseTo(lat, 9);
    }
  });

  it('places Madeira in the expected z11 tile', () => {
    expect(Math.floor(lonToTileX(-16.9, 11))).toBe(927);
    expect(Math.floor(latToTileY(32.75, 11))).toBe(826);
  });
});

describe('DEM tile planning', () => {
  // Locked deliberately: z12 is the last zoom carrying 1-arcsec source
  // information, z14 costs 16x the corpus bytes for interpolation, and the
  // 40 GB hosting gate turns on this constant. See the note in dem.ts.
  it('caps the DEM at z13', () => {
    expect(DEM_SOURCE.maxZoom).toBe(13);
  });

  it('clamps a tiny selection to the cap instead of over-zooming', () => {
    // 0.005 deg of longitude wants z16; the cap must hold it at 13.
    expect(chooseDemZoom([-16.905, 32.75, -16.9, 32.755], 192)).toBe(DEM_SOURCE.maxZoom);
  });

  it('keeps the chosen zoom inside the approved range', () => {
    expect(chooseDemZoom(MADEIRA, 192)).toBeGreaterThanOrEqual(DEM_SOURCE.minZoom);
    expect(chooseDemZoom(MADEIRA, 192)).toBeLessThanOrEqual(DEM_SOURCE.maxZoom);
  });

  it('rejects a non-positive longitude span', () => {
    expect(() => chooseDemZoom([1, 0, 1, 1] as BBox4326, 192)).toThrow(RangeError);
  });

  it('never exceeds the tile budget, coarsening zoom instead', () => {
    const { tiles } = demTilesForBBox(MADEIRA, DEM_SOURCE.maxZoom);
    expect(tiles.length).toBeGreaterThan(0);
    expect(tiles.length).toBeLessThanOrEqual(MAX_DEM_TILES);
  });

  it('covers the bounding box corners at the chosen zoom', () => {
    const { zoom, tiles } = demTilesForBBox(MADEIRA, chooseDemZoom(MADEIRA, 192));
    const keys = new Set(tiles.map((tile) => `${tile.x}/${tile.y}`));
    const corners: Array<[number, number]> = [
      [MADEIRA[0], MADEIRA[3]],
      [MADEIRA[2], MADEIRA[3]],
      [MADEIRA[0], MADEIRA[1]],
      [MADEIRA[2], MADEIRA[1]],
    ];
    for (const [lon, lat] of corners) {
      const key = `${Math.floor(lonToTileX(lon, zoom))}/${Math.floor(latToTileY(lat, zoom))}`;
      expect(keys.has(key)).toBe(true);
    }
  });
});

describe('DEM source allowlist', () => {
  it('builds only approved URLs', () => {
    const url = demTileUrl(12, 1855, 1653);
    expect(url).toBe('https://s3.amazonaws.com/elevation-tiles-prod/terrarium/12/1855/1653.png');
    expect(isApprovedDemUrl(url)).toBe(true);
  });

  it('rejects zooms outside the approved range', () => {
    expect(() => demTileUrl(DEM_SOURCE.maxZoom + 1, 1, 1)).toThrow(RangeError);
    expect(() => demTileUrl(1.5, 1, 1)).toThrow(RangeError);
  });

  it('fails closed on foreign origins, query strings and stray paths', () => {
    expect(isApprovedDemUrl('https://evil.example/elevation-tiles-prod/terrarium/12/1/1.png')).toBe(false);
    expect(isApprovedDemUrl('http://s3.amazonaws.com/elevation-tiles-prod/terrarium/12/1/1.png')).toBe(false);
    expect(isApprovedDemUrl('https://s3.amazonaws.com/elevation-tiles-prod/terrarium/12/1/1.png?x=1')).toBe(false);
    expect(isApprovedDemUrl('https://s3.amazonaws.com/some-other-bucket/12/1/1.png')).toBe(false);
    expect(isApprovedDemUrl('not-a-url')).toBe(false);
  });
});

describe('heightfield sampling', () => {
  it('reproduces a constant elevation exactly', () => {
    const { zoom, tiles } = demTilesForBBox(MADEIRA, chooseDemZoom(MADEIRA, 32));
    const rasters = tiles.map((tile) => rasterOf(tile, () => 512));
    const field = sampleHeightfield(MADEIRA, zoom, rasters, 16);

    expect(field.gridN).toBe(16);
    expect(field.heights).toHaveLength(256);
    expect(field.minM).toBeCloseTo(512, 6);
    expect(field.maxM).toBeCloseTo(512, 6);
  });

  it('resolves a horizontal gradient monotonically west to east', () => {
    const { zoom, tiles } = demTilesForBBox(MADEIRA, chooseDemZoom(MADEIRA, 32));
    const rasters = tiles.map((tile) =>
      rasterOf(tile, (localX) => (tile.x * TILE_SIZE + localX) % 1000),
    );
    const field = sampleHeightfield(MADEIRA, zoom, rasters, 12);

    const row = 6;
    for (let col = 1; col < field.gridN; col += 1) {
      const previous = field.heights[row * field.gridN + col - 1];
      const current = field.heights[row * field.gridN + col];
      expect(current).toBeGreaterThanOrEqual(previous - 1e-6);
    }
  });

  it('rejects a degenerate grid or an empty tile set', () => {
    const { zoom, tiles } = demTilesForBBox(MADEIRA, chooseDemZoom(MADEIRA, 32));
    const rasters = tiles.map((tile) => rasterOf(tile, () => 0));
    expect(() => sampleHeightfield(MADEIRA, zoom, rasters, 1)).toThrow(RangeError);
    expect(() => sampleHeightfield(MADEIRA, zoom, [], 8)).toThrow(RangeError);
  });
});

describe('terrain meshing', () => {
  const flatField = { heights: new Float32Array(16), gridN: 4, minM: 0, maxM: 0 };

  it('produces a well-formed indexed grid', () => {
    const mesh = buildTerrainMesh(flatField, MADEIRA);
    expect(mesh.stats.vertices).toBe(16);
    expect(mesh.stats.triangles).toBe((4 - 1) * (4 - 1) * 2);
    expect(mesh.indices).toHaveLength(mesh.stats.triangles * 3);
    expect(mesh.positions).toHaveLength(16 * 3);
    expect(Math.max(...mesh.indices)).toBeLessThan(mesh.stats.vertices);
  });

  it('points every normal up for flat ground, all unit length', () => {
    const mesh = buildTerrainMesh(flatField, MADEIRA);
    for (let vertex = 0; vertex < mesh.stats.vertices; vertex += 1) {
      const offset = vertex * 3;
      expect(mesh.normals[offset]).toBeCloseTo(0, 6);
      expect(mesh.normals[offset + 1]).toBeCloseTo(1, 6);
      expect(mesh.normals[offset + 2]).toBeCloseTo(0, 6);
      expect(
        Math.hypot(mesh.normals[offset], mesh.normals[offset + 1], mesh.normals[offset + 2]),
      ).toBeCloseTo(1, 6);
    }
  });

  it('centres the mesh on the origin and rebases elevation to zero', () => {
    const field = { heights: new Float32Array([100, 100, 300, 300]), gridN: 2, minM: 100, maxM: 300 };
    const mesh = buildTerrainMesh(field, MADEIRA);
    const { widthM, depthM } = bboxExtentMetres(MADEIRA);

    expect(mesh.positions[0]).toBeCloseTo(-widthM / 2, 3);
    expect(mesh.positions[2]).toBeCloseTo(-depthM / 2, 3);
    expect(mesh.positions[1]).toBeCloseTo(0, 6);
    expect(mesh.positions[3 * 3 + 1]).toBeCloseTo(200, 6);
  });

  it('applies vertical exaggeration and rejects a non-positive factor', () => {
    const field = { heights: new Float32Array([0, 0, 0, 50]), gridN: 2, minM: 0, maxM: 50 };
    expect(buildTerrainMesh(field, MADEIRA, 2).positions[3 * 3 + 1]).toBeCloseTo(100, 6);
    expect(() => buildTerrainMesh(field, MADEIRA, 0)).toThrow(RangeError);
  });

  it('derives metric extents that grow with the bounding box', () => {
    const small = bboxExtentMetres(MADEIRA);
    const large = bboxExtentMetres([-17.3, 32.6, -16.6, 32.9]);
    expect(small.widthM).toBeGreaterThan(0);
    expect(large.widthM).toBeGreaterThan(small.widthM);
    expect(large.depthM).toBeGreaterThan(small.depthM);
  });
});
