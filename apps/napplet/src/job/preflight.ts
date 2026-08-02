import { loadApprovedBytes } from '../shell/resource-client';
import { cachedOsmUrl, isApprovedCachedOsmUrl } from './collection';
import { ORTHO_SERVICE, isApprovedOrthoUrl } from './ortho';
import { chooseDemZoom } from '@terrcvm/terrain-engine/terrain/dem';
import {
  chooseElevationSource,
  type ElevationSource,
} from '@terrcvm/terrain-engine/terrain/elevation-sources';
import { TERRAIN_GRID_N } from '../terrain/generate';
import type { BBox4326 } from '@terrcvm/terrain-engine/bbox/validate';

/**
 * Pre-flight availability for a selection, answered before any generation:
 * what terrain, orthophoto, street and waterway data actually exists here,
 * and how sharp the texture can get. The ortho answer comes from the
 * server's plan endpoint — the same caps the real bake applies — and the
 * feature counts from cached Overpass count queries.
 */

const EARTH_CIRCUMFERENCE_M = 40_075_016.686;

export type OrthoPlan = {
  region: string;
  sourceName: string;
  mPerPx: number;
  notes: string[];
};

export type TerrainPlan = {
  zoom: number;
  mPerPx: number;
  /** Which source that resolution comes from, and what it is allowed to be used for. */
  sourceName: string;
  license: string;
  /** `dtm` is bare earth. Worth saying out loud: the fallback is not. */
  model: ElevationSource['model'];
};

export type PreflightReport = {
  terrain: TerrainPlan;
  /** null: the collection server did not answer — stated, not guessed. */
  ortho: OrthoPlan | null;
  streets: number | null;
  waterways: number | null;
};

/**
 * What terrain this selection would actually get, from which source.
 *
 * The source has to be resolved here rather than assumed: a 30 m DSM and a
 * 0.5 m bare-earth DTM give the same picture in the viewport and a 65 m
 * difference in the model, so "how sharp" is not answerable without naming
 * where the numbers come from.
 */
export function demResolution(bbox: BBox4326, region?: string): TerrainPlan {
  const source = chooseElevationSource(region ?? null, bbox);
  const zoom = chooseDemZoom(bbox, TERRAIN_GRID_N, source);
  const midLat = ((bbox[1] + bbox[3]) / 2) * (Math.PI / 180);
  const mPerPx = (EARTH_CIRCUMFERENCE_M * Math.cos(midLat)) / (2 ** zoom * source.tileSize);
  return {
    zoom,
    mPerPx,
    sourceName: source.name,
    license: source.license,
    model: source.model,
  };
}

export function countQuery(bbox: BBox4326, key: 'highway' | 'waterway'): string {
  const [west, south, east, north] = bbox;
  return `[out:json][timeout:25];way["${key}"](${south},${west},${north},${east});out count;`;
}

/** Overpass `out count` answers with a single count element. */
export function parseOverpassCount(payload: unknown): number | null {
  const elements = (payload as { elements?: { tags?: Record<string, string> }[] })?.elements;
  const ways = elements?.[0]?.tags?.ways;
  const parsed = Number.parseInt(ways ?? '', 10);
  return Number.isFinite(parsed) ? parsed : null;
}

export function orthoPlanUrl(region: string, bbox: BBox4326): string {
  const params = new URLSearchParams({
    region,
    bbox: bbox.map((v) => v.toFixed(6)).join(','),
    target: String(ORTHO_SERVICE.targetMPerPx),
  });
  return `${ORTHO_SERVICE.baseUrl}/texture/plan?${params.toString()}`;
}

export function parseOrthoPlan(raw: unknown): OrthoPlan {
  const record = raw as Record<string, unknown> | null;
  const source = record?.source as Record<string, unknown> | undefined;
  if (
    typeof record?.region !== 'string' ||
    typeof record?.m_per_px !== 'number' ||
    typeof source?.name !== 'string'
  ) {
    throw new Error('Texture plan is missing required fields.');
  }
  return {
    region: record.region,
    sourceName: source.name,
    mPerPx: record.m_per_px,
    notes: Array.isArray(record.notes)
      ? (record.notes as unknown[]).filter((n): n is string => typeof n === 'string')
      : [],
  };
}

async function fetchJson(
  url: string,
  isAllowed: (candidate: string) => boolean,
  signal?: AbortSignal,
): Promise<unknown> {
  const blob = await loadApprovedBytes(url, { deadlineMs: 15_000, isAllowed, signal });
  return JSON.parse(await blob.text());
}

export async function runPreflight(
  region: string,
  bbox: BBox4326,
  { signal }: { signal?: AbortSignal } = {},
): Promise<PreflightReport> {
  const [ortho, streets, waterways] = await Promise.all([
    fetchJson(orthoPlanUrl(region, bbox), isApprovedOrthoUrl, signal)
      .then(parseOrthoPlan)
      .catch(() => null),
    fetchJson(cachedOsmUrl(countQuery(bbox, 'highway')), isApprovedCachedOsmUrl, signal)
      .then(parseOverpassCount)
      .catch(() => null),
    fetchJson(cachedOsmUrl(countQuery(bbox, 'waterway')), isApprovedCachedOsmUrl, signal)
      .then(parseOverpassCount)
      .catch(() => null),
  ]);

  return { terrain: demResolution(bbox, region), ortho, streets, waterways };
}
