import { bboxExtentMetres } from '../terrain/mesh';
import type { BBox4326 } from '../bbox/validate';

/**
 * Footprint extrusion: polygon rings in EPSG:4326 → a solid mesh in the same
 * local metric frame the terrain uses.
 *
 * Deliberately source-agnostic. OSM ways and an INSPIRE `BU.Building` WFS
 * response both reduce to "a ring plus a height", so the adapter that fetches
 * them is the only thing that differs.
 */

/** A single footprint: outer ring only, in lon/lat degrees. */
export type Footprint = {
  /** Closed or open ring; a repeated final vertex is tolerated. */
  ring: readonly (readonly [number, number])[];
  /** Metres above the terrain surface. */
  heightM: number;
};

export type BuildingMesh = {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
  stats: { footprints: number; vertices: number; triangles: number };
};

const EMPTY: BuildingMesh = {
  positions: new Float32Array(0),
  normals: new Float32Array(0),
  indices: new Uint32Array(0),
  stats: { footprints: 0, vertices: 0, triangles: 0 },
};

type Vec2 = { x: number; z: number };

function signedArea(ring: readonly Vec2[]): number {
  let sum = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    sum += (ring[j].x - ring[i].x) * (ring[j].z + ring[i].z);
  }
  return sum / 2;
}

function pointInTriangle(
  px: number, pz: number,
  ax: number, az: number,
  bx: number, bz: number,
  cx: number, cz: number,
): boolean {
  const d1 = (px - bx) * (az - bz) - (ax - bx) * (pz - bz);
  const d2 = (px - cx) * (bz - cz) - (bx - cx) * (pz - cz);
  const d3 = (px - ax) * (cz - az) - (cx - ax) * (pz - az);
  const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
  const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(hasNeg && hasPos);
}

/**
 * Ear-clipping triangulation of a simple polygon.
 * Returns index triplets into `ring`. Degenerate input yields an empty list
 * rather than throwing, so one bad footprint cannot break a whole tile.
 */
export function triangulate(ring: readonly Vec2[]): number[] {
  const count = ring.length;
  if (count < 3) return [];

  // Work counter-clockwise so the ear test has a consistent orientation.
  const order = signedArea(ring) > 0
    ? Array.from({ length: count }, (_, i) => i)
    : Array.from({ length: count }, (_, i) => count - 1 - i);

  const remaining = [...order];
  const triangles: number[] = [];
  let guard = remaining.length * remaining.length;

  while (remaining.length > 3 && guard-- > 0) {
    let clipped = false;

    for (let i = 0; i < remaining.length; i += 1) {
      const prev = remaining[(i + remaining.length - 1) % remaining.length];
      const curr = remaining[i];
      const next = remaining[(i + 1) % remaining.length];
      const a = ring[prev];
      const b = ring[curr];
      const c = ring[next];

      // Convex vertex test.
      const cross = (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x);
      if (cross <= 0) continue;

      // No other vertex may lie inside the candidate ear.
      let contains = false;
      for (const index of remaining) {
        if (index === prev || index === curr || index === next) continue;
        const p = ring[index];
        if (pointInTriangle(p.x, p.z, a.x, a.z, b.x, b.z, c.x, c.z)) {
          contains = true;
          break;
        }
      }
      if (contains) continue;

      triangles.push(prev, curr, next);
      remaining.splice(i, 1);
      clipped = true;
      break;
    }

    if (!clipped) return triangles; // Self-intersecting: keep what we have.
  }

  if (remaining.length === 3) {
    triangles.push(remaining[0], remaining[1], remaining[2]);
  }
  return triangles;
}

export type LocalPoint = Vec2;

/** Project lon/lat onto the same centred metric frame the terrain mesh uses. */
export function projector(bbox: BBox4326): (lon: number, lat: number) => Vec2 {
  const [west, south, east, north] = bbox;
  const { widthM, depthM } = bboxExtentMetres(bbox);
  return (lon, lat) => ({
    x: ((lon - west) / (east - west)) * widthM - widthM / 2,
    z: ((north - lat) / (north - south)) * depthM - depthM / 2,
  });
}

/**
 * Build extruded solids for a set of footprints.
 *
 * @param sampleGround Terrain elevation at a point in the local frame, so a
 *   building sits on the hillside instead of floating at datum zero.
 */
export function extrudeFootprints(
  footprints: readonly Footprint[],
  bbox: BBox4326,
  sampleGround: (x: number, z: number) => number,
): BuildingMesh {
  if (footprints.length === 0) return EMPTY;

  const project = projector(bbox);
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  let used = 0;

  for (const footprint of footprints) {
    if (!Number.isFinite(footprint.heightM) || footprint.heightM <= 0) continue;

    const ring: Vec2[] = [];
    for (const [lon, lat] of footprint.ring) {
      if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
      const point = project(lon, lat);
      // Drop a duplicated closing vertex.
      const last = ring[ring.length - 1];
      if (last && Math.abs(last.x - point.x) < 1e-6 && Math.abs(last.z - point.z) < 1e-6) continue;
      ring.push(point);
    }
    // A ring is usually closed by repeating the first vertex last; the walls
    // already wrap, so carrying it would emit a zero-length edge.
    if (ring.length > 1) {
      const first = ring[0];
      const last = ring[ring.length - 1];
      if (Math.abs(first.x - last.x) < 1e-6 && Math.abs(first.z - last.z) < 1e-6) {
        ring.pop();
      }
    }
    if (ring.length < 3) continue;

    const triangles = triangulate(ring);
    if (triangles.length === 0) continue;

    // One ground height per building keeps walls vertical and avoids shearing.
    let ground = 0;
    for (const point of ring) ground += sampleGround(point.x, point.z);
    ground /= ring.length;
    const top = ground + footprint.heightM;

    // Roof cap.
    const roofBase = positions.length / 3;
    for (const point of ring) {
      positions.push(point.x, top, point.z);
      normals.push(0, 1, 0);
    }
    for (let i = 0; i < triangles.length; i += 3) {
      indices.push(roofBase + triangles[i], roofBase + triangles[i + 1], roofBase + triangles[i + 2]);
    }

    // Walls: an independent quad per edge so each gets a flat normal.
    for (let i = 0; i < ring.length; i += 1) {
      const a = ring[i];
      const b = ring[(i + 1) % ring.length];
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const length = Math.hypot(dx, dz) || 1;
      const nx = dz / length;
      const nz = -dx / length;

      const base = positions.length / 3;
      positions.push(a.x, ground, a.z, b.x, ground, b.z, b.x, top, b.z, a.x, top, a.z);
      for (let n = 0; n < 4; n += 1) normals.push(nx, 0, nz);
      indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }

    used += 1;
  }

  if (used === 0) return EMPTY;

  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    indices: new Uint32Array(indices),
    stats: {
      footprints: used,
      vertices: positions.length / 3,
      triangles: indices.length / 3,
    },
  };
}
