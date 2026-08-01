import { describe, expect, it } from 'vitest';

import { ROAD_DRAPE_OFFSET_M, buildRibbonMesh, buildRoadMesh } from '@terrcvm/terrain-engine/features/ribbon';
import { ROAD_WIDTH_M, WATERWAY_WIDTH_M, type RoadFeature } from '@terrcvm/terrain-engine/features/types';
import { featuresQuery, parseFeatures, roadClassFor } from '../../src/features/source-osm';
import type { BBox4326 } from '@terrcvm/terrain-engine/bbox/validate';

const BBOX: BBox4326 = [-16.93, 32.64, -16.90, 32.66];
const FLAT = () => 0;

function straightRoad(roadClass: RoadFeature['roadClass'] = 'primary'): RoadFeature {
  return { line: [[-16.925, 32.645], [-16.915, 32.645]], roadClass };
}

describe('road ribbons', () => {
  it('emits one quad per segment', () => {
    const mesh = buildRoadMesh([straightRoad()], BBOX, FLAT);
    expect(mesh.stats.roads).toBe(1);
    expect(mesh.stats.segments).toBe(1);
    expect(mesh.stats.triangles).toBe(2);
    expect(mesh.positions).toHaveLength(4 * 3);
  });

  it('scales ribbon width with road class', () => {
    const widthOf = (road: RoadFeature) => {
      const mesh = buildRoadMesh([road], BBOX, FLAT);
      const zs: number[] = [];
      for (let i = 2; i < mesh.positions.length; i += 3) zs.push(mesh.positions[i]);
      return Math.max(...zs) - Math.min(...zs);
    };
    const motorway = widthOf(straightRoad('motorway'));
    const path = widthOf(straightRoad('path'));

    expect(motorway).toBeCloseTo(ROAD_WIDTH_M.motorway, 0);
    expect(path).toBeCloseTo(ROAD_WIDTH_M.path, 0);
    expect(motorway).toBeGreaterThan(path);
  });

  it('lifts the ribbon above the surface so it cannot z-fight', () => {
    const mesh = buildRoadMesh([straightRoad()], BBOX, () => 50);
    for (let i = 1; i < mesh.positions.length; i += 3) {
      expect(mesh.positions[i]).toBeCloseTo(50 + ROAD_DRAPE_OFFSET_M, 5);
    }
  });

  it('applies the same vertical scale as the terrain', () => {
    const mesh = buildRoadMesh([straightRoad()], BBOX, () => 0, 3);
    expect(mesh.positions[1]).toBeCloseTo(ROAD_DRAPE_OFFSET_M * 3, 5);
  });

  it('follows the terrain along its length', () => {
    const mesh = buildRoadMesh([straightRoad()], BBOX, (x) => x, 1);
    const ys: number[] = [];
    for (let i = 1; i < mesh.positions.length; i += 3) ys.push(mesh.positions[i]);
    expect(Math.max(...ys)).toBeGreaterThan(Math.min(...ys));
  });

  it('keeps normals unit length and upward', () => {
    const mesh = buildRoadMesh([straightRoad()], BBOX, FLAT);
    for (let i = 0; i < mesh.normals.length; i += 3) {
      expect(mesh.normals[i + 1]).toBe(1);
      expect(Math.hypot(mesh.normals[i], mesh.normals[i + 1], mesh.normals[i + 2])).toBe(1);
    }
  });

  it('drops degenerate input without discarding valid roads', () => {
    const degenerate: RoadFeature[] = [
      { line: [[-16.92, 32.65]], roadClass: 'primary' },
      { line: [[-16.92, 32.65], [-16.92, 32.65]], roadClass: 'primary' },
    ];
    expect(buildRoadMesh(degenerate, BBOX, FLAT).stats.segments).toBe(0);
    expect(buildRoadMesh([...degenerate, straightRoad()], BBOX, FLAT).stats.roads).toBe(1);
    expect(buildRoadMesh([], BBOX, FLAT).stats.triangles).toBe(0);
  });
});

describe('OSM feature source', () => {
  it('queries buildings and highways in one request', () => {
    const query = featuresQuery(BBOX, 100);
    expect(query).toContain('way["building"]');
    expect(query).toContain('way["highway"]');
    expect(query).toContain('out geom 100;');
  });

  it('maps highway values onto stored classes', () => {
    expect(roadClassFor('motorway')).toBe('motorway');
    expect(roadClassFor('motorway_link')).toBe('motorway');
    expect(roadClassFor('unclassified')).toBe('residential');
    expect(roadClassFor('living_street')).toBe('residential');
    expect(roadClassFor('footway')).toBe('path');
    expect(roadClassFor('cycleway')).toBe('path');
  });

  it('rejects non-road highway values and missing tags', () => {
    expect(roadClassFor('bus_stop')).toBeNull();
    expect(roadClassFor('proposed')).toBeNull();
    expect(roadClassFor(undefined)).toBeNull();
  });

  it('splits a mixed payload into separate layers', () => {
    const parsed = parseFeatures({
      elements: [
        {
          type: 'way',
          tags: { building: 'yes', 'building:levels': '4' },
          geometry: [
            { lat: 32.65, lon: -16.92 },
            { lat: 32.65, lon: -16.919 },
            { lat: 32.651, lon: -16.919 },
          ],
        },
        {
          type: 'way',
          tags: { highway: 'secondary' },
          geometry: [
            { lat: 32.65, lon: -16.92 },
            { lat: 32.655, lon: -16.915 },
          ],
        },
        { type: 'way', tags: { highway: 'bus_stop' }, geometry: [{ lat: 1, lon: 1 }, { lat: 2, lon: 2 }] },
        {
          type: 'way',
          tags: { natural: 'wood' },
          geometry: [
            { lat: 32.66, lon: -16.93 },
            { lat: 32.67, lon: -16.92 },
            { lat: 32.68, lon: -16.94 },
          ],
        },
        { type: 'node', tags: { building: 'yes' } },
      ],
    });

    expect(parsed.buildings).toHaveLength(1);
    expect(parsed.buildings[0].heightM).toBe(12);
    expect(parsed.roads).toHaveLength(1);
    expect(parsed.landuse).toHaveLength(1);
    expect(parsed.landuse[0].landuseClass).toBe('forest');
    expect(parsed.roads[0].roadClass).toBe('secondary');
  });

  it('returns empty layers for a malformed payload', () => {
    const empty = { buildings: [], roads: [], landuse: [], waterways: [] };
    expect(parseFeatures(null)).toEqual(empty);
    expect(parseFeatures({ elements: 'nope' })).toEqual(empty);
  });
});

describe('waterway ribbons', () => {
  it('parses waterway ways into their own layer', () => {
    const payload = {
      elements: [
        {
          type: 'way',
          tags: { waterway: 'river' },
          geometry: [
            { lat: 48.19, lon: 16.36 },
            { lat: 48.2, lon: 16.37 },
          ],
        },
        { type: 'way', tags: { waterway: 'dam' }, geometry: [] },
      ],
    };
    const features = parseFeatures(payload);
    expect(features.waterways).toHaveLength(1);
    expect(features.waterways[0].waterwayClass).toBe('river');
    expect(features.roads).toHaveLength(0);
  });

  it('asks Overpass for waterways alongside the other layers', () => {
    expect(featuresQuery(BBOX, 100)).toContain('way["waterway"]');
  });

  it('builds ribbons at the waterway width, below the road lift', () => {
    const mesh = buildRibbonMesh(
      [{ line: [[-16.925, 32.645], [-16.915, 32.645]], widthM: WATERWAY_WIDTH_M.river }],
      BBOX,
      () => 0,
      1,
      0.8,
    );
    const zs: number[] = [];
    for (let i = 2; i < mesh.positions.length; i += 3) zs.push(mesh.positions[i]);
    expect(Math.max(...zs) - Math.min(...zs)).toBeCloseTo(WATERWAY_WIDTH_M.river, 0);
    expect(mesh.positions[1]).toBeCloseTo(0.8, 5);
    expect(0.8).toBeLessThan(ROAD_DRAPE_OFFSET_M);
  });
});

describe('prewarm cache-key contract', () => {
  it('pins the exact query string the server-side prewarmer mirrors', () => {
    // The same string is pinned in services/blossom-gis/tests/test_prewarm.py.
    // If either side changes, both pins fail and the contract is renegotiated.
    const ring: BBox4326 = [16.355, 48.195, 16.385, 48.215];
    expect(featuresQuery(ring, 16000)).toBe(
      '[out:json][timeout:25];(' +
        'way["building"](48.195,16.355,48.215,16.385);' +
        'way["highway"](48.195,16.355,48.215,16.385);' +
        'way["waterway"](48.195,16.355,48.215,16.385);' +
        'way["landuse"](48.195,16.355,48.215,16.385);' +
        'way["natural"](48.195,16.355,48.215,16.385);' +
        ');out geom 16000;',
    );
  });
});
