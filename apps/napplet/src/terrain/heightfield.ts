import { decodeTerrarium, latToTileY, lonToTileX, type DemTileId } from './dem';
import type { BBox4326 } from '../bbox/validate';

export type DemTileRaster = DemTileId & {
  /** RGBA bytes, `size * size * 4`. */
  data: Uint8ClampedArray;
  size: number;
};

export type Heightfield = {
  /** Row-major, `gridN * gridN`. Row 0 is the northern edge. Metres above sea level. */
  heights: Float32Array;
  gridN: number;
  minM: number;
  maxM: number;
};

/**
 * Resample decoded DEM tiles onto a regular lon/lat grid over the bbox.
 * Bilinear, with pixel coordinates clamped to the loaded tile extent so edge
 * samples never read outside the fetched data.
 */
export function sampleHeightfield(
  bbox: BBox4326,
  zoom: number,
  tiles: readonly DemTileRaster[],
  gridN: number,
): Heightfield {
  if (!Number.isInteger(gridN) || gridN < 2) {
    throw new RangeError('Heightfield grid must be an integer of at least 2.');
  }
  if (tiles.length === 0) {
    throw new RangeError('Heightfield sampling requires at least one DEM tile.');
  }

  const size = tiles[0].size;
  const lookup = new Map<string, DemTileRaster>();
  let minTileX = Infinity;
  let maxTileX = -Infinity;
  let minTileY = Infinity;
  let maxTileY = -Infinity;

  for (const tile of tiles) {
    lookup.set(`${tile.x}/${tile.y}`, tile);
    minTileX = Math.min(minTileX, tile.x);
    maxTileX = Math.max(maxTileX, tile.x);
    minTileY = Math.min(minTileY, tile.y);
    maxTileY = Math.max(maxTileY, tile.y);
  }

  const minPx = minTileX * size;
  const maxPx = (maxTileX + 1) * size - 1;
  const minPy = minTileY * size;
  const maxPy = (maxTileY + 1) * size - 1;

  const samplePixel = (px: number, py: number): number => {
    const cx = Math.min(maxPx, Math.max(minPx, px));
    const cy = Math.min(maxPy, Math.max(minPy, py));
    const tileX = Math.floor(cx / size);
    const tileY = Math.floor(cy / size);
    const tile = lookup.get(`${tileX}/${tileY}`);
    if (!tile) return 0;
    const localX = cx - tileX * size;
    const localY = cy - tileY * size;
    const offset = (localY * size + localX) * 4;
    return decodeTerrarium(tile.data[offset], tile.data[offset + 1], tile.data[offset + 2]);
  };

  const [west, south, east, north] = bbox;
  const heights = new Float32Array(gridN * gridN);
  let minM = Infinity;
  let maxM = -Infinity;

  for (let row = 0; row < gridN; row += 1) {
    const lat = north - ((north - south) * row) / (gridN - 1);
    const globalY = latToTileY(lat, zoom) * size;
    const y0 = Math.floor(globalY - 0.5);
    const fy = globalY - 0.5 - y0;

    for (let col = 0; col < gridN; col += 1) {
      const lon = west + ((east - west) * col) / (gridN - 1);
      const globalX = lonToTileX(lon, zoom) * size;
      const x0 = Math.floor(globalX - 0.5);
      const fx = globalX - 0.5 - x0;

      const h00 = samplePixel(x0, y0);
      const h10 = samplePixel(x0 + 1, y0);
      const h01 = samplePixel(x0, y0 + 1);
      const h11 = samplePixel(x0 + 1, y0 + 1);

      const top = h00 + (h10 - h00) * fx;
      const bottom = h01 + (h11 - h01) * fx;
      const height = top + (bottom - top) * fy;

      heights[row * gridN + col] = height;
      if (height < minM) minM = height;
      if (height > maxM) maxM = height;
    }
  }

  return { heights, gridN, minM, maxM };
}
