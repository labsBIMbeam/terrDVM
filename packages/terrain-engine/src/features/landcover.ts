import { projector, triangulate, type LocalPoint } from '../buildings/extrude';
import {
  assertGroundSampler,
  type GroundSampler,
  type SurfaceDisclosure,
} from '../buildings/ground';
import type { LanduseClass, LanduseFeature } from './types';
import type { BBox4326 } from '../bbox/validate';

/**
 * Land-cover drape: the landuse polygons the OSM fetch already delivers,
 * rendered as flat colour patches on the terrain — forests, meadows, water.
 *
 * One mesh per class so the single-colour shader path draws each with its own
 * override colour. Zone classes (residential, industrial, …) are deliberately
 * not drawn: painting whole districts over the orthophoto hides more than it
 * says.
 *
 * Draped, therefore subject to the same surface rule as roads and buildings —
 * on a DSM a park patch sits at canopy height and a water surface at whatever
 * the radar saw. Same `GroundSampler` gate, same disclosure; see
 * `../buildings/ground.ts`.
 */

export const LANDCOVER_COLORS: Partial<
  Record<LanduseClass, readonly [number, number, number]>
> = {
  forest: [0.13, 0.3, 0.14],
  grass: [0.25, 0.48, 0.2],
  meadow: [0.3, 0.52, 0.24],
  scrub: [0.33, 0.42, 0.22],
  heath: [0.42, 0.42, 0.26],
  farmland: [0.54, 0.48, 0.26],
  orchard: [0.28, 0.44, 0.2],
  vineyard: [0.3, 0.42, 0.18],
  wetland: [0.18, 0.34, 0.28],
  water: [0.11, 0.28, 0.4],
  bare_rock: [0.42, 0.4, 0.37],
};

/** Above the terrain, below the road ribbons. */
const LIFT_M = 0.25;

export type LandcoverClassMesh = {
  landuseClass: LanduseClass;
  color: readonly [number, number, number];
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
};

export type LandcoverMesh = {
  classes: LandcoverClassMesh[];
  stats: { patches: number; triangles: number };
  /** What these patches are draped over. Mandatory, same rule as buildings. */
  surface: SurfaceDisclosure;
};

type Bucket = {
  positions: number[];
  normals: number[];
  indices: number[];
};

export function buildLandcoverMesh(
  features: readonly LanduseFeature[],
  bbox: BBox4326,
  ground: GroundSampler,
  exaggeration = 1,
): LandcoverMesh {
  const sampler = assertGroundSampler(ground, 'buildLandcoverMesh');
  const sampleGround = sampler.sample;
  const project = projector(bbox);
  const lift = LIFT_M * exaggeration;
  const buckets = new Map<LanduseClass, Bucket>();
  let patches = 0;

  for (const feature of features) {
    if (!LANDCOVER_COLORS[feature.landuseClass]) continue;

    const ring: LocalPoint[] = [];
    for (const [lon, lat] of feature.ring) {
      if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
      const point = project(lon, lat);
      const last = ring[ring.length - 1];
      if (last && Math.abs(last.x - point.x) < 1e-6 && Math.abs(last.z - point.z) < 1e-6) {
        continue;
      }
      ring.push(point);
    }
    if (ring.length > 1) {
      const first = ring[0];
      const last = ring[ring.length - 1];
      if (Math.abs(first.x - last.x) < 1e-6 && Math.abs(first.z - last.z) < 1e-6) ring.pop();
    }
    if (ring.length < 3) continue;

    const triangles = triangulate(ring);
    if (triangles.length === 0) continue;

    let bucket = buckets.get(feature.landuseClass);
    if (!bucket) {
      bucket = { positions: [], normals: [], indices: [] };
      buckets.set(feature.landuseClass, bucket);
    }

    // Per-vertex ground sampling drapes the patch over the relief.
    const base = bucket.positions.length / 3;
    for (const point of ring) {
      bucket.positions.push(point.x, sampleGround(point.x, point.z) + lift, point.z);
      bucket.normals.push(0, 1, 0);
    }
    for (let i = 0; i < triangles.length; i += 3) {
      bucket.indices.push(base + triangles[i], base + triangles[i + 1], base + triangles[i + 2]);
    }
    patches += 1;
  }

  const classes: LandcoverClassMesh[] = [];
  let triangleCount = 0;
  for (const [landuseClass, bucket] of buckets) {
    const color = LANDCOVER_COLORS[landuseClass];
    if (!color || bucket.indices.length === 0) continue;
    triangleCount += bucket.indices.length / 3;
    classes.push({
      landuseClass,
      color,
      positions: new Float32Array(bucket.positions),
      normals: new Float32Array(bucket.normals),
      indices: new Uint32Array(bucket.indices),
    });
  }

  return { classes, stats: { patches, triangles: triangleCount }, surface: sampler.surface };
}
