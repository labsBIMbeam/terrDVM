import type { Heightfield } from './heightfield';
import type { BBox4326 } from '../bbox/validate';

const METRES_PER_DEGREE_LAT = 111_320;

export type TerrainMeshStats = {
  gridN: number;
  vertices: number;
  triangles: number;
  minElevationM: number;
  maxElevationM: number;
  widthM: number;
  depthM: number;
};

export type TerrainMesh = {
  /** xyz per vertex in metres, centred on the origin, +Y up, north at −Z. */
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
  stats: TerrainMeshStats;
};

/** Ground extent of a bbox in metres, using an equirectangular approximation at its mid-latitude. */
export function bboxExtentMetres(bbox: BBox4326): { widthM: number; depthM: number } {
  const [west, south, east, north] = bbox;
  const meanLat = ((south + north) / 2) * (Math.PI / 180);
  return {
    widthM: (east - west) * METRES_PER_DEGREE_LAT * Math.cos(meanLat),
    depthM: (north - south) * METRES_PER_DEGREE_LAT,
  };
}

/**
 * Turn a sampled heightfield into a renderable triangle mesh.
 * Vertical datum is shifted so the lowest sample sits at y = 0.
 */
export function buildTerrainMesh(
  field: Heightfield,
  bbox: BBox4326,
  exaggeration = 1,
): TerrainMesh {
  const { heights, gridN, minM, maxM } = field;
  if (!Number.isFinite(exaggeration) || exaggeration <= 0) {
    throw new RangeError('Vertical exaggeration must be finite and positive.');
  }

  const { widthM, depthM } = bboxExtentMetres(bbox);
  const vertexCount = gridN * gridN;
  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  const indices = new Uint32Array((gridN - 1) * (gridN - 1) * 6);

  const stepX = widthM / (gridN - 1);
  const stepZ = depthM / (gridN - 1);

  for (let row = 0; row < gridN; row += 1) {
    for (let col = 0; col < gridN; col += 1) {
      const vertex = row * gridN + col;
      const offset = vertex * 3;
      positions[offset] = -widthM / 2 + stepX * col;
      positions[offset + 1] = (heights[vertex] - minM) * exaggeration;
      positions[offset + 2] = -depthM / 2 + stepZ * row;

      // Central differences on the heightfield, clamped at the borders.
      const left = heights[row * gridN + Math.max(0, col - 1)];
      const right = heights[row * gridN + Math.min(gridN - 1, col + 1)];
      const up = heights[Math.max(0, row - 1) * gridN + col];
      const down = heights[Math.min(gridN - 1, row + 1) * gridN + col];

      const spanX = (Math.min(gridN - 1, col + 1) - Math.max(0, col - 1)) * stepX;
      const spanZ = (Math.min(gridN - 1, row + 1) - Math.max(0, row - 1)) * stepZ;
      const dhdx = spanX > 0 ? ((right - left) / spanX) * exaggeration : 0;
      const dhdz = spanZ > 0 ? ((down - up) / spanZ) * exaggeration : 0;

      const nx = -dhdx;
      const ny = 1;
      const nz = -dhdz;
      const length = Math.hypot(nx, ny, nz) || 1;
      normals[offset] = nx / length;
      normals[offset + 1] = ny / length;
      normals[offset + 2] = nz / length;
    }
  }

  let cursor = 0;
  for (let row = 0; row < gridN - 1; row += 1) {
    for (let col = 0; col < gridN - 1; col += 1) {
      const a = row * gridN + col;
      const b = a + 1;
      const c = a + gridN;
      const d = c + 1;
      // Counter-clockwise seen from above (+Y).
      indices[cursor] = a;
      indices[cursor + 1] = c;
      indices[cursor + 2] = b;
      indices[cursor + 3] = b;
      indices[cursor + 4] = c;
      indices[cursor + 5] = d;
      cursor += 6;
    }
  }

  return {
    positions,
    normals,
    indices,
    stats: {
      gridN,
      vertices: vertexCount,
      triangles: indices.length / 3,
      minElevationM: minM,
      maxElevationM: maxM,
      widthM,
      depthM,
    },
  };
}
