import type { BBox4326 } from '../bbox/validate';

/**
 * The tile-grid contract every elevation source has to satisfy.
 *
 * Deliberately structural and minimal: it is everything the tile maths below
 * needs and nothing else, so `DEM_SOURCE` and the national DTM entries in
 * `elevation-sources.ts` can share one implementation of zoom choice, tile
 * enumeration, URL building and the fail-closed allowlist. The repo has been
 * bitten by two copies of one algorithm drifting apart; this is the seam that
 * keeps there being one.
 */
export type TileEndpoint = {
  readonly pathTemplate: string;
  readonly tileSize: number;
  readonly minZoom: number;
  readonly maxZoom: number;
};

/** A `TileEndpoint` the browser may fetch directly, i.e. one with an origin. */
export type OriginTileEndpoint = TileEndpoint & {
  readonly scheme: string;
  readonly host: string;
  readonly port: number;
};

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
  /**
   * Capped at 13 on purpose — do not raise it back without redoing this
   * derivation, because it is a corpus-size decision, not a quality knob.
   *
   * Terrarium over every region this project targets (Madeira, South Tyrol,
   * Austria) is SRTM/GMTED2010 at 1-arcsec posting. A Web Mercator pixel is
   * 360/(256*2^z) degrees of longitude, so it equals the 1-arcsec source grid
   * at z = log2(1296000/256) = 12.31 on the longitude axis (latitude
   * independent) and at z = 12.31 + log2(cos lat) on the latitude axis —
   * 12.06 at Madeira (32.6N), 11.75 at 47N. Read as ground distance the same
   * result is 32.2 m/px at z12/32.6N and 26.1 m/px at z12/47N against ~30 m
   * posting. Either way z12 is the last zoom that carries source information:
   * z13 oversamples 1.6-2.4x per axis and z14 oversamples 3.2-4.8x, so a z14
   * tile is 16x the bytes of a z12 tile for zero new elevation data (measured:
   * 11.19 MB vs 0.75 MB over Madeira, a 14.8x ratio — under 16x only because
   * finer tiles hold less relief and compress better). The residual cost of
   * dropping z14 is 0.683 m RMS against Mapzen's own resampling of the same
   * source, on terrain with 1400 m of relief.
   *
   * 13 rather than 12 keeps one level of headroom: the cap is global and
   * Terrarium does splice in 8-10 m national sources elsewhere (3DEP, Norway,
   * NZ), for which z13's 13.0 m/px at 47N is roughly native.
   *
   * Nothing downstream needs z14: `chooseDemZoom` clamps here, and
   * `sampleHeightfield` already resamples bilinearly onto an arbitrary grid,
   * so the mesh is unchanged in shape. The cap only binds for selections
   * narrower than ~3.1 km, where the 192-wide mesh grid is finer than the DEM
   * at any zoom anyway.
   */
  maxZoom: 13,
} as const;

/** Hard ceiling on tiles per job: this demo requests visible extent only, never bulk. */
export const MAX_DEM_TILES = 16;

export type DemTileId = { z: number; x: number; y: number };

/** Normalised origin of a directly fetchable endpoint (drops the default port). */
export function endpointOrigin(endpoint: OriginTileEndpoint): string {
  return new URL(`${endpoint.scheme}://${endpoint.host}:${endpoint.port}`).origin;
}

function expectedOrigin(): string {
  return endpointOrigin(DEM_SOURCE);
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

/**
 * Pick the shallowest zoom that still gives at least `targetPx` DEM samples
 * across the bbox, clamped to what `endpoint` actually carries.
 *
 * The clamp is the whole point of passing an endpoint: Terrarium's ceiling of
 * 13 is a statement about SRTM/GMTED posting, and a 1 m national DTM would be
 * thrown away by it.
 */
export function chooseDemZoom(
  bbox: BBox4326,
  targetPx: number,
  endpoint: TileEndpoint = DEM_SOURCE,
): number {
  const [west, , east] = bbox;
  const spanFraction = (east - west) / 360;
  if (!Number.isFinite(spanFraction) || spanFraction <= 0) {
    throw new RangeError('DEM zoom requires a positive longitude span.');
  }
  const ideal = Math.log2(targetPx / (endpoint.tileSize * spanFraction));
  const zoom = Math.ceil(ideal);
  return Math.min(endpoint.maxZoom, Math.max(endpoint.minZoom, zoom));
}

/**
 * Tiles covering the bbox at `zoom`, coarsening automatically rather than ever
 * exceeding MAX_DEM_TILES.
 */
export function demTilesForBBox(
  bbox: BBox4326,
  zoom: number,
  endpoint: TileEndpoint = DEM_SOURCE,
): { zoom: number; tiles: DemTileId[] } {
  const [west, south, east, north] = bbox;

  for (let z = zoom; z >= endpoint.minZoom; z -= 1) {
    const minX = Math.floor(lonToTileX(west, z));
    const maxX = Math.floor(lonToTileX(east, z));
    const minY = Math.floor(latToTileY(north, z));
    const maxY = Math.floor(latToTileY(south, z));
    const count = (maxX - minX + 1) * (maxY - minY + 1);

    if (count <= MAX_DEM_TILES || z === endpoint.minZoom) {
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

/**
 * The path part of a tile URL — origin-free, so a transcoded source served by
 * the collection server and a direct upstream share one implementation.
 */
export function demTilePath(
  z: number,
  x: number,
  y: number,
  endpoint: TileEndpoint = DEM_SOURCE,
): string {
  if (![z, x, y].every((value) => Number.isSafeInteger(value) && value >= 0)) {
    throw new RangeError('DEM tile coordinates must be non-negative safe integers.');
  }
  if (z < endpoint.minZoom || z > endpoint.maxZoom) {
    throw new RangeError('DEM tile zoom is outside the approved range.');
  }
  return endpoint.pathTemplate
    .replace('{z}', String(z))
    .replace('{x}', String(x))
    .replace('{y}', String(y));
}

export function demTileUrl(
  z: number,
  x: number,
  y: number,
  endpoint: OriginTileEndpoint = DEM_SOURCE,
): string {
  return `${endpointOrigin(endpoint)}${demTilePath(z, x, y, endpoint)}`;
}

/** Compiled once per template — the registry is small and never mutated. */
const PATH_PATTERNS = new Map<string, RegExp>();

function pathPattern(template: string): RegExp {
  const cached = PATH_PATTERNS.get(template);
  if (cached) return cached;
  const compiled = new RegExp(
    `^${template
      .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      .replace(/\\\{[zxy]\\\}/g, '[0-9]+')}$`,
  );
  PATH_PATTERNS.set(template, compiled);
  return compiled;
}

/**
 * Fail-closed allowlist used by the shell resource client.
 *
 * `origin` overrides the endpoint's own origin, which is what a transcoded
 * source needs: its tiles come from the collection server, so the host is the
 * caller's to supply while the path shape stays the source's to declare.
 */
export function isApprovedDemUrl(
  candidate: string,
  endpoint: TileEndpoint = DEM_SOURCE,
  origin: string = expectedOrigin(),
): boolean {
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return false;
  }
  if (url.origin !== origin) return false;
  if (url.search || url.hash || url.username || url.password) return false;
  return pathPattern(endpoint.pathTemplate).test(url.pathname);
}
