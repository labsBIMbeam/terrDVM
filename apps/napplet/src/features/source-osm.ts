import {
  cachedOsmUrl,
  isApprovedCachedOsmUrl,
  loadBytesCacheFirst,
} from '../job/collection';
import {
  ROAD_CLASSES,
  type BuildingFeature,
  type LanduseClass,
  type LanduseFeature,
  type RoadClass,
  type RoadFeature,
} from './types';
import { heightFromTags, isApprovedBuildingsUrl, OSM_BUILDINGS_SOURCE } from '../buildings/source-osm';
import type { BBox4326 } from '../bbox/validate';

/**
 * One Overpass round trip for both layers.
 *
 * Fetching buildings and roads together halves the request count against a
 * rate-limited endpoint, while the layers stay separate everywhere downstream:
 * separate arrays, separate encoding, separate draw calls.
 */

const ROAD_CLASS_SET = new Set<string>(ROAD_CLASSES);

const ORIGIN = new URL(
  `${OSM_BUILDINGS_SOURCE.scheme}://${OSM_BUILDINGS_SOURCE.host}:${OSM_BUILDINGS_SOURCE.port}`,
).origin;

export type OsmFeatures = {
  buildings: BuildingFeature[];
  roads: RoadFeature[];
  landuse: LanduseFeature[];
};

/**
 * OSM tags to stored land-cover classes.
 *
 * `landuse` and `natural` overlap in practice (a wood is tagged either way), so
 * both are consulted and collapsed onto one vocabulary.
 */
const LANDUSE_TAG_MAP: Record<string, LanduseClass> = {
  forest: 'forest',
  wood: 'forest',
  farmland: 'farmland',
  farmyard: 'farmland',
  orchard: 'orchard',
  vineyard: 'vineyard',
  meadow: 'meadow',
  grass: 'grass',
  grassland: 'grass',
  village_green: 'grass',
  scrub: 'scrub',
  heath: 'heath',
  wetland: 'wetland',
  marsh: 'wetland',
  water: 'water',
  reservoir: 'water',
  basin: 'water',
  residential: 'residential',
  industrial: 'industrial',
  commercial: 'commercial',
  retail: 'commercial',
  quarry: 'quarry',
  bare_rock: 'bare_rock',
  scree: 'bare_rock',
};

export function landuseClassFor(tags: Record<string, string> | undefined): LanduseClass | null {
  if (!tags) return null;
  for (const key of ['landuse', 'natural', 'leisure'] as const) {
    const value = tags[key];
    if (value && LANDUSE_TAG_MAP[value]) return LANDUSE_TAG_MAP[value];
  }
  return null;
}

export function featuresQuery(bbox: BBox4326, limit: number): string {
  const [west, south, east, north] = bbox;
  const area = `${south},${west},${north},${east}`;
  return (
    '[out:json][timeout:25];(' +
    `way["building"](${area});` +
    `way["highway"](${area});` +
    `way["landuse"](${area});` +
    `way["natural"](${area});` +
    `);out geom ${limit};`
  );
}

export function featuresUrl(bbox: BBox4326, limit: number): string {
  const url = new URL(`${ORIGIN}${OSM_BUILDINGS_SOURCE.path}`);
  url.searchParams.set('data', featuresQuery(bbox, limit));
  return url.toString();
}

/** Map an OSM `highway` value onto a stored road class, or null to drop it. */
export function roadClassFor(highway: string | undefined): RoadClass | null {
  if (!highway) return null;
  const base = highway.replace(/_link$/, '');
  if (ROAD_CLASS_SET.has(base)) return base as RoadClass;
  // Everything walkable collapses into `path`; anything else is not a road.
  if (base === 'footway' || base === 'pedestrian' || base === 'steps' || base === 'cycleway') {
    return 'path';
  }
  if (base === 'unclassified' || base === 'living_street') return 'residential';
  return null;
}

type OverpassElement = {
  type?: string;
  tags?: Record<string, string>;
  geometry?: { lat?: number; lon?: number }[];
};

function ringOf(element: OverpassElement): [number, number][] {
  const points: [number, number][] = [];
  for (const point of element.geometry ?? []) {
    if (typeof point?.lat === 'number' && typeof point?.lon === 'number') {
      points.push([point.lon, point.lat]);
    }
  }
  return points;
}

export function parseFeatures(payload: unknown): OsmFeatures {
  const elements = (payload as { elements?: OverpassElement[] })?.elements;
  const result: OsmFeatures = { buildings: [], roads: [], landuse: [] };
  if (!Array.isArray(elements)) return result;

  for (const element of elements) {
    if (element.type !== 'way') continue;
    const tags = element.tags ?? {};

    if (tags.building) {
      const ring = ringOf(element);
      if (ring.length >= 3) {
        result.buildings.push({ ring, heightM: heightFromTags(tags) });
      }
      continue;
    }

    if (tags.highway) {
      const roadClass = roadClassFor(tags.highway);
      if (roadClass) {
        const line = ringOf(element);
        if (line.length >= 2) result.roads.push({ line, roadClass });
      }
      continue;
    }

    const landuseClass = landuseClassFor(tags);
    if (landuseClass) {
      const ring = ringOf(element);
      if (ring.length >= 3) result.landuse.push({ ring, landuseClass });
    }
  }

  return result;
}

export type FetchFeaturesOptions = {
  signal?: AbortSignal;
  limit?: number;
};

export async function fetchFeatures(
  bbox: BBox4326,
  { signal, limit = 3000 }: FetchFeaturesOptions = {},
): Promise<OsmFeatures> {
  // Collection-server cache first: Overpass throttles repeated identical
  // queries, which a demo rerun is by definition. Direct Overpass remains the
  // fallback so the app works without a server.
  const blob = await loadBytesCacheFirst(
    cachedOsmUrl(featuresQuery(bbox, limit)),
    isApprovedCachedOsmUrl,
    featuresUrl(bbox, limit),
    {
      deadlineMs: OSM_BUILDINGS_SOURCE.timeoutMs,
      isAllowed: isApprovedBuildingsUrl,
      signal,
    },
  );
  if (blob.size > OSM_BUILDINGS_SOURCE.maxResponseBytes) {
    throw new Error('Feature response exceeded the approved size bound.');
  }
  return parseFeatures(JSON.parse(await blob.text()));
}
