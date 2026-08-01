import type { BBox4326 } from '../bbox/validate';

/**
 * Elevation source for the demo terrain processor.
 *
 * Deliberately NOT part of `config/source-policy.json`: that file carries the
 * phase-01 audited basemap/imagery contract and its verifier requires exactly
 * those two roles, cross-checked against recorded evidence. This DEM is a
 * demo-stage source that has not been through the same live audit, so it is
 * declared separately — but it is held to the same origin/template discipline
 * and is fetched through the shell resource capability like every other byte.
 */
export const DEM_SOURCE = {
  scheme: 'https',
  host: 's3.amazonaws.com',
  port: 443,
  pathTemplate: '/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png',
  encoding: 'terrarium',
  format: 'image/png',
  attribution:
    'Elevation: Mapzen Terrain Tiles via AWS Open Data (SRTM, GMTED2010, NED)',
  maxResponseBytes: 1_000_000,
  timeoutMs: 15_000,
  tileSize: 256,
  minZoom: 8,
  maxZoom: 14,
} as const;

/** Hard ceiling on tiles per job: this demo requests visible extent only, never bulk. */
export const MAX_DEM_TILES = 16;

export type DemTileId = { z: number; x: number; y: number };

const ORIGIN = `${DEM_SOURCE.scheme}://${DEM_SOURCE.host}:${DEM_SOURCE.port}`;

function expectedOrigin(): string {
  return new URL(ORIGIN).origin;
}

/**
 * Terrarium encoding: elevation in metres = (R * 256 + G + B / 256) - 32768.
 */
export function decodeTerrarium(red: number, green: number, blue: number): number {
  return red * 256 + green + blue / 256 - 32768;
}

export function lonToTileX(lon: number, zoom: number): number {
  return ((lon + 180) / 360) * 2 ** zoom;
}

export function latToTileY(lat: number, zoom: number): number {
  const radians = (lat * Math.PI) / 180;
  return ((1 - Math.asinh(Math.tan(radians)) / Math.PI) / 2) * 2 ** zoom;
}

export function tileXToLon(x: number, zoom: number): number {
  return (x / 2 ** zoom) * 360 - 180;
}

export function tileYToLat(y: number, zoom: number): number {
  const n = Math.PI * (1 - (2 * y) / 2 ** zoom);
  return (Math.atan(Math.sinh(n)) * 180) / Math.PI;
}

/** Pick the shallowest zoom that still gives at least `targetPx` DEM samples across the bbox. */
export function chooseDemZoom(bbox: BBox4326, targetPx: number): number {
  const [west, , east] = bbox;
  const spanFraction = (east - west) / 360;
  if (!Number.isFinite(spanFraction) || spanFraction <= 0) {
    throw new RangeError('DEM zoom requires a positive longitude span.');
  }
  const ideal = Math.log2(targetPx / (DEM_SOURCE.tileSize * spanFraction));
  const zoom = Math.ceil(ideal);
  return Math.min(DEM_SOURCE.maxZoom, Math.max(DEM_SOURCE.minZoom, zoom));
}

/**
 * Tiles covering the bbox at `zoom`, coarsening automatically rather than ever
 * exceeding MAX_DEM_TILES.
 */
export function demTilesForBBox(bbox: BBox4326, zoom: number): { zoom: number; tiles: DemTileId[] } {
  const [west, south, east, north] = bbox;

  for (let z = zoom; z >= DEM_SOURCE.minZoom; z -= 1) {
    const minX = Math.floor(lonToTileX(west, z));
    const maxX = Math.floor(lonToTileX(east, z));
    const minY = Math.floor(latToTileY(north, z));
    const maxY = Math.floor(latToTileY(south, z));
    const count = (maxX - minX + 1) * (maxY - minY + 1);

    if (count <= MAX_DEM_TILES || z === DEM_SOURCE.minZoom) {
      const tiles: DemTileId[] = [];
      for (let x = minX; x <= maxX; x += 1) {
        for (let y = minY; y <= maxY; y += 1) {
          tiles.push({ z, x, y });
        }
      }
      return { zoom: z, tiles };
    }
  }

  throw new RangeError('No DEM zoom satisfies the tile budget for this bounding box.');
}

export function demTileUrl(z: number, x: number, y: number): string {
  if (![z, x, y].every((value) => Number.isSafeInteger(value) && value >= 0)) {
    throw new RangeError('DEM tile coordinates must be non-negative safe integers.');
  }
  if (z < DEM_SOURCE.minZoom || z > DEM_SOURCE.maxZoom) {
    throw new RangeError('DEM tile zoom is outside the approved range.');
  }
  const path = DEM_SOURCE.pathTemplate
    .replace('{z}', String(z))
    .replace('{x}', String(x))
    .replace('{y}', String(y));
  return `${expectedOrigin()}${path}`;
}

const DEM_PATH_PATTERN = new RegExp(
  `^${DEM_SOURCE.pathTemplate
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\\\{[zxy]\\\}/g, '[0-9]+')}$`,
);

/** Fail-closed allowlist used by the shell resource client. */
export function isApprovedDemUrl(candidate: string): boolean {
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return false;
  }
  if (url.origin !== expectedOrigin()) return false;
  if (url.search || url.hash || url.username || url.password) return false;
  return DEM_PATH_PATTERN.test(url.pathname);
}
