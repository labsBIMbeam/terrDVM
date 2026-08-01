/**
 * Elevation source registry — national bare-earth DTMs, with Terrarium as the
 * global fallback.
 *
 * ## Why this file exists
 *
 * `dem.ts` used to hardwire one endpoint: Mapzen Terrarium. Terrarium over
 * Europe is SRTM/GMTED-derived at ~30 m posting and it is a **DSM** — it
 * measures rooftops and canopy, not bare earth. Measured against the free CC0
 * 0.5 m South Tyrol LiDAR DTM on this project's own 192-grid:
 *
 * | bbox           | RMS error | max error |
 * |----------------|-----------|-----------|
 * | Bolzano valley |    3.33 m |   12.67 m |
 * | steep slope    |   14.31 m |   65.60 m |
 * | old town       |    6.01 m |   10.90 m |
 *
 * On the steep bbox Terrarium loses 64 m of relief on a 1 km model: the
 * mountain is the wrong shape, not merely imprecise. The DSM surface also sits
 * a measured +5.54 m above bare earth in built-up areas, which is a building
 * baked into the ground.
 *
 * ## Shape
 *
 * This mirrors `blossom_gis/texture.py`: a `TextureSource`-equivalent record
 * plus a `REGION_SOURCES`-equivalent preference list, best first, global
 * fallback last. It is deliberately the same pattern rather than a second one.
 *
 * ## Licences are mandatory
 *
 * `defineElevationSource` refuses a record without a licence and an
 * attribution, exactly as `RegionService` in `config/regions.ts` treats
 * imagery. Retrofitting licences is expensive; a source whose terms could not
 * be confirmed is not in this file at all. See `docs/ELEVATION-SOURCES.md` for
 * the survey, including the sources that were rejected and why.
 */

import {
  DEM_SOURCE,
  demTilePath,
  endpointOrigin,
  isApprovedDemUrl,
  type OriginTileEndpoint,
  type TileEndpoint,
} from './dem';
import type { Bounds } from '../config/regions';

export type ElevationSourceCode =
  /** A registry record carries no licence. */
  | 'LICENCE_MISSING'
  /** A registry record carries no attribution string. */
  | 'ATTRIBUTION_MISSING'
  /** A registry record is internally inconsistent (zooms, template, delivery). */
  | 'SOURCE_MALFORMED'
  /** A region chain names an id the registry does not hold. */
  | 'UNKNOWN_SOURCE'
  /** Selection produced no usable source at all — must not happen, guarded anyway. */
  | 'NO_SOURCE_FOR_REGION'
  /** A transcoded source was asked for a URL without a collection-server origin. */
  | 'TRANSCODE_ORIGIN_REQUIRED';

/** The one failure type this module raises. Named, coded, never a bare string. */
export class ElevationSourceError extends Error {
  readonly code: ElevationSourceCode;

  constructor(code: ElevationSourceCode, detail: string) {
    super(`${code}: ${detail}`);
    this.name = 'ElevationSourceError';
    this.code = code;
  }
}

/**
 * What the publisher actually serves, before anything this project does to it.
 *
 * Recorded because it is the fact that decides `delivery`: only `xyz-png`
 * reaches a sandboxed browser unaided. Everything else is a GeoTIFF in a
 * national projected CRS.
 */
export type ElevationUpstream = {
  readonly kind: 'xyz-png' | 'wcs' | 'stac-cog' | 'bulk-cog' | 'wmts-bil';
  readonly endpoint: string;
  /** WCS coverage id / STAC collection id / null for plain tile pyramids. */
  readonly coverageId: string | null;
  /** CRS the publisher delivers in — the reprojection the transcode must do. */
  readonly crs: string;
};

/** A source is a `TileEndpoint`, plus the provenance that makes it usable. */
export type ElevationSource = TileEndpoint & {
  readonly id: string;
  readonly name: string;
  /** ISO 3166 code of the publisher; `XX` for a global service. */
  readonly country: string;
  /**
   * The point of the whole exercise. `dtm` is bare earth; `dsm` includes
   * rooftops and canopy; `mixed` is a mosaic of both, which is what Terrarium
   * is.
   */
  readonly model: 'dtm' | 'dsm' | 'mixed';
  /** Native posting of the published grid, in metres. */
  readonly nativeResolutionM: number;
  readonly verticalDatum: string;
  /** Mandatory. Enforced by `defineElevationSource`. */
  readonly license: string;
  /** Mandatory. Enforced by `defineElevationSource`. */
  readonly attribution: string;
  /**
   * `direct` — the browser fetches these tiles from the publisher itself.
   * `transcoded` — blossom-gis must produce them; see `docs/ELEVATION-SOURCES.md`.
   */
  readonly delivery: 'direct' | 'transcoded';
  /** Always Terrarium: the transcode re-encodes into it so one decoder serves all. */
  readonly encoding: 'terrarium';
  readonly format: 'image/png';
  /** null for a transcoded source — the collection server supplies the origin. */
  readonly origin: {
    readonly scheme: string;
    readonly host: string;
    readonly port: number;
  } | null;
  readonly maxResponseBytes: number;
  readonly timeoutMs: number;
  /** null = global coverage. */
  readonly coverage: Bounds | null;
  readonly upstream: ElevationUpstream;
  /** When and how the endpoint and licence were last confirmed live. */
  readonly verified: string;
  readonly notes: string;
};

type ElevationSourceInput = Omit<ElevationSource, 'encoding' | 'format'> &
  Partial<Pick<ElevationSource, 'encoding' | 'format'>>;

/**
 * Build a registry record, refusing anything that would be a liability later.
 *
 * Fails closed with a named error rather than returning a half-declared source:
 * a DTM whose licence is blank looks identical to one whose licence is CC0
 * until somebody redistributes it.
 */
export function defineElevationSource(input: ElevationSourceInput): ElevationSource {
  const source: ElevationSource = { encoding: 'terrarium', format: 'image/png', ...input };

  if (!source.license.trim()) {
    throw new ElevationSourceError('LICENCE_MISSING', `${source.id} declares no licence`);
  }
  if (!source.attribution.trim()) {
    throw new ElevationSourceError('ATTRIBUTION_MISSING', `${source.id} declares no attribution`);
  }
  if (!(source.nativeResolutionM > 0)) {
    throw new ElevationSourceError(
      'SOURCE_MALFORMED',
      `${source.id} has a non-positive native resolution`,
    );
  }
  if (source.minZoom > source.maxZoom) {
    throw new ElevationSourceError('SOURCE_MALFORMED', `${source.id} has minZoom above maxZoom`);
  }
  for (const token of ['{z}', '{x}', '{y}']) {
    if (!source.pathTemplate.includes(token)) {
      throw new ElevationSourceError(
        'SOURCE_MALFORMED',
        `${source.id} path template is missing ${token}`,
      );
    }
  }
  if (source.delivery === 'direct' && source.origin === null) {
    throw new ElevationSourceError('SOURCE_MALFORMED', `${source.id} is direct but has no origin`);
  }
  if (source.delivery === 'transcoded' && source.origin !== null) {
    throw new ElevationSourceError(
      'SOURCE_MALFORMED',
      `${source.id} is transcoded, so its origin is the collection server's to supply`,
    );
  }
  return source;
}

/**
 * Zoom at which a Web Mercator pixel first matches a source's native posting.
 *
 * `log2(C * cos(lat) / (256 * resolution))`, the same derivation that fixed
 * Terrarium's cap at 13. Recorded as a function so each `maxZoom` below can be
 * checked rather than believed.
 */
export function nativeZoom(resolutionM: number, latitudeDeg: number): number {
  const circumference = 40_075_016.686;
  return Math.log2((circumference * Math.cos((latitudeDeg * Math.PI) / 180)) / (256 * resolutionM));
}

// --- The registry ------------------------------------------------------------

/**
 * The global fallback, spread from `DEM_SOURCE` so the endpoint contract has
 * exactly one copy. Everything about it stays as derived in `dem.ts`.
 */
export const TERRARIUM = defineElevationSource({
  id: 'mapzen-terrarium',
  name: 'Mapzen Terrain Tiles (Terrarium)',
  country: 'XX',
  // Honest label: a mosaic of SRTM/GMTED (radar/photogrammetric surface) with
  // some national bare-earth splices (3DEP, Norway, NZ). Over Europe outside
  // those splices it behaves as a DSM.
  model: 'mixed',
  nativeResolutionM: 30,
  verticalDatum: 'EGM96 (mixed by contributing source)',
  license: 'Public domain / permissive per contributing source (SRTM, GMTED2010, NED)',
  attribution: DEM_SOURCE.attribution,
  delivery: 'direct',
  origin: { scheme: DEM_SOURCE.scheme, host: DEM_SOURCE.host, port: DEM_SOURCE.port },
  pathTemplate: DEM_SOURCE.pathTemplate,
  tileSize: DEM_SOURCE.tileSize,
  minZoom: DEM_SOURCE.minZoom,
  maxZoom: DEM_SOURCE.maxZoom,
  maxResponseBytes: DEM_SOURCE.maxResponseBytes,
  timeoutMs: DEM_SOURCE.timeoutMs,
  coverage: null,
  upstream: {
    kind: 'xyz-png',
    endpoint: 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium',
    coverageId: null,
    crs: 'EPSG:3857',
  },
  verified: 'in production since phase 01',
  notes:
    'Global, already Terrarium-encoded, no transcode. Kept as the last link of ' +
    'every chain: outside national coverage it is the only thing there is.',
});

/** Shared shape for the national DTMs — all transcoded, all Terrarium-encoded out. */
function transcodedDtm(
  input: Omit<
    ElevationSourceInput,
    'delivery' | 'origin' | 'pathTemplate' | 'tileSize' | 'maxResponseBytes' | 'timeoutMs' | 'model'
  >,
): ElevationSource {
  return defineElevationSource({
    ...input,
    model: 'dtm',
    delivery: 'transcoded',
    origin: null,
    pathTemplate: `/dem/${input.id}/{z}/{x}/{y}.png`,
    tileSize: DEM_SOURCE.tileSize,
    // A 256² Terrarium PNG of a 1 m DTM compresses worse than a 30 m one:
    // more real relief per tile. Twice Terrarium's bound, still small.
    maxResponseBytes: 2_000_000,
    // The first request for a tile makes the server fetch and reproject a
    // national coverage; that is slower than proxying a ready-made PNG.
    timeoutMs: 45_000,
  });
}

/** South Tyrol 0.5 m — the reference against which Terrarium was measured. */
export const SOUTH_TYROL_DTM_05M = transcodedDtm({
  id: 'it-bz-dtm-05m',
  name: 'Südtirol Digitales Geländemodell 0,5 m',
  country: 'IT-BZ',
  nativeResolutionM: 0.5,
  verticalDatum: 'Genoa 1942 (orthometric)',
  license: 'CC0-1.0',
  attribution: 'Autonome Provinz Bozen — Südtirol / Provincia autonoma di Bolzano',
  // nativeZoom(0.5, 46.6) = 17.70, so 18 is the first zoom that carries it all.
  minZoom: 8,
  maxZoom: 18,
  coverage: { west: 10.38, south: 46.21, east: 12.48, north: 47.1 },
  upstream: {
    kind: 'wcs',
    endpoint: 'https://geoservices9.civis.bz.it/geoserver/ows',
    coverageId: 'p_bz-Elevation__DigitalTerrainModel-0.5m',
    crs: 'EPSG:25832',
  },
  verified: '2026-08-01 WCS 2.0.1 GetCapabilities listed the coverage; licence CC0 on data.civis.bz.it',
  notes:
    'Covers the settled areas of the province only — the 2.5 m product is the ' +
    'province-wide one, which is why the chain runs 0.5 m then 2.5 m then Terrarium. ' +
    'The same service publishes DigitalElevationModel-0.5m, which is the DSM twin; ' +
    'that pair is what the qualification gate uses to prove this really is bare earth.',
});

/** South Tyrol 2.5 m — province-wide, including the high alpine the 0.5 m skips. */
export const SOUTH_TYROL_DTM_25M = transcodedDtm({
  id: 'it-bz-dtm-25m',
  name: 'Südtirol Digitales Geländemodell 2,5 m',
  country: 'IT-BZ',
  nativeResolutionM: 2.5,
  verticalDatum: 'Genoa 1942 (orthometric)',
  license: 'CC0-1.0',
  attribution: 'Autonome Provinz Bozen — Südtirol / Provincia autonoma di Bolzano',
  // nativeZoom(2.5, 46.6) = 15.38.
  minZoom: 8,
  maxZoom: 16,
  coverage: { west: 10.38, south: 46.21, east: 12.48, north: 47.1 },
  upstream: {
    kind: 'wcs',
    endpoint: 'https://geoservices9.civis.bz.it/geoserver/ows',
    coverageId: 'p_bz-Elevation__DigitalTerrainModel-2.5m',
    crs: 'EPSG:25832',
  },
  verified: '2026-08-01 WCS 2.0.1 GetCapabilities listed the coverage',
  notes: 'Still 12x finer than Terrarium, and bare earth rather than canopy.',
});

/** Austria 1 m, nationwide — covers the Vienna demo region and the whole Alpine east. */
export const AUSTRIA_DTM_1M = transcodedDtm({
  id: 'at-bev-dtm-1m',
  name: 'BEV ALS Digitales Geländemodell 1 m',
  country: 'AT',
  nativeResolutionM: 1,
  verticalDatum: 'EVRS2000/Austria (orthometric)',
  license: 'CC-BY-4.0',
  attribution: 'Datenquelle: Bundesamt für Eich- und Vermessungswesen (BEV)',
  // nativeZoom(1, 47.6) = 16.69.
  minZoom: 8,
  maxZoom: 17,
  coverage: { west: 9.53, south: 46.37, east: 17.17, north: 49.02 },
  upstream: {
    kind: 'bulk-cog',
    endpoint: 'https://data.bev.gv.at/download/ALS/',
    coverageId: 'ALS DTM Höhenraster 1 m',
    crs: 'EPSG:3035',
  },
  verified:
    '2026-08-01 BEV metadata record states verbatim "Für dieses Produkt gilt die Standardlizenz CC-BY-4.0"; COG delivery',
  notes:
    'Bulk COG in 50 km tiles, no OGC coverage service — the transcode has to ' +
    'hold the tiles it needs rather than range-request per request. That is a ' +
    'storage decision, so it is recorded here and not hidden in the server.',
});

/** Switzerland 0.5 m. */
export const SWITZERLAND_DTM_05M = transcodedDtm({
  id: 'ch-swissalti3d',
  name: 'swissALTI3D',
  country: 'CH',
  nativeResolutionM: 0.5,
  verticalDatum: 'LN02 (orthometric)',
  // Not an SPDX id and there is no point pretending otherwise: swisstopo's OGD
  // terms permit free use including commercial, conditioned on citing swisstopo.
  license: 'swisstopo Open Government Data terms — free incl. commercial use, source must be cited',
  attribution: '© swisstopo',
  // nativeZoom(0.5, 46.8) = 17.69.
  minZoom: 8,
  maxZoom: 18,
  coverage: { west: 5.9503666, south: 45.7213375, east: 10.4998461, north: 47.8216742 },
  upstream: {
    kind: 'stac-cog',
    endpoint: 'https://data.geo.admin.ch/api/stac/v0.9/collections/ch.swisstopo.swissalti3d',
    coverageId: 'ch.swisstopo.swissalti3d',
    crs: 'EPSG:2056',
  },
  verified:
    '2026-08-01 STAC collection live, eo:gsd [0.5, 2.0], description states "without vegetation and development"',
  notes:
    'The WMS at wms.geo.admin.ch publishes only ch.swisstopo.swissalti3d-reliefschattierung — ' +
    'a hillshade image, not values. Checked live: there is no value raster over WMS, ' +
    'so STAC/COG is the only way in. Bbox includes Liechtenstein.',
});

/** Netherlands 0.5 m, CC0 — confirmed from the service's own capabilities. */
export const NETHERLANDS_DTM_05M = transcodedDtm({
  id: 'nl-ahn-dtm-05m',
  name: 'Actueel Hoogtebestand Nederland — maaiveld 0,5 m',
  country: 'NL',
  nativeResolutionM: 0.5,
  verticalDatum: 'NAP',
  license: 'CC0-1.0',
  attribution: 'Actueel Hoogtebestand Nederland (AHN), Rijkswaterstaat',
  // nativeZoom(0.5, 52.1) = 17.55.
  minZoom: 8,
  maxZoom: 18,
  coverage: { west: 3.2, south: 50.75, east: 7.23, north: 53.56 },
  upstream: {
    kind: 'wcs',
    endpoint: 'https://service.pdok.nl/rws/ahn/wcs/v1_0',
    coverageId: 'dtm_05m',
    crs: 'EPSG:28992',
  },
  verified:
    '2026-08-01 WCS GetCapabilities listed CoverageId dtm_05m and dsm_05m; AccessConstraints read "Geen beperkingen; http://creativecommons.org/publicdomain/zero/1.0/deed.nl"',
  notes:
    'The dsm_05m twin on the same endpoint gives the qualification gate its ' +
    'bare-earth proof for free.',
});

/** France 1 m. */
export const FRANCE_DTM_1M = transcodedDtm({
  id: 'fr-ign-rgealti-1m',
  name: 'IGN RGE ALTI 1 m',
  country: 'FR',
  nativeResolutionM: 1,
  verticalDatum: 'IGN69 / RGF93 (orthometric)',
  license: 'etalab-2.0 (Licence Ouverte / Open Licence 2.0)',
  attribution: "© IGN — Institut national de l'information géographique et forestière",
  // nativeZoom(1, 46.5) = 16.72.
  minZoom: 8,
  maxZoom: 17,
  /**
   * Metropolitan France and Corsica only.
   *
   * The service declares -62.95,-24,58,51.11 — an envelope drawn round the
   * overseas départements from Guadeloupe to Réunion. That box also contains
   * Madeira, the Canaries and most of West Africa, none of which RGE ALTI
   * covers, and a chain that over-claims coverage answers with the wrong
   * country's terrain instead of falling back. Under-claiming costs the
   * overseas départements a fallback to Terrarium; over-claiming costs
   * correctness, so the box is drawn tight and the loss is recorded here.
   */
  coverage: { west: -5.15, south: 41.31, east: 9.66, north: 51.11 },
  upstream: {
    kind: 'wmts-bil',
    endpoint: 'https://data.geopf.fr/wmts',
    coverageId: 'ELEVATION.ELEVATIONGRIDCOVERAGE.HIGHRES',
    crs: 'IGNF:WGS84G (TileMatrixSet WGS84G_6_14)',
  },
  verified:
    '2026-08-01 WMTS GetCapabilities: title "Modèle Numérique de Terrain issu du RGEALTI", Format image/x-bil;bits=32, zooms 6-14',
  notes:
    'The one publisher here that could in principle skip the transcode: its ' +
    'WMS-r GetMap offers STYLES=terrainrgb, i.e. Mapbox-encoded elevation PNG. ' +
    'Not wired, for two reasons — it is WMS (a query string, which every ' +
    'allowlist in this app refuses) on a non-WebMercator grid, and its WMTS ' +
    'stops at z14, which is 25 m/px and throws the 1 m data away. Routing it ' +
    'through the same transcode keeps one code path and gets the full resolution.',
});

/** North Rhine-Westphalia 1 m — the German Land already qualified for imagery. */
export const NRW_DTM_1M = transcodedDtm({
  id: 'de-nw-dgm1',
  name: 'Geobasis NRW Digitales Geländemodell 1 m',
  country: 'DE-NW',
  nativeResolutionM: 1,
  verticalDatum: 'DHHN2016 (orthometric)',
  license: 'dl-de/zero-2-0',
  attribution: 'Land NRW / Geobasis NRW',
  // nativeZoom(1, 51.5) = 16.57.
  minZoom: 8,
  maxZoom: 17,
  coverage: { west: 5.86, south: 50.32, east: 9.46, north: 52.53 },
  upstream: {
    kind: 'wcs',
    endpoint: 'https://www.wcs.nrw.de/geobasis/wcs_nw_dgm',
    coverageId: 'nw_dgm',
    crs: 'EPSG:25832',
  },
  verified:
    '2026-08-01 WCS 2.0.1 GetCapabilities listed CoverageId nw_dgm with AccessConstraints NONE; dl-de/zero-2-0 per Geobasis NRW',
  notes:
    'Germany has no usable federal DTM service — BKG charges third parties for ' +
    'DOP/DGM despite the open-data framing — so this is per-Land, and NRW is ' +
    'the Land whose orthophoto service is already in source_check.py.',
});

/** Czechia — 5 m raster, so a smaller win, but still bare earth and 6x finer. */
export const CZECHIA_DMR5G = transcodedDtm({
  id: 'cz-cuzk-dmr5g',
  name: 'ČÚZK DMR 5G',
  country: 'CZ',
  nativeResolutionM: 5,
  verticalDatum: 'Bpv (Balt after adjustment)',
  license: 'CC-BY-4.0',
  attribution: 'Český úřad zeměměřický a katastrální (ČÚZK)',
  // nativeZoom(5, 49.8) = 14.30.
  minZoom: 8,
  maxZoom: 15,
  coverage: { west: 12.09, south: 48.55, east: 18.86, north: 51.06 },
  upstream: {
    kind: 'bulk-cog',
    endpoint: 'https://ags.cuzk.gov.cz/arcgis2/rest/services/dmr5g/ImageServer',
    coverageId: 'dmr5g',
    crs: 'EPSG:5514',
  },
  verified:
    '2026-08-01 ArcGIS ImageServer reachable; ZABAGED file data open under CC-BY-4.0 since 2023-07-01 per ČÚZK geoportal',
  notes:
    'The ArcGIS WCS façade rejected both WCS 1.0.0 and 2.0.1 GetCapabilities on ' +
    'probe — access is the ImageServer REST exportImage or the ATOM bulk feed, ' +
    'not WCS. Recorded so nobody re-derives that the hard way.',
});

export const ELEVATION_SOURCES: Readonly<Record<string, ElevationSource>> = Object.freeze(
  Object.fromEntries(
    [
      TERRARIUM,
      SOUTH_TYROL_DTM_05M,
      SOUTH_TYROL_DTM_25M,
      AUSTRIA_DTM_1M,
      SWITZERLAND_DTM_05M,
      NETHERLANDS_DTM_05M,
      FRANCE_DTM_1M,
      NRW_DTM_1M,
      CZECHIA_DMR5G,
    ].map((source) => [source.id, source]),
  ),
);

/**
 * Preferred elevation source per region, best-quality first — the same shape
 * as `REGION_SOURCES` in `texture.py`.
 *
 * Terrarium is appended by `selectElevationSources` whether or not it is named
 * here, so a chain can never end in nothing.
 *
 * `madeira` is absent on purpose: see `docs/ELEVATION-SOURCES.md`. The demo's
 * own home region has no bare-earth service this project could confirm, which
 * is worth stating rather than papering over.
 */
export const REGION_ELEVATION_SOURCES: Readonly<Record<string, readonly string[]>> = Object.freeze({
  'south-tyrol': ['it-bz-dtm-05m', 'it-bz-dtm-25m'],
  vienna: ['at-bev-dtm-1m'],
  europe: [
    'it-bz-dtm-05m',
    'at-bev-dtm-1m',
    'ch-swissalti3d',
    'nl-ahn-dtm-05m',
    'fr-ign-rgealti-1m',
    'de-nw-dgm1',
    'cz-cuzk-dmr5g',
  ],
});

// --- Selection ---------------------------------------------------------------

export function getElevationSource(id: string): ElevationSource {
  const source = ELEVATION_SOURCES[id];
  if (!source) {
    throw new ElevationSourceError('UNKNOWN_SOURCE', `no elevation source with id ${id}`);
  }
  return source;
}

function covers(source: ElevationSource, bbox: readonly number[]): boolean {
  if (source.coverage === null) return true;
  const [west, south, east, north] = bbox;
  const { coverage } = source;
  return (
    west >= coverage.west &&
    east <= coverage.east &&
    south >= coverage.south &&
    north <= coverage.north
  );
}

/**
 * The ordered source chain for a region, best first, Terrarium last.
 *
 * A bbox filters the chain by coverage — the `europe` region spans a continent
 * whose national services each cover one country, so without this every
 * selection would start by asking Switzerland about Poland. Terrarium is
 * always appended, so "outside every national coverage" is not a failure, it
 * is 30 m data with the accuracy note attached.
 */
export function selectElevationSources(
  regionId: string | undefined | null,
  bbox?: readonly number[],
): ElevationSource[] {
  const ids = (regionId && REGION_ELEVATION_SOURCES[regionId]) || [];
  const chain: ElevationSource[] = [];

  for (const id of ids) {
    const source = getElevationSource(id);
    if (bbox && !covers(source, bbox)) continue;
    chain.push(source);
  }
  if (!chain.some((source) => source.id === TERRARIUM.id)) {
    chain.push(TERRARIUM);
  }
  if (chain.length === 0) {
    throw new ElevationSourceError(
      'NO_SOURCE_FOR_REGION',
      `region ${regionId ?? '(none)'} resolved to an empty source chain`,
    );
  }
  return chain;
}

/** The source that would actually be used, i.e. the head of the chain. */
export function chooseElevationSource(
  regionId: string | undefined | null,
  bbox?: readonly number[],
): ElevationSource {
  return selectElevationSources(regionId, bbox)[0];
}

// --- URLs --------------------------------------------------------------------

/**
 * Tile URL for a source.
 *
 * A transcoded source has no origin of its own — its tiles are produced by the
 * collection server — so `collectionOrigin` is required for one and ignored
 * for the other. Asking for a transcoded URL without it is a named failure,
 * not a URL pointing at nowhere.
 */
export function elevationOrigin(source: ElevationSource, collectionOrigin?: string): string {
  if (source.origin !== null) {
    return endpointOrigin({ ...source, ...source.origin } satisfies OriginTileEndpoint);
  }
  if (!collectionOrigin) {
    throw new ElevationSourceError(
      'TRANSCODE_ORIGIN_REQUIRED',
      `${source.id} is transcoded; pass the collection-server origin`,
    );
  }
  return new URL(collectionOrigin).origin;
}

export function elevationTileUrl(
  source: ElevationSource,
  z: number,
  x: number,
  y: number,
  collectionOrigin?: string,
): string {
  return `${elevationOrigin(source, collectionOrigin)}${demTilePath(z, x, y, source)}`;
}

/** Fail-closed allowlist for a source's tiles, mirroring `isApprovedDemUrl`. */
export function isApprovedElevationUrl(
  candidate: string,
  source: ElevationSource,
  collectionOrigin?: string,
): boolean {
  let origin: string;
  try {
    origin = elevationOrigin(source, collectionOrigin);
  } catch {
    return false;
  }
  return isApprovedDemUrl(candidate, source, origin);
}

// --- Provenance --------------------------------------------------------------

export type ElevationProvenance = {
  readonly id: string;
  readonly name: string;
  readonly model: ElevationSource['model'];
  readonly resolutionM: number;
  readonly license: string;
  readonly attribution: string;
};

/**
 * The attribution row for a chain — every licence in it, in use order.
 *
 * CC-BY and dl-de/by are infectious: the obligation travels with the derived
 * tile. A transcoded tile is a derived work of the national coverage, so the
 * licence has to reach whatever displays or stores it, which is why this is a
 * function of the chain and not of the one source that happened to answer.
 */
export function elevationProvenance(sources: readonly ElevationSource[]): ElevationProvenance[] {
  return sources.map((source) => ({
    id: source.id,
    name: source.name,
    model: source.model,
    resolutionM: source.nativeResolutionM,
    license: source.license,
    attribution: source.attribution,
  }));
}
