import { loadApprovedBytes } from '../shell/resource-client';
import { COLLECTION_SERVICE, collectionOrigin } from '../job/collection';
import type { Footprint } from '@terrdvm/terrain-engine/buildings/extrude';
import type { BBox4326 } from '@terrdvm/terrain-engine/bbox/validate';

/**
 * Vienna's building-body model (Baukörpermodell, FMZKBKMOGD) through the
 * collection server's cached WFS proxy.
 *
 * Each feature is one building *part* with photogrammetrically measured
 * elevations: O_KOTE is the top of the part, T_KOTE the terrain under it —
 * the difference is a measured height, a different league from OSM's storey
 * guesses. Licence CC-BY 4.0, attribution Stadt Wien.
 */

export const WIEN_BUILDINGS_ATTRIBUTION = 'Buildings: Stadt Wien (CC-BY 4.0), Baukörpermodell';

/** Reject nonsense parts: negative or tower-of-babel heights are data errors. */
const MIN_PART_HEIGHT_M = 1.5;
const MAX_PART_HEIGHT_M = 220;

export function wienBuildingsUrl(bbox: BBox4326): string {
  const params = new URLSearchParams({
    src: 'vienna-bkm',
    bbox: bbox.map((v) => v.toFixed(6)).join(','),
  });
  return `${COLLECTION_SERVICE.baseUrl}/wfs?${params.toString()}`;
}

export function isApprovedWienBuildingsUrl(candidate: string): boolean {
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return false;
  }
  if (url.origin !== collectionOrigin() || url.pathname !== '/wfs') return false;
  return [...url.searchParams.keys()].every((key) => key === 'src' || key === 'bbox');
}

type WfsFeature = {
  geometry?: { type?: string; coordinates?: unknown };
  properties?: Record<string, unknown>;
};

function ringsOf(geometry: WfsFeature['geometry']): [number, number][][] {
  if (!geometry) return [];
  if (geometry.type === 'Polygon') {
    const outer = (geometry.coordinates as [number, number][][])?.[0];
    return outer ? [outer] : [];
  }
  if (geometry.type === 'MultiPolygon') {
    return ((geometry.coordinates as [number, number][][][]) ?? [])
      .map((polygon) => polygon?.[0])
      .filter((ring): ring is [number, number][] => Array.isArray(ring));
  }
  return [];
}

/** Parse the WFS answer into footprints; parts without both kotes are dropped. */
export function parseWienBuildings(payload: unknown): Footprint[] {
  const features = (payload as { features?: WfsFeature[] })?.features;
  if (!Array.isArray(features)) return [];
  const footprints: Footprint[] = [];
  for (const feature of features) {
    const top = Number(feature.properties?.O_KOTE);
    const terrain = Number(feature.properties?.T_KOTE);
    if (!Number.isFinite(top) || !Number.isFinite(terrain)) continue;
    const heightM = top - terrain;
    if (heightM < MIN_PART_HEIGHT_M || heightM > MAX_PART_HEIGHT_M) continue;
    for (const ring of ringsOf(feature.geometry)) {
      if (ring.length >= 3) footprints.push({ ring, heightM });
    }
  }
  return footprints;
}

export async function fetchWienBuildings(
  bbox: BBox4326,
  { signal }: { signal?: AbortSignal } = {},
): Promise<Footprint[]> {
  const blob = await loadApprovedBytes(wienBuildingsUrl(bbox), {
    deadlineMs: 60_000,
    isAllowed: isApprovedWienBuildingsUrl,
    signal,
  });
  return parseWienBuildings(JSON.parse(await blob.text()));
}
