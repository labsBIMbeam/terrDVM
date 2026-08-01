import { describe, expect, it } from 'vitest';

import { extrudeFootprints, triangulate, type Footprint } from '@terrcvm/terrain-engine/buildings/extrude';
import {
  DEFAULT_BUILDING_HEIGHT_M,
  METRES_PER_LEVEL,
  buildingsUrl,
  heightFromTags,
  isApprovedBuildingsUrl,
  overpassQuery,
  parseOverpass,
} from '../../src/buildings/source-osm';
import type { BBox4326 } from '@terrcvm/terrain-engine/bbox/validate';

const BBOX: BBox4326 = [-16.93, 32.64, -16.90, 32.66];
const FLAT = () => 0;

/** A small axis-aligned square footprint inside BBOX. */
function square(size = 0.001): Footprint {
  const [west, south] = BBOX;
  const w = west + 0.001;
  const s = south + 0.001;
  return {
    ring: [
      [w, s],
      [w + size, s],
      [w + size, s + size],
      [w, s + size],
    ],
    heightM: 10,
  };
}

describe('triangulate', () => {
  it('splits a convex quad into two triangles', () => {
    const ring = [
      { x: 0, z: 0 },
      { x: 10, z: 0 },
      { x: 10, z: 10 },
      { x: 0, z: 10 },
    ];
    expect(triangulate(ring)).toHaveLength(6);
  });

  it('handles a concave L shape', () => {
    const ring = [
      { x: 0, z: 0 },
      { x: 10, z: 0 },
      { x: 10, z: 4 },
      { x: 4, z: 4 },
      { x: 4, z: 10 },
      { x: 0, z: 10 },
    ];
    const triangles = triangulate(ring);
    // n vertices -> n-2 triangles for a simple polygon.
    expect(triangles).toHaveLength((6 - 2) * 3);
    expect(Math.max(...triangles)).toBeLessThan(6);
  });

  it('produces the same triangle count for either winding order', () => {
    const ring = [
      { x: 0, z: 0 },
      { x: 5, z: 0 },
      { x: 5, z: 5 },
      { x: 0, z: 5 },
    ];
    expect(triangulate(ring)).toHaveLength(triangulate([...ring].reverse()).length);
  });

  it('returns nothing for degenerate rings instead of throwing', () => {
    expect(triangulate([])).toEqual([]);
    expect(triangulate([{ x: 0, z: 0 }, { x: 1, z: 1 }])).toEqual([]);
  });
});

describe('extrudeFootprints', () => {
  it('builds a closed solid: roof cap plus one quad per wall', () => {
    const mesh = extrudeFootprints([square()], BBOX, FLAT);
    // Roof: 4 verts. Walls: 4 edges x 4 verts.
    expect(mesh.stats.vertices).toBe(4 + 4 * 4);
    // Roof: 2 triangles. Walls: 4 edges x 2.
    expect(mesh.stats.triangles).toBe(2 + 4 * 2);
    expect(mesh.stats.footprints).toBe(1);
    expect(Math.max(...mesh.indices)).toBeLessThan(mesh.stats.vertices);
  });

  it('places the roof exactly `heightM` above the sampled ground', () => {
    const mesh = extrudeFootprints([{ ...square(), heightM: 25 }], BBOX, () => 100);
    const ys: number[] = [];
    for (let i = 1; i < mesh.positions.length; i += 3) ys.push(mesh.positions[i]);
    expect(Math.min(...ys)).toBeCloseTo(100, 6);
    expect(Math.max(...ys)).toBeCloseTo(125, 6);
  });

  it('follows terrain so a building on a slope is not left floating', () => {
    const onHill = extrudeFootprints([square()], BBOX, (x) => x);
    const ys: number[] = [];
    for (let i = 1; i < onHill.positions.length; i += 3) ys.push(onHill.positions[i]);
    // Ground is no longer at zero, and the solid is still exactly 10 m tall.
    expect(Math.min(...ys)).not.toBeCloseTo(0, 3);
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(10, 6);
  });

  it('keeps every normal unit length', () => {
    const mesh = extrudeFootprints([square()], BBOX, FLAT);
    for (let i = 0; i < mesh.normals.length; i += 3) {
      const length = Math.hypot(mesh.normals[i], mesh.normals[i + 1], mesh.normals[i + 2]);
      expect(length).toBeCloseTo(1, 6);
    }
  });

  it('tolerates a repeated closing vertex', () => {
    const base = square();
    const closed: Footprint = { ...base, ring: [...base.ring, base.ring[0]] };
    expect(extrudeFootprints([closed], BBOX, FLAT).stats).toEqual(
      extrudeFootprints([base], BBOX, FLAT).stats,
    );
  });

  it('skips unusable footprints without discarding the good ones', () => {
    const bad: Footprint[] = [
      { ring: [[-16.92, 32.65], [-16.919, 32.65]], heightM: 10 }, // too few points
      { ...square(), heightM: 0 }, // no height
      { ...square(), heightM: Number.NaN },
    ];
    const mesh = extrudeFootprints([...bad, square()], BBOX, FLAT);
    expect(mesh.stats.footprints).toBe(1);
  });

  it('returns an empty mesh for no input', () => {
    const mesh = extrudeFootprints([], BBOX, FLAT);
    expect(mesh.stats).toEqual({ footprints: 0, vertices: 0, triangles: 0 });
    expect(mesh.indices).toHaveLength(0);
  });
});

describe('OSM building source', () => {
  it('derives height from explicit metres, then levels, then a default', () => {
    expect(heightFromTags({ height: '18.5' })).toBe(18.5);
    expect(heightFromTags({ 'building:levels': '4' })).toBe(4 * METRES_PER_LEVEL);
    expect(heightFromTags({ height: '12', 'building:levels': '99' })).toBe(12);
    expect(heightFromTags({})).toBe(DEFAULT_BUILDING_HEIGHT_M);
    expect(heightFromTags(undefined)).toBe(DEFAULT_BUILDING_HEIGHT_M);
  });

  it('ignores nonsense height tags and clamps absurd ones', () => {
    expect(heightFromTags({ height: 'tall' })).toBe(DEFAULT_BUILDING_HEIGHT_M);
    expect(heightFromTags({ height: '-5' })).toBe(DEFAULT_BUILDING_HEIGHT_M);
    expect(heightFromTags({ height: '99999' })).toBe(400);
  });

  it('builds a query in Overpass south,west,north,east order', () => {
    expect(overpassQuery(BBOX, 50)).toContain('(32.64,-16.93,32.66,-16.9)');
    expect(overpassQuery(BBOX, 50)).toContain('out geom 50;');
  });

  it('accepts only its own origin, path and data parameter', () => {
    expect(isApprovedBuildingsUrl(buildingsUrl(BBOX, 10))).toBe(true);
    expect(isApprovedBuildingsUrl('https://overpass-api.de/api/interpreter?data=x&cb=1')).toBe(false);
    expect(isApprovedBuildingsUrl('https://evil.example/api/interpreter?data=x')).toBe(false);
    expect(isApprovedBuildingsUrl('http://overpass-api.de/api/interpreter?data=x')).toBe(false);
    expect(isApprovedBuildingsUrl('https://overpass-api.de/other?data=x')).toBe(false);
    expect(isApprovedBuildingsUrl('not-a-url')).toBe(false);
  });

  it('parses ways into footprints and skips everything else', () => {
    const footprints = parseOverpass({
      elements: [
        {
          type: 'way',
          tags: { 'building:levels': '3' },
          geometry: [
            { lat: 32.65, lon: -16.92 },
            { lat: 32.65, lon: -16.919 },
            { lat: 32.651, lon: -16.919 },
          ],
        },
        { type: 'node', geometry: [{ lat: 1, lon: 1 }] },
        { type: 'way', geometry: [{ lat: 32.65, lon: -16.92 }] },
      ],
    });
    expect(footprints).toHaveLength(1);
    expect(footprints[0].heightM).toBe(3 * METRES_PER_LEVEL);
    expect(footprints[0].ring).toHaveLength(3);
  });

  it('returns nothing for a malformed payload', () => {
    expect(parseOverpass(null)).toEqual([]);
    expect(parseOverpass({})).toEqual([]);
    expect(parseOverpass({ elements: 'nope' })).toEqual([]);
  });
});
