/**
 * Corpus bytes into a renderable scene — and nothing else.
 *
 * This module deliberately does NOT import `@terrcvm/napplet-kit/scene/*` or
 * `terrain/generate`. Those reach upstream (Terrarium, Overpass, the ortho
 * bake) by design, and importing them would put `fetch(` in this artifact even
 * on a path never taken — which `verify-dist.mjs` rejects, and which would
 * quietly falsify the one observable the whole slice rests on: during a corpus
 * render the network log shows the relay and the blossom host, nothing else.
 *
 * So the engine primitives are used directly. The engine is transport-free by
 * construction, which is what makes that safe.
 */

import { decodeFeatureTile } from '@terrcvm/terrain-engine/features/codec';
import { buildLandcoverMesh, type LandcoverMesh } from '@terrcvm/terrain-engine/features/landcover';
import { buildRoadMesh, type RoadMesh } from '@terrcvm/terrain-engine/features/ribbon';
import { extrudeFootprints, type BuildingMesh } from '@terrcvm/terrain-engine/buildings/extrude';
import { createGroundSampler, type GroundSampler } from '@terrcvm/terrain-engine/buildings/ground';
import { sampleHeightfield, type DemTileRaster } from '@terrcvm/terrain-engine/terrain/heightfield';
import { buildTerrainMesh, type TerrainMesh } from '@terrcvm/terrain-engine/terrain/mesh';
import type { BBox4326 } from '@terrcvm/terrain-engine/bbox/validate';
import type { FeatureTile } from '@terrcvm/terrain-engine/features/types';
import type { Tile } from '@terrcvm/geo-protocol';

/**
 * No vertical exaggeration.
 *
 * The rest of the app renders at 1.5 because it flatters relief. This napplet
 * exists to show what the corpus actually contains, and a 50 % vertical lie is
 * the wrong opening claim for it — the same reasoning MESH-CALCULATOR.md §5
 * applies to calculator mode.
 */
export const CORPUS_EXAGGERATION = 1;

/** Heightfield resolution, matching the rest of the app's terrain grid. */
export const CORPUS_GRID = 192;

export type CorpusScene = {
  bbox: BBox4326;
  mesh: TerrainMesh;
  buildings?: BuildingMesh;
  roads?: RoadMesh;
  landcover?: LandcoverMesh;
  counts: { buildings: number; roads: number; landuse: number };
};

/**
 * Nearest-vertex ground lookup over the built terrain.
 *
 * A local copy of the kit's sampler for the import reason above. `model` is
 * reported honestly: the corpus DEM is whatever the publisher crawled, this
 * client cannot know whether it is bare earth, and claiming otherwise would
 * fabricate provenance. `'unknown'` makes the engine treat it as harshly as a
 * DSM — geometry still renders, and it renders labelled.
 */
export function corpusGround(mesh: TerrainMesh): GroundSampler {
  const { gridN, widthM, depthM } = mesh.stats;
  const stepX = widthM / (gridN - 1);
  const stepZ = depthM / (gridN - 1);
  return createGroundSampler({
    sample: (x, z) => {
      const col = Math.min(gridN - 1, Math.max(0, Math.round((x + widthM / 2) / stepX)));
      const row = Math.min(gridN - 1, Math.max(0, Math.round((z + depthM / 2) / stepZ)));
      return mesh.positions[(row * gridN + col) * 3 + 1];
    },
    model: 'unknown',
    sourceId: 'corpus',
    onNonBareEarth: 'render-indicative',
  });
}

/**
 * Terrain for the wanted tile, sampled out of whatever DEM tile covers it.
 *
 * `demTile` may be COARSER than `bbox` describes — the corpus keeps DEM at z13
 * and features at z14, so the usual case is a z14 bbox sampled out of its z13
 * parent. `sampleHeightfield` maps the bbox to pixel coordinates at the DEM
 * tile's own zoom and clamps to the loaded extent, so the sub-tile crop is the
 * ordinary path here rather than an edge case.
 */
export function buildCorpusTerrain(
  raster: DemTileRaster,
  bbox: BBox4326,
  gridN: number = CORPUS_GRID,
): TerrainMesh {
  const field = sampleHeightfield(bbox, raster.z, [raster], gridN);
  return buildTerrainMesh(field, bbox, CORPUS_EXAGGERATION);
}

/** Building, road and land-cover meshes from a decoded feature tile. */
export function buildCorpusFeatures(
  features: FeatureTile,
  bbox: BBox4326,
  ground: GroundSampler,
): Pick<CorpusScene, 'buildings' | 'roads' | 'landcover' | 'counts'> {
  const counts = {
    buildings: features.buildings.length,
    roads: features.roads.length,
    landuse: features.landuse.length,
  };

  const buildings =
    features.buildings.length > 0
      ? extrudeFootprints(
          features.buildings.map((building) => ({
            ring: building.ring,
            heightM: building.heightM * CORPUS_EXAGGERATION,
          })),
          bbox,
          ground,
        )
      : undefined;

  const roads =
    features.roads.length > 0
      ? buildRoadMesh(features.roads, bbox, ground, CORPUS_EXAGGERATION)
      : undefined;

  let landcover =
    features.landuse.length > 0
      ? buildLandcoverMesh(features.landuse, bbox, ground, CORPUS_EXAGGERATION)
      : undefined;
  if (landcover !== undefined && landcover.classes.length === 0) landcover = undefined;

  return { buildings, roads, landcover, counts };
}

/**
 * Decode a Terrarium PNG into a raster the heightfield sampler understands.
 *
 * Browser-only — `createImageBitmap` is the decoder. The bytes have already
 * been hash-verified by `loadItemBytes` before they reach here; this function
 * never fetches anything itself.
 */
export async function decodeDemRaster(
  bytes: Uint8Array<ArrayBuffer>,
  tile: Tile,
): Promise<DemTileRaster> {
  const bitmap = await createImageBitmap(new Blob([bytes]));
  try {
    const { width, height } = bitmap;
    if (width !== height) throw new Error('DEM tile is not square.');

    const canvas =
      typeof OffscreenCanvas === 'function'
        ? new OffscreenCanvas(width, height)
        : Object.assign(document.createElement('canvas'), { width, height });
    const context = canvas.getContext('2d', {
      willReadFrequently: true,
    }) as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
    if (context === null) throw new Error('2D canvas is unavailable, so the DEM cannot decode.');

    context.drawImage(bitmap, 0, 0);
    const { data } = context.getImageData(0, 0, width, height);
    return { z: tile.z, x: tile.x, y: tile.y, data, size: width };
  } finally {
    bitmap.close();
  }
}

/** Decode a TFT2 blob. Pure, and identical to what the crawler encoded. */
export function decodeCorpusFeatures(bytes: Uint8Array): FeatureTile {
  return decodeFeatureTile(bytes);
}
