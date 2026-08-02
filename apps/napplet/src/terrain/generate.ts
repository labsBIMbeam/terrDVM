import {
  COLLECTION_SERVICE,
  cachedDemTileUrl,
  isApprovedCachedDemUrl,
  loadBytesCacheFirst,
} from '../job/collection';
import { chooseDemZoom, demTilesForBBox } from '@terrcvm/terrain-engine/terrain/dem';
import {
  type ElevationSource,
  elevationTileUrl,
  isApprovedElevationUrl,
  selectElevationSources,
} from '@terrcvm/terrain-engine/terrain/elevation-sources';
import { sampleHeightfield, type DemTileRaster } from '@terrcvm/terrain-engine/terrain/heightfield';
import { buildTerrainMesh, type TerrainMesh } from '@terrcvm/terrain-engine/terrain/mesh';
import type { BBox4326 } from '@terrcvm/terrain-engine/bbox/validate';

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
  /** Region id — decides the source chain. Omitted means Terrarium only. */
  region?: string;
  /** Explicit chain, for tests and for pinning a source deliberately. */
  sources?: readonly ElevationSource[];
};

/** Where a source's tiles are fetched from, and what URL shape is allowed. */
function tileAccess(source: ElevationSource, z: number, x: number, y: number) {
  if (source.delivery === 'transcoded') {
    // No third-party fallback exists for these: the national coverage is a
    // GeoTIFF in a projected CRS that this browser cannot read. The collection
    // server is the only route, so both attempts point at it and a server that
    // is not running demotes the whole source rather than silently degrading.
    const url = elevationTileUrl(source, z, x, y, COLLECTION_SERVICE.baseUrl);
    const isAllowed = (candidate: string) =>
      isApprovedElevationUrl(candidate, source, COLLECTION_SERVICE.baseUrl);
    return { cacheUrl: url, isCacheAllowed: isAllowed, directUrl: url, isDirectAllowed: isAllowed };
  }
  return {
    cacheUrl: cachedDemTileUrl(z, x, y),
    isCacheAllowed: isApprovedCachedDemUrl,
    directUrl: elevationTileUrl(source, z, x, y),
    isDirectAllowed: (candidate: string) => isApprovedElevationUrl(candidate, source),
  };
}

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
 * Build the terrain from one named source.
 *
 * Every byte goes through `loadApprovedBytes`, so a capability-denied shell
 * fails closed here exactly as it does for basemap and imagery tiles. Tiles are
 * Terrarium-encoded whichever source they came from — the national DTMs are
 * transcoded into that encoding server-side precisely so that this function,
 * `decodeTerrarium` and `sampleHeightfield` stay single-implementation.
 */
export async function generateTerrainFrom(
  bbox: BBox4326,
  source: ElevationSource,
  { signal, onProgress, gridN = TERRAIN_GRID_N, exaggeration = TERRAIN_EXAGGERATION }: GenerateTerrainOptions = {},
): Promise<TerrainMesh> {
  const requestedZoom = chooseDemZoom(bbox, gridN, source);
  const { zoom, tiles } = demTilesForBBox(bbox, requestedZoom, source);

  let loaded = 0;
  onProgress?.({ phase: 'fetching', loaded, total: tiles.length });

  const rasters: DemTileRaster[] = await Promise.all(
    tiles.map(async (tile) => {
      // Collection-server cache first, the upstream as fallback — reruns come
      // from disk and, for a direct source, a missing server changes nothing.
      const access = tileAccess(source, tile.z, tile.x, tile.y);
      const blob = await loadBytesCacheFirst(
        access.cacheUrl,
        access.isCacheAllowed,
        access.directUrl,
        {
          deadlineMs: source.timeoutMs,
          isAllowed: access.isDirectAllowed,
          signal,
        },
      );
      if (blob.size > source.maxResponseBytes) {
        throw new Error(`${source.id} tile exceeded the approved response-size bound.`);
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

/**
 * Demo terrain processor: best available elevation source for the region, with
 * Terrarium as the last resort.
 *
 * Walks the chain the same way `texture.fetch_texture` walks `REGION_SOURCES`:
 * try the best source, and on failure fall through to the next rather than
 * failing the job. The failure that matters in practice is a transcoded
 * national source with no collection server running — which must demote to
 * 30 m Terrarium, not to nothing and not to a fabricated surface. An abort is
 * re-thrown immediately: a cancelled job is not a source failure.
 */
export async function generateTerrain(
  bbox: BBox4326,
  options: GenerateTerrainOptions = {},
): Promise<TerrainMesh> {
  const chain = options.sources ?? selectElevationSources(options.region ?? null, bbox);
  const failures: string[] = [];

  for (const source of chain) {
    try {
      return await generateTerrainFrom(bbox, source, options);
    } catch (error) {
      if (options.signal?.aborted || (error as Error)?.name === 'AbortError') throw error;
      failures.push(`${source.id}: ${(error as Error)?.message ?? String(error)}`);
    }
  }
  throw new Error(`No elevation source produced terrain — ${failures.join('; ')}`);
}
