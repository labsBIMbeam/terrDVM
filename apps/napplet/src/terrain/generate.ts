import { loadApprovedBytes } from '../shell/resource-client';
import { DEM_SOURCE, chooseDemZoom, demTileUrl, demTilesForBBox, isApprovedDemUrl } from './dem';
import { sampleHeightfield, type DemTileRaster } from './heightfield';
import { buildTerrainMesh, type TerrainMesh } from './mesh';
import type { BBox4326 } from '../bbox/validate';

/** Preview grid density. 192² keeps the mesh under ~74k triangles. */
export const TERRAIN_GRID_N = 192;

/** Madeira is steep; a mild lift reads better than true scale at this extent. */
export const TERRAIN_EXAGGERATION = 1.5;

export type TerrainPhase = 'fetching' | 'sampling' | 'meshing';

export type TerrainProgress = {
  phase: TerrainPhase;
  loaded: number;
  total: number;
};

export type GenerateTerrainOptions = {
  signal?: AbortSignal;
  onProgress?: (progress: TerrainProgress) => void;
  gridN?: number;
  exaggeration?: number;
};

type DecodedRaster = { data: Uint8ClampedArray; size: number };

async function decodeRaster(blob: Blob): Promise<DecodedRaster> {
  const bitmap = await createImageBitmap(blob);
  try {
    const { width, height } = bitmap;
    if (width !== height) {
      throw new Error('DEM tile is not square.');
    }

    const context =
      typeof OffscreenCanvas === 'function'
        ? new OffscreenCanvas(width, height).getContext('2d', { willReadFrequently: true })
        : (() => {
            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            return canvas.getContext('2d', { willReadFrequently: true });
          })();

    if (!context) {
      throw new Error('A 2D canvas context is required to decode DEM tiles.');
    }

    context.drawImage(bitmap, 0, 0);
    const imageData = context.getImageData(0, 0, width, height);
    return { data: imageData.data, size: width };
  } finally {
    bitmap.close();
  }
}

/**
 * Demo terrain processor: fetch the DEM tiles covering the selection through the
 * shell resource capability, resample them onto a regular grid, and mesh it.
 *
 * Every byte goes through `loadApprovedBytes`, so a capability-denied shell
 * fails closed here exactly as it does for basemap and imagery tiles.
 */
export async function generateTerrain(
  bbox: BBox4326,
  { signal, onProgress, gridN = TERRAIN_GRID_N, exaggeration = TERRAIN_EXAGGERATION }: GenerateTerrainOptions = {},
): Promise<TerrainMesh> {
  const requestedZoom = chooseDemZoom(bbox, gridN);
  const { zoom, tiles } = demTilesForBBox(bbox, requestedZoom);

  let loaded = 0;
  onProgress?.({ phase: 'fetching', loaded, total: tiles.length });

  const rasters: DemTileRaster[] = await Promise.all(
    tiles.map(async (tile) => {
      const url = demTileUrl(tile.z, tile.x, tile.y);
      const blob = await loadApprovedBytes(url, {
        deadlineMs: DEM_SOURCE.timeoutMs,
        isAllowed: isApprovedDemUrl,
        signal,
      });
      if (blob.size > DEM_SOURCE.maxResponseBytes) {
        throw new Error('DEM tile exceeded the approved response-size bound.');
      }
      const { data, size } = await decodeRaster(blob);
      loaded += 1;
      onProgress?.({ phase: 'fetching', loaded, total: tiles.length });
      return { ...tile, data, size };
    }),
  );

  if (signal?.aborted) {
    throw new DOMException('Terrain generation aborted.', 'AbortError');
  }

  onProgress?.({ phase: 'sampling', loaded: tiles.length, total: tiles.length });
  const field = sampleHeightfield(bbox, zoom, rasters, gridN);

  onProgress?.({ phase: 'meshing', loaded: tiles.length, total: tiles.length });
  return buildTerrainMesh(field, bbox, exaggeration);
}
