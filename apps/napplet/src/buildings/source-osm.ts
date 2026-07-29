import { loadApprovedBytes } from '../shell/resource-client';
import type { Footprint } from './extrude';
import type { BBox4326 } from '../bbox/validate';

/**
 * OpenStreetMap building footprints via Overpass.
 *
 * Licence note: OSM data is ODbL — share-alike plus attribution. Anything
 * derived from these footprints inherits that obligation, which is why the
 * licence travels with the layer rather than being assumed.
 */
export const OSM_BUILDINGS_SOURCE = {
  scheme: 'https',
  host: 'overpass-api.de',
  port: 443,
  path: '/api/interpreter',
  attribution: '© OpenStreetMap contributors',
  license: 'ODbL-1.0',
  timeoutMs: 15_000,
  maxResponseBytes: 8_000_000,
} as const;

/** Assumed storey height where OSM gives levels but not metres. */
export const METRES_PER_LEVEL = 3.0;

/** Fallback for a building with no height information at all. */
export const DEFAULT_BUILDING_HEIGHT_M = 6.0;

/** Refuse to extrude absurd values that would spike through the scene. */
const MAX_BUILDING_HEIGHT_M = 400;

const ORIGIN = new URL(
  `${OSM_BUILDINGS_SOURCE.scheme}://${OSM_BUILDINGS_SOURCE.host}:${OSM_BUILDINGS_SOURCE.port}`,
).origin;

type OverpassElement = {
  type?: string;
  tags?: Record<string, string>;
  geometry?: { lat?: number; lon?: number }[];
};

export function overpassQuery(bbox: BBox4326, limit: number): string {
  const [west, south, east, north] = bbox;
  // `out geom` returns full ring coordinates without a second node lookup.
  return `[out:json][timeout:25];way["building"](${south},${west},${north},${east});out geom ${limit};`;
}

export function buildingsUrl(bbox: BBox4326, limit: number): string {
  const url = new URL(`${ORIGIN}${OSM_BUILDINGS_SOURCE.path}`);
  url.searchParams.set('data', overpassQuery(bbox, limit));
  return url.toString();
}

/** Fail-closed allowlist: the Overpass origin, its one path, and only a `data` query. */
export function isApprovedBuildingsUrl(candidate: string): boolean {
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return false;
  }
  if (url.origin !== ORIGIN) return false;
  if (url.pathname !== OSM_BUILDINGS_SOURCE.path) return false;
  if (url.hash || url.username || url.password) return false;
  return [...url.searchParams.keys()].every((key) => key === 'data');
}

/** Derive a usable height in metres from OSM tags. */
export function heightFromTags(tags: Record<string, string> | undefined): number {
  const explicit = Number.parseFloat(tags?.height ?? '');
  if (Number.isFinite(explicit) && explicit > 0) {
    return Math.min(explicit, MAX_BUILDING_HEIGHT_M);
  }
  const levels = Number.parseFloat(tags?.['building:levels'] ?? '');
  if (Number.isFinite(levels) && levels > 0) {
    return Math.min(levels * METRES_PER_LEVEL, MAX_BUILDING_HEIGHT_M);
  }
  return DEFAULT_BUILDING_HEIGHT_M;
}

export function parseOverpass(payload: unknown): Footprint[] {
  const elements = (payload as { elements?: OverpassElement[] })?.elements;
  if (!Array.isArray(elements)) return [];

  const footprints: Footprint[] = [];
  for (const element of elements) {
    if (element.type !== 'way' || !Array.isArray(element.geometry)) continue;

    const ring: [number, number][] = [];
    for (const point of element.geometry) {
      if (typeof point?.lat === 'number' && typeof point?.lon === 'number') {
        ring.push([point.lon, point.lat]);
      }
    }
    if (ring.length < 3) continue;

    footprints.push({ ring, heightM: heightFromTags(element.tags) });
  }
  return footprints;
}

export type FetchBuildingsOptions = {
  signal?: AbortSignal;
  limit?: number;
};

/** Fetch building footprints for a bbox through the shell resource capability. */
export async function fetchBuildings(
  bbox: BBox4326,
  { signal, limit = 2000 }: FetchBuildingsOptions = {},
): Promise<Footprint[]> {
  const url = buildingsUrl(bbox, limit);
  const blob = await loadApprovedBytes(url, {
    deadlineMs: OSM_BUILDINGS_SOURCE.timeoutMs,
    isAllowed: isApprovedBuildingsUrl,
    signal,
  });
  if (blob.size > OSM_BUILDINGS_SOURCE.maxResponseBytes) {
    throw new Error('Building response exceeded the approved size bound.');
  }
  return parseOverpass(JSON.parse(await blob.text()));
}
