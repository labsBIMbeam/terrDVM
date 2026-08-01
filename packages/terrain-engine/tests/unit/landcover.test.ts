import { describe, expect, it } from 'vitest';

import { LANDCOVER_COLORS, buildLandcoverMesh } from '../../src/features/landcover';
import { createGroundSampler } from '../../src/buildings/ground';
import type { LanduseFeature } from '../../src/features/types';
import type { BBox4326 } from '../../src/bbox/validate';

const BBOX: BBox4326 = [16.3, 48.178, 16.32, 48.19];
// Bare earth: a patch draped on a DTM lies on the ground it claims to cover.
const flat = createGroundSampler({
  sample: () => 10,
  model: 'dtm',
  sourceId: 'at-bev-dtm-1m',
});

const square = (
  west: number,
  south: number,
  east: number,
  north: number,
): LanduseFeature['ring'] => [
  [west, south],
  [east, south],
  [east, north],
  [west, north],
  [west, south],
];

describe('land-cover mesh', () => {
  it('groups patches by class and drapes them just above the ground', () => {
    const features: LanduseFeature[] = [
      { ring: square(16.302, 48.18, 16.305, 48.182), landuseClass: 'forest' },
      { ring: square(16.306, 48.18, 16.309, 48.182), landuseClass: 'forest' },
      { ring: square(16.31, 48.183, 16.313, 48.185), landuseClass: 'water' },
    ];
    const mesh = buildLandcoverMesh(features, BBOX, flat, 1.5);

    expect(mesh.stats.patches).toBe(3);
    expect(mesh.classes.map((c) => c.landuseClass).sort()).toEqual(['forest', 'water']);
    const forest = mesh.classes.find((c) => c.landuseClass === 'forest')!;
    expect(forest.color).toEqual(LANDCOVER_COLORS.forest);
    // Two squares → 8 vertices, 4 triangles.
    expect(forest.positions.length / 3).toBe(8);
    expect(forest.indices.length / 3).toBe(4);
    // Draped just above the sampled ground, scaled by the exaggeration.
    expect(forest.positions[1]).toBeCloseTo(10 + 0.25 * 1.5);
  });

  it('skips zone classes and degenerate rings', () => {
    const features: LanduseFeature[] = [
      { ring: square(16.302, 48.18, 16.305, 48.182), landuseClass: 'residential' },
      { ring: [[16.31, 48.183], [16.311, 48.183]], landuseClass: 'grass' },
    ];
    const mesh = buildLandcoverMesh(features, BBOX, flat);
    expect(mesh.stats.patches).toBe(0);
    expect(mesh.classes).toHaveLength(0);
  });
});
