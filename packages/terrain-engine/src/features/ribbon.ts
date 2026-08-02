import { projector } from '../buildings/extrude';
import {
  assertGroundSampler,
  type GroundSampler,
  type SurfaceDisclosure,
} from '../buildings/ground';
import { ROAD_WIDTH_M, type RoadFeature } from './types';
import type { BBox4326 } from '../bbox/validate';

/**
 * Roads as ribbons draped on the terrain.
 *
 * Each segment becomes its own quad rather than a mitred polyline: joins are
 * visually negligible at these widths, and independent quads keep the geometry
 * trivially correct on steep ground where a shared join would tear.
 *
 * A ribbon is draped, so it inherits whatever the sampled surface is. On bare
 * earth that is the street. On a DSM it is the roofline the street runs
 * between, which is the same defect as the building double-count and gets the
 * same treatment — the identical `GroundSampler` gate, no per-layer exception.
 * Fixing buildings and leaving roads floating would be half a fix.
 */

export type RoadMesh = {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
  stats: { roads: number; segments: number; triangles: number };
  /** What these ribbons are draped over. Mandatory, same rule as buildings. */
  surface: SurfaceDisclosure;
};

function emptyMesh(surface: SurfaceDisclosure): RoadMesh {
  return {
    positions: new Float32Array(0),
    normals: new Float32Array(0),
    indices: new Uint32Array(0),
    stats: { roads: 0, segments: 0, triangles: 0 },
    surface,
  };
}

/** Lift above the surface so ribbons never z-fight with the terrain. */
export const ROAD_DRAPE_OFFSET_M = 1.5;

/** A centre line with its rendered width — the shape both roads and waterways reduce to. */
export type RibbonLine = {
  line: readonly (readonly [number, number])[];
  widthM: number;
};

export function buildRibbonMesh(
  lines: readonly RibbonLine[],
  bbox: BBox4326,
  ground: GroundSampler,
  verticalScale = 1,
  liftM = ROAD_DRAPE_OFFSET_M,
): RoadMesh {
  const sampler = assertGroundSampler(ground, 'buildRibbonMesh');
  const sampleGround = sampler.sample;
  if (lines.length === 0) return emptyMesh(sampler.surface);

  const project = projector(bbox);
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  let usedRoads = 0;
  let segments = 0;
  const lift = liftM * verticalScale;

  for (const ribbon of lines) {
    const points = ribbon.line
      .filter(([lon, lat]) => Number.isFinite(lon) && Number.isFinite(lat))
      .map(([lon, lat]) => project(lon, lat));
    if (points.length < 2) continue;

    const halfWidth = ribbon.widthM / 2;
    let emitted = false;

    for (let i = 0; i < points.length - 1; i += 1) {
      const a = points[i];
      const b = points[i + 1];
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const length = Math.hypot(dx, dz);
      if (length < 1e-6) continue;

      // Perpendicular in the ground plane.
      const px = (-dz / length) * halfWidth;
      const pz = (dx / length) * halfWidth;

      const ay = sampleGround(a.x, a.z) + lift;
      const by = sampleGround(b.x, b.z) + lift;

      const base = positions.length / 3;
      positions.push(
        a.x - px, ay, a.z - pz,
        a.x + px, ay, a.z + pz,
        b.x + px, by, b.z + pz,
        b.x - px, by, b.z - pz,
      );
      for (let n = 0; n < 4; n += 1) normals.push(0, 1, 0);
      indices.push(base, base + 1, base + 2, base, base + 2, base + 3);

      segments += 1;
      emitted = true;
    }

    if (emitted) usedRoads += 1;
  }

  if (segments === 0) return emptyMesh(sampler.surface);

  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    indices: new Uint32Array(indices),
    stats: { roads: usedRoads, segments, triangles: indices.length / 3 },
    surface: sampler.surface,
  };
}

export function buildRoadMesh(
  roads: readonly RoadFeature[],
  bbox: BBox4326,
  ground: GroundSampler,
  verticalScale = 1,
): RoadMesh {
  return buildRibbonMesh(
    roads.map((road) => ({ line: road.line, widthM: ROAD_WIDTH_M[road.roadClass] ?? 4 })),
    bbox,
    ground,
    verticalScale,
  );
}
