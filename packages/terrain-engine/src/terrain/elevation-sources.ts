/**
 * Elevation source registry — national bare-earth DTMs over a global
 * bare-earth base, with Terrarium as the last resort.
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
 *
 * Since 2026-08-02 a source must also declare `verticalUncertaintyM` together
 * with the basis of that number. `.planning/MESH-CALCULATOR.md` §4.1 makes it
 * mandatory: a clearance verdict carries information only when σ is smaller
 * than the clearance being tested, so a source that cannot state its σ cannot
 * be used to answer the question at all.
 */

import {
  DEM_SOURCE,
  demTilePath,
  endpointOrigin,
  isApprovedDemUrl,
  type OriginTileEndpoint,
  type TileEndpoint,
  type TileImageFormat,
} from './dem';
import type { Bounds } from '../config/regions';

export type ElevationSourceCode =
  /** A registry record carries no licence. */
  | 'LICENCE_MISSING'
  /** A registry record carries no attribution string. */
  | 'ATTRIBUTION_MISSING'
  /** A composite-licence record does not account for every source it covers. */
  | 'COMPOSITE_LICENCE_UNRESOLVED'
  /** A registry record declares no 1σ vertical uncertainty (MESH-CALCULATOR §4.1). */
  | 'VERTICAL_UNCERTAINTY_UNDECLARED'
  /** A registry record is internally inconsistent (zooms, template, delivery). */
  | 'SOURCE_MALFORMED'
  /** A region chain names an id the registry does not hold. */
  | 'UNKNOWN_SOURCE'
  /** Selection produced no usable source at all — must not happen, guarded anyway. */
  | 'NO_SOURCE_FOR_REGION'
  /** A transcoded source was asked for a URL without a collection-server origin. */
  | 'TRANSCODE_ORIGIN_REQUIRED'
  /** A source that is not bare earth was asked to stand in as a bare-earth reference. */
  | 'NOT_BARE_EARTH';

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
  readonly kind: 'xyz-png' | 'xyz-webp' | 'wcs' | 'stac-cog' | 'bulk-cog' | 'wmts-bil';
  readonly endpoint: string;
  /** WCS coverage id / STAC collection id / null for plain tile pyramids. */
  readonly coverageId: string | null;
  /** CRS the publisher delivers in — the reprojection the transcode must do. */
  readonly crs: string;
};

/**
 * Where a `verticalUncertaintyM` figure came from. Recorded because the number
 * is load-bearing: MESH-CALCULATOR §4.3 turns it directly into "this question
 * is answerable at this range and that one is not", and a vendor brochure and
 * a measurement against LiDAR are not the same kind of claim.
 */
export type UncertaintyBasis =
  /** This project measured it — see `docs/ELEVATION-SOURCES.md`. */
  | 'measured'
  /** Peer-reviewed figure, cited on the record. */
  | 'published'
  /** The publisher's own accuracy statement. */
  | 'vendor'
  /**
   * Nothing published that this pass could confirm, so σ is taken as the
   * native posting (floored at 0.3 m). Stated as an assumption, never dressed
   * up as a vendor figure — the rule is written out at `POSTING_SIGMA`.
   */
  | 'assumed-from-posting'
  /**
   * The source is a mosaic whose per-tile provenance it does not publish, so
   * it inherits the worst σ anything in the mosaic could have. An unknown is
   * treated exactly as harshly as the worst known case (MESH-CALCULATOR §2.5).
   */
  | 'inherited-worst-case';

/**
 * The licence position of a mosaic that redistributes many upstream datasets
 * under one endpoint.
 *
 * `ElevationSource` carries exactly one `license` and one `attribution`
 * string, which is the right shape for a source with one publisher and the
 * wrong shape for Mapterhorn's 134. Writing "various" in the licence field
 * would be a licence failure wearing a licence's clothes, so a composite
 * source instead has to declare the audit: what was fetched, when, its hash,
 * how many datasets it covers, how the declared terms group, and the
 * strongest obligation across the whole set. The single `license` string then
 * names that audit rather than pretending to be one SPDX id, and the single
 * `attribution` string is a credit line that discharges the obligation on its
 * own. The reasoning is written out in `docs/ELEVATION-SOURCES.md`.
 */
export type CompositeLicence = {
  /** Machine-readable manifest the audit was taken from. */
  readonly manifestUrl: string;
  /** ISO date the manifest was fetched and read. */
  readonly snapshot: string;
  /** SHA-256 of the manifest bytes as audited. A record, not a runtime check. */
  readonly manifestSha256: string;
  /** Datasets the mosaic redistributes. */
  readonly sourceCount: number;
  /** Distinct licence strings the manifest declares, before grouping. */
  readonly distinctTerms: number;
  /** Grouped census of those strings. Must sum to `sourceCount`. */
  readonly families: readonly { readonly family: string; readonly count: number }[];
  /**
   * The strongest obligation across every declared licence in the set. This
   * is what the credit line has to discharge.
   */
  readonly obligation: 'attribution';
  /**
   * Datasets whose licence is known by its declared *name* only — the full
   * text was not read in the audit pass. Recorded rather than glossed, because
   * "no non-commercial terms in the set" is only as strong as the reading.
   */
  readonly termsReadByNameOnly: number;
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
  /**
   * Native posting of the published grid, in metres.
   *
   * For a mosaic of differing postings this is the posting that is present
   * *everywhere*, not the finest one anywhere — it is the number §2.6 of the
   * mesh-calculator spec floors profile sampling on, and over-claiming it
   * manufactures diffraction out of interpolation.
   */
  readonly nativeResolutionM: number;
  readonly verticalDatum: string;
  /**
   * 1σ vertical uncertainty of the published grid, metres. Mandatory —
   * MESH-CALCULATOR §4.1. Enforced by `defineElevationSource`.
   */
  readonly verticalUncertaintyM: number;
  /** Where that number came from. Mandatory alongside it. */
  readonly verticalUncertaintyBasis: UncertaintyBasis;
  /** Mandatory. Enforced by `defineElevationSource`. */
  readonly license: string;
  /** Mandatory. Enforced by `defineElevationSource`. */
  readonly attribution: string;
  /**
   * Non-null when `license` names a composite audit rather than one publisher's
   * terms. Enforced for internal consistency by `defineElevationSource`.
   */
  readonly composite: CompositeLicence | null;
  /**
   * `direct` — the browser fetches these tiles from the publisher itself.
   * `transcoded` — blossom-gis must produce them; see `docs/ELEVATION-SOURCES.md`.
   */
  readonly delivery: 'direct' | 'transcoded';
  /** Always Terrarium: the transcode re-encodes into it so one decoder serves all. */
  readonly encoding: 'terrarium';
  readonly format: TileImageFormat;
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
  /**
   * Highest zoom present *everywhere* inside `coverage`.
   *
   * `null` means the pyramid is dense: every zoom up to `maxZoom` exists
   * across the whole coverage, which is true of a transcode driven by one
   * national raster and of Terrarium.
   *
   * A number means the pyramid is **sparse** above it — `maxZoom` is reachable
   * somewhere and 404s elsewhere. Mapterhorn is the case that forced this
   * field: verified live, z12 answers everywhere on earth, z13–z18 exist only
   * where a finer contributing source does. Declaring `maxZoom: 18` alone
   * would make every default request 404 outside the good footprints, which is
   * precisely the silent-failure defect this registry exists to avoid, so
   * `elevationEndpoint()` clamps to this value unless a caller opts in.
   */
  readonly denseMaxZoom: number | null;
  readonly upstream: ElevationUpstream;
  /** When and how the endpoint and licence were last confirmed live. */
  readonly verified: string;
  readonly notes: string;
};

type ElevationSourceInput = Omit<
  ElevationSource,
  'encoding' | 'format' | 'composite' | 'denseMaxZoom'
> &
  Partial<Pick<ElevationSource, 'encoding' | 'format' | 'composite' | 'denseMaxZoom'>>;

/**
 * σ for a source with no confirmable accuracy statement: the native posting,
 * floored at 0.3 m.
 *
 * Not a physical law — a stated house rule, so that `assumed-from-posting`
 * means one checkable thing rather than a different guess per entry. It is
 * deliberately pessimistic: an ALS DTM's real σ is usually well under its
 * posting, so this never makes a refusal look more answerable than it is. The
 * floor exists because no photogrammetric product is better than a few
 * centimetres and pretending otherwise would let §4.3 claim clearance verdicts
 * at absurd ranges.
 */
export function postingSigmaM(nativeResolutionM: number): number {
  return Math.max(0.3, nativeResolutionM);
}

/**
 * Build a registry record, refusing anything that would be a liability later.
 *
 * Fails closed with a named error rather than returning a half-declared source:
 * a DTM whose licence is blank looks identical to one whose licence is CC0
 * until somebody redistributes it.
 */
export function defineElevationSource(input: ElevationSourceInput): ElevationSource {
  const source: ElevationSource = {
    encoding: 'terrarium',
    format: 'image/png',
    composite: null,
    denseMaxZoom: null,
    ...input,
  };

  if (!source.license.trim()) {
    throw new ElevationSourceError('LICENCE_MISSING', `${source.id} declares no licence`);
  }
  if (!source.attribution.trim()) {
    throw new ElevationSourceError('ATTRIBUTION_MISSING', `${source.id} declares no attribution`);
  }
  // "various" and its friends are what this whole registry exists to refuse:
  // they look like a declaration and discharge no obligation at all.
  if (/\b(various|multiple|see\s+website|tbd|unknown)\b/i.test(source.license)) {
    throw new ElevationSourceError(
      'COMPOSITE_LICENCE_UNRESOLVED',
      `${source.id} names no actual terms — a mosaic must declare a composite audit instead`,
    );
  }
  if (source.composite !== null) {
    const { composite } = source;
    const counted = composite.families.reduce((total, row) => total + row.count, 0);
    if (composite.sourceCount < 1 || counted !== composite.sourceCount) {
      throw new ElevationSourceError(
        'COMPOSITE_LICENCE_UNRESOLVED',
        `${source.id} groups ${counted} of ${composite.sourceCount} redistributed datasets`,
      );
    }
    if (composite.distinctTerms < composite.families.length) {
      throw new ElevationSourceError(
        'COMPOSITE_LICENCE_UNRESOLVED',
        `${source.id} claims fewer distinct terms than licence families`,
      );
    }
    if (composite.termsReadByNameOnly > composite.sourceCount) {
      throw new ElevationSourceError(
        'COMPOSITE_LICENCE_UNRESOLVED',
        `${source.id} reports more unread terms than datasets`,
      );
    }
    if (!/^[0-9a-f]{64}$/.test(composite.manifestSha256)) {
      throw new ElevationSourceError(
        'COMPOSITE_LICENCE_UNRESOLVED',
        `${source.id} does not pin the manifest bytes it audited`,
      );
    }
    // The credit line has to be self-sufficient: whatever the UI prints must
    // point a reader at the full list, offline or not.
    if (!source.attribution.includes(composite.manifestUrl.replace(/^https?:\/\//, ''))) {
      throw new ElevationSourceError(
        'COMPOSITE_LICENCE_UNRESOLVED',
        `${source.id} attribution does not lead to the per-dataset credits`,
      );
    }
  }
  if (!(source.verticalUncertaintyM > 0) || !Number.isFinite(source.verticalUncertaintyM)) {
    throw new ElevationSourceError(
      'VERTICAL_UNCERTAINTY_UNDECLARED',
      `${source.id} declares no positive 1σ vertical uncertainty`,
    );
  }
  if (source.denseMaxZoom !== null) {
    if (source.denseMaxZoom < source.minZoom || source.denseMaxZoom > source.maxZoom) {
      throw new ElevationSourceError(
        'SOURCE_MALFORMED',
        `${source.id} puts denseMaxZoom outside its own zoom range`,
      );
    }
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
 * `log2(C * cos(lat) / (tileSize * resolution))`, the same derivation that
 * fixed Terrarium's cap at 13. Recorded as a function so each `maxZoom` below
 * can be checked rather than believed.
 *
 * `tileSize` is a parameter and not a constant because a 512² tile reaches the
 * same ground sampling one zoom lower: Mapterhorn's z12 and Terrarium's z13
 * are the same 12.7 m/px over Vienna, and comparing their zoom numbers without
 * this term would be off by a factor of two.
 */
export function nativeZoom(resolutionM: number, latitudeDeg: number, tileSize = 256): number {
  const circumference = 40_075_016.686;
  return Math.log2(
    (circumference * Math.cos((latitudeDeg * Math.PI) / 180)) / (tileSize * resolutionM),
  );
}

/** Ground sampling of one tile pixel, metres. The reader's version of the above. */
export function groundResolutionM(zoom: number, latitudeDeg: number, tileSize = 256): number {
  const circumference = 40_075_016.686;
  return (circumference * Math.cos((latitudeDeg * Math.PI) / 180)) / (tileSize * 2 ** zoom);
}

// --- The registry ------------------------------------------------------------

/**
 * The last resort, spread from `DEM_SOURCE` so the endpoint contract has
 * exactly one copy. Everything about it stays as derived in `dem.ts`.
 *
 * **Demoted, not retired, on 2026-08-02.** GEDTM30 is better on every axis
 * that matters — bare earth rather than a rooftop surface, 10.69 m σ against
 * 14.31 m — so it now sits ahead of this in every chain. Terrarium stays as
 * the terminal link for one reason: it is the only *direct* global source in
 * the registry. GEDTM30 is a 432 GB COG that has to be transcoded by the
 * collection server, so with no server running Terrarium is the only thing
 * between the app and no terrain at all. Retiring it would trade a 14 m error
 * for a blank screen.
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
  // This project's own measurement against the CC0 0.5 m South Tyrol LiDAR
  // DTM on the steep bbox — better provenance than any vendor figure, because
  // it is this grid, this interpolant and this terrain.
  verticalUncertaintyM: 14.31,
  verticalUncertaintyBasis: 'measured',
  license: 'Public domain / permissive per contributing source (SRTM, GMTED2010, NED)',
  attribution: DEM_SOURCE.attribution,
  delivery: 'direct',
  origin: { scheme: DEM_SOURCE.scheme, host: DEM_SOURCE.host, port: DEM_SOURCE.port },
  pathTemplate: DEM_SOURCE.pathTemplate,
  tileSize: DEM_SOURCE.tileSize,
  format: DEM_SOURCE.format,
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
    'every chain because it is the only direct global source: with no ' +
    'collection server, GEDTM30 cannot answer and this can.',
});

/**
 * The global bare-earth base. Adjudicated in `.planning/MESH-CALCULATOR.md`
 * §2.2 as **the default, not a fallback**.
 *
 * The only globally complete, redistributable bare-earth DEM there is. A
 * global-to-local random forest fused Copernicus DEM, ALOS World3D and object
 * height models against ~30 billion ICESat-2 and GEDI returns, which is what
 * lets it be a terrain model rather than a surface model everywhere at once:
 * 10.69 m RMSE / 7.77 m std against GNSS stations, and a 25.4% RMSE reduction
 * on Copernicus in built-up areas, 27.3% under >50% tree cover.
 *
 * FABDEM, FABDEM+ and FathomDEM do the same job and are all CC BY-**NC**, so
 * they are out of this repo by the same rule that excluded them from imagery.
 *
 * **Distribution, checked live and stated plainly: there is no tile service.**
 * GEDTM30 ships as one 432 GB BigTIFF COG (`Content-Length 432405638563`,
 * `II+\0` magic, `Access-Control-Allow-Origin: *`, HTTP range requests) in
 * EPSG:4326 with EPSG:3855/EGM2008 heights. So this entry is `transcoded` and
 * points at the project's own documented `/dem/{source_id}/{z}/{x}/{y}.png`
 * route, exactly as the eight national DTMs do — and exactly as with them, the
 * route is not implemented yet, so today this link demotes to Terrarium. No
 * URL is invented; the interface is the one this repo published.
 *
 * One thing makes it materially cheaper to transcode than the national DTMs,
 * and it is worth recording: the COG is already in EPSG:4326, so the
 * reprojection to WebMercator is closed-form. No proj datum grids, no
 * sub-metre datum shift to get wrong — the single largest reason
 * `docs/ELEVATION-SOURCES.md` gave for not doing this client-side does not
 * apply here.
 */
export const GEDTM30 = defineElevationSource({
  id: 'gedtm30',
  name: 'GEDTM30 global ensemble digital terrain model',
  country: 'XX',
  model: 'dtm',
  nativeResolutionM: 30,
  verticalDatum: 'EGM2008 (EPSG:3855)',
  verticalUncertaintyM: 10.69,
  verticalUncertaintyBasis: 'published',
  license: 'CC-BY-4.0',
  attribution:
    'Elevation: GEDTM30 — Ho, Parente, Hengl et al., OpenGeoHub Foundation, ' +
    'CC BY 4.0 (doi:10.7717/peerj.19673)',
  delivery: 'transcoded',
  origin: null,
  pathTemplate: '/dem/gedtm30/{z}/{x}/{y}.png',
  tileSize: 256,
  minZoom: 8,
  // nativeZoom(30, 0) = 12.35 at the equator and lower everywhere else, so 13
  // is the first zoom that carries the whole grid — the same cap, from the
  // same derivation, as Terrarium's 30 m.
  maxZoom: 13,
  maxResponseBytes: 2_000_000,
  timeoutMs: 45_000,
  coverage: null,
  denseMaxZoom: null,
  upstream: {
    kind: 'bulk-cog',
    endpoint:
      'https://s3.opengeohub.org/global/dtm/v1.2/' +
      'gedtm_rf_m_30m_s_20060101_20151231_go_epsg.4326.3855_v1.2.tif',
    coverageId: 'gedtm_rf_m_30m_s_20060101_20151231_go_epsg.4326.3855_v1.2',
    crs: 'EPSG:4326 (heights EPSG:3855 / EGM2008)',
  },
  verified:
    '2026-08-02 HEAD on the v1.2 COG returned 200, image/tiff, Content-Length ' +
    '432405638563, Accept-Ranges bytes, ACAO *; BigTIFF magic II+\\0 confirmed by ' +
    'range request; CC-BY-4.0 and 10.69 m RMSE / 7.77 m std vs GNSS per PeerJ 19673',
  notes:
    'AWAITING THE SERVER-SIDE PATH. One global COG, no XYZ endpoint anywhere — ' +
    'checked s3.opengeohub.org, the OpenLandMap STAC browser and the project ' +
    'repository. Until /dem/gedtm30/{z}/{x}/{y}.png exists this link demotes to ' +
    'Terrarium, which is stated here rather than hidden behind a URL that 404s.',
});

/**
 * An opt-in resolution upgrade, and deliberately **not** part of any chain.
 *
 * Mapterhorn mosaics 134 open national and global elevation datasets into one
 * Terrarium-encoded 512² pyramid, and where a national ALS product feeds it
 * that is 0.80 m/px over Vienna at z16 against Terrarium's 12.7 m/px — a 16x
 * improvement, direct, no transcoder, no new decoder.
 *
 * It is nevertheless not the global base and must not become it, for two
 * reasons that were both verified rather than assumed.
 *
 * **1. It cannot tell you whether a tile is bare earth.** Its per-source
 * metadata carries name, website, licence, producer, resolution and access
 * year — and no DTM/DSM field. Its global filler is `glo30`, which the
 * manifest names "COPERNICUS GLO-30": a surface model, with nothing in the
 * record saying so. Recovering the surface type means parsing product names in
 * four languages. A surface model silently substituted for a terrain model is
 * the exact failure this project refuses, so this entry is `model: 'mixed'`,
 * `requireBareEarthReference` rejects it, and MESH-CALCULATOR §2.5 keeps it to
 * classified-DTM footprints only.
 *
 * **2. The pyramid is sparse, and by a lot.** Probed live at fourteen points:
 * z12 answers everywhere on earth; above z12 a tile exists only where a
 * contributing source is finer than glo30. Observed ceilings — Zurich z18,
 * Vienna / Paris / London / Tokyo / Brussels / New York z16, Bolzano /
 * Amsterdam / Sydney / Tromsø z15, Madeira z13, and Nairobi / the Amazon /
 * the Sahara / central Siberia z12. So `maxZoom: 18` is true and useless on
 * its own; `denseMaxZoom: 12` is what a caller can rely on, and
 * `elevationEndpoint()` hands out the clamped contract unless the caller opts
 * into the sparse tail. Note what z12 is worth: 512² at z12 is exactly the
 * ground sampling of Terrarium's 256² at z13, so the *reliable* part of
 * Mapterhorn is no sharper than what already ships. The upgrade is entirely in
 * the sparse tail, which is why it is opt-in.
 *
 * One volunteer's infrastructure behind Cloudflare, with no SLA. It sits above
 * a durable tail, never as the only source.
 */
export const MAPTERHORN = defineElevationSource({
  id: 'mapterhorn',
  name: 'Mapterhorn global terrain tiles',
  country: 'XX',
  model: 'mixed',
  // The posting present *everywhere* is glo30's 30 m. The finest contributing
  // source is 0.25 m, but claiming that as the native resolution would floor
  // profile sampling (MESH-CALCULATOR §2.6) at a spacing the data does not
  // support outside a handful of countries.
  nativeResolutionM: 30,
  verticalDatum: 'mixed by contributing source (EGM2008 for the glo30 filler)',
  // Inherited worst case: with no per-tile provenance the mosaic can be the
  // 30 m Copernicus DSM anywhere, and this project's measured figure for a
  // 30 m mixed/DSM product on its own grid is Terrarium's 14.31 m. An
  // unclassified tile is treated exactly as harshly as a DSM one, so
  // Mapterhorn can never win a σ comparison — it buys resolution, not
  // accuracy, until the §2.5 classification table exists.
  verticalUncertaintyM: 14.31,
  verticalUncertaintyBasis: 'inherited-worst-case',
  license:
    'Composite of 134 open datasets audited 2026-08-02 — see `composite`; ' +
    'binding obligation across the whole set is attribution; no non-commercial, ' +
    'share-alike or no-derivatives terms declared',
  attribution:
    'Elevation: © Mapterhorn — 134 open national and global elevation datasets, ' +
    'each credited at mapterhorn.com/attribution ' +
    '(CC BY 4.0, Licence Ouverte 2.0, dl-de/by-2.0, GSI Japan and public-domain terms)',
  composite: {
    manifestUrl: 'https://mapterhorn.com/attribution',
    snapshot: '2026-08-02',
    // sha256 of https://download.mapterhorn.com/attribution.json as audited.
    manifestSha256: 'd2f6a2a13f3f039123d08fca3fe7b95d1164583ac4b59f23eefefc5757131376',
    sourceCount: 134,
    distinctTerms: 28,
    families: [
      { family: 'CC BY 4.0 family', count: 51 },
      { family: 'Public domain (US Government Work / ASTER GDEM)', count: 35 },
      { family: 'Licence Ouverte / Open Licence 2.0', count: 14 },
      { family: 'National open-government terms', count: 11 },
      { family: 'dl-de/by-2.0', count: 8 },
      { family: 'GSI Japan terms of use', count: 6 },
      { family: 'CC0 / public-domain dedication', count: 4 },
      { family: 'dl-de/zero-2.0', count: 3 },
      { family: 'Copernicus full, free and open', count: 1 },
      { family: 'CC BY 2.5', count: 1 },
    ],
    obligation: 'attribution',
    // Nine bespoke national open-government strings, covering 17 datasets —
    // Japan's GSI terms, Estonia's 2025 opendata licence, the Canadian, UK,
    // Polish and Romanian OGLs and the rest — were read as declared names,
    // not as full legal texts.
    termsReadByNameOnly: 17,
  },
  delivery: 'direct',
  origin: { scheme: 'https', host: 'tiles.mapterhorn.com', port: 443 },
  pathTemplate: '/{z}/{x}/{y}.webp',
  tileSize: 512,
  format: 'image/webp',
  minZoom: 8,
  maxZoom: 18,
  denseMaxZoom: 12,
  // Measured: 274,572 B at z12 over Vienna, 47,844 B at z16. Lossless WebP of
  // high relief compresses worse than Terrarium's PNG, so twice the bound.
  maxResponseBytes: 2_000_000,
  timeoutMs: 15_000,
  coverage: null,
  upstream: {
    kind: 'xyz-webp',
    endpoint: 'https://tiles.mapterhorn.com',
    coverageId: null,
    crs: 'EPSG:3857',
  },
  verified:
    '2026-08-02 tilejson at tiles.mapterhorn.com/tiles.json declares ' +
    'encoding terrarium, tileSize 512, bounds global; a z16 Vienna tile is ' +
    '47,844 B RIFF/WEBP with a VP8L (LOSSLESS) chunk at 512x512 — checked, ' +
    'because lossy WebP would quantise the Terrarium blue channel into metres; ' +
    'ACAO * and Cache-Control public, max-age=604800; zoom ceiling probed at ' +
    '14 points, dense to z12, sparse to z18',
  notes:
    'Opt-in only: absent from every entry in REGION_ELEVATION_SOURCES, so ' +
    'selectElevationSources can never return it. Reach it with ' +
    'getElevationSource("mapterhorn") and an explicit chain, and take the ' +
    'sparse tail with elevationEndpoint(source, { allowSparse: true }).',
});

/**
 * Shared shape for the national DTMs — all transcoded, all Terrarium-encoded out.
 *
 * σ defaults to `postingSigmaM(nativeResolutionM)` with the basis recorded as
 * an assumption. None of these eight publishers' accuracy statements was read
 * in this pass, and MESH-CALCULATOR §4.1 wants a vendor figure; writing one
 * from memory would be exactly the fabrication this registry refuses, so the
 * assumption is declared as an assumption and `docs/ELEVATION-SOURCES.md`
 * carries it as an open item. Any entry may override both fields once its
 * publisher's number is confirmed.
 */
function transcodedDtm(
  input: Omit<
    ElevationSourceInput,
    | 'delivery'
    | 'origin'
    | 'pathTemplate'
    | 'tileSize'
    | 'maxResponseBytes'
    | 'timeoutMs'
    | 'model'
    | 'verticalUncertaintyM'
    | 'verticalUncertaintyBasis'
  > &
    Partial<Pick<ElevationSource, 'verticalUncertaintyM' | 'verticalUncertaintyBasis'>>,
): ElevationSource {
  return defineElevationSource({
    verticalUncertaintyM: postingSigmaM(input.nativeResolutionM),
    verticalUncertaintyBasis: 'assumed-from-posting',
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
      GEDTM30,
      MAPTERHORN,
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
 * The global tail, appended to every chain in this order by
 * `selectElevationSources` whether or not a region names it.
 *
 * GEDTM30 first because it is bare earth at 10.69 m σ; Terrarium last because
 * it is the only direct source and therefore the only one that survives a
 * missing collection server. Mapterhorn is deliberately not here — see its
 * entry.
 */
const GLOBAL_TAIL: readonly ElevationSource[] = [GEDTM30, TERRARIUM];

/**
 * Preferred elevation source per region, best-quality first — the same shape
 * as `REGION_SOURCES` in `texture.py`.
 *
 * `GLOBAL_TAIL` is appended by `selectElevationSources` whether or not it is
 * named here, so a chain can never end in nothing.
 *
 * `madeira` is absent on purpose: see `docs/ELEVATION-SOURCES.md`. The demo's
 * own home region has no *national* bare-earth service this project could
 * confirm — but since 2026-08-02 it is no longer stuck on 30 m rooftop radar
 * either, because the tail's first link is a global bare-earth model.
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
 * The ordered source chain for a region: national DTMs first, then the global
 * bare-earth base, then Terrarium.
 *
 * A bbox filters the chain by coverage — the `europe` region spans a continent
 * whose national services each cover one country, so without this every
 * selection would start by asking Switzerland about Poland. `GLOBAL_TAIL` is
 * always appended, so "outside every national coverage" is not a failure: it
 * is a 30 m bare-earth model with its σ attached, and behind it a 30 m mixed
 * surface with a worse one.
 *
 * Mapterhorn is unreachable from here by construction. That is the spec's
 * ruling (MESH-CALCULATOR §2.2) implemented literally rather than as a comment:
 * a source that cannot say whether a tile is bare earth must be asked for by
 * name, never handed out by default.
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
  for (const source of GLOBAL_TAIL) {
    if (!chain.some((existing) => existing.id === source.id)) chain.push(source);
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

// --- Bare-earth guard --------------------------------------------------------

/** Bare earth, and only bare earth. `mixed` is not "probably fine". */
export function isBareEarthReference(source: ElevationSource): boolean {
  return source.model === 'dtm';
}

/**
 * Assert that a source may stand in as bare earth, or fail with a named error.
 *
 * The one thing that must never happen quietly: a surface model used where a
 * terrain model was meant. Buildings extruded from a roof, roads floating, a
 * radio path cleared by a canopy the model thinks is a hill. `mixed` sources —
 * Terrarium and Mapterhorn — are rejected here even though both are useful for
 * a picture, because "useful for a picture" and "sound as a reference" are
 * different claims.
 */
export function requireBareEarthReference(source: ElevationSource): ElevationSource {
  if (!isBareEarthReference(source)) {
    throw new ElevationSourceError(
      'NOT_BARE_EARTH',
      `${source.id} is model '${source.model}', so it cannot be a bare-earth reference`,
    );
  }
  return source;
}

/** The best bare-earth source in a chain, or null if the chain has none. */
export function bareEarthReference(
  sources: readonly ElevationSource[],
): ElevationSource | null {
  return sources.find(isBareEarthReference) ?? null;
}

// --- Endpoints ---------------------------------------------------------------

/**
 * The tile contract a caller should actually address a source with.
 *
 * For every dense source this is the source itself. For a sparse pyramid it is
 * the source with `maxZoom` clamped to `denseMaxZoom`, so the default request
 * is one the publisher can answer everywhere it claims to cover. `allowSparse`
 * is the opt-in: it hands back the full ceiling together with the caller's
 * acceptance that tiles outside the good footprints will 404 and the source
 * will demote.
 *
 * This is the whole of "opt-in resolution upgrade" as a two-line function
 * rather than a convention somebody has to remember.
 */
export function elevationEndpoint(
  source: ElevationSource,
  { allowSparse = false }: { allowSparse?: boolean } = {},
): ElevationSource {
  if (allowSparse || source.denseMaxZoom === null || source.denseMaxZoom === source.maxZoom) {
    return source;
  }
  return { ...source, maxZoom: source.denseMaxZoom };
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
  /** MESH-CALCULATOR §4.1 — carried so the UI can say how sure it is. */
  readonly verticalUncertaintyM: number;
  readonly verticalUncertaintyBasis: UncertaintyBasis;
  /** Non-null when the licence is an audit of many upstream datasets. */
  readonly composite: CompositeLicence | null;
  /** Ready to print. The line that discharges this source's obligation. */
  readonly credit: string;
};

/**
 * The credit line for one source — what has to appear under a rendered tile.
 *
 * A composite source's `attribution` already states its terms and points at
 * the per-dataset list, so appending the composite `license` string would
 * print the audit summary at a reader instead of a credit. Every other source
 * gets `attribution — license`, which is the shape CC BY 4.0 §3(a)(1) and the
 * Licence Ouverte both ask for: name the creator, name the terms.
 */
export function elevationCredit(source: ElevationSource): string {
  return source.composite === null
    ? `${source.attribution} — ${source.license}`
    : source.attribution;
}

/**
 * One line crediting every source that could contribute to a result.
 *
 * Deduplicated and in use order. This is what a UI renders when it does not
 * know which link of the chain answered; when it does know, credit that source
 * alone with `elevationCredit`.
 */
export function elevationCreditLine(sources: readonly ElevationSource[]): string {
  const seen = new Set<string>();
  const credits: string[] = [];
  for (const source of sources) {
    const credit = elevationCredit(source);
    if (seen.has(credit)) continue;
    seen.add(credit);
    credits.push(credit);
  }
  return credits.join(' · ');
}

/**
 * The attribution rows for a chain — every licence in it, in use order.
 *
 * CC-BY, Licence Ouverte and dl-de/by are infectious: the obligation travels
 * with the derived tile. A transcoded tile is a derived work of the national
 * coverage, so the licence has to reach whatever displays or stores it, which
 * is why this is a function of the chain and not of the one source that
 * happened to answer.
 *
 * Each row carries its own `credit`, so a caller that *does* know which source
 * answered can render one row and be legally complete, and a caller that does
 * not can render `elevationCreditLine` over the lot. Neither needs to know
 * anything about licences.
 */
export function elevationProvenance(sources: readonly ElevationSource[]): ElevationProvenance[] {
  return sources.map((source) => ({
    id: source.id,
    name: source.name,
    model: source.model,
    resolutionM: source.nativeResolutionM,
    license: source.license,
    attribution: source.attribution,
    verticalUncertaintyM: source.verticalUncertaintyM,
    verticalUncertaintyBasis: source.verticalUncertaintyBasis,
    composite: source.composite,
    credit: elevationCredit(source),
  }));
}
