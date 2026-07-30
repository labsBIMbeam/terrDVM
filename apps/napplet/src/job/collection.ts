import { loadApprovedBytes, type LoadApprovedBytesOptions } from '../shell/resource-client';

/**
 * The local collection server: per-extent orthophoto bakes plus a request
 * cache for DEM tiles and Overpass answers.
 *
 * Cache-first, upstream-fallback: the demo gets disk-speed reruns and stops
 * hammering rate-limited endpoints — Overpass throttling was observed live as
 * buildings silently vanishing — while a missing server degrades to exactly
 * the direct-fetch behaviour the app had before.
 */
export const COLLECTION_SERVICE = {
  baseUrl: 'http://127.0.0.1:8787',
} as const;

export function collectionOrigin(): string {
  return new URL(COLLECTION_SERVICE.baseUrl).origin;
}

/** Cached DEM tile on the collection server. */
export function cachedDemTileUrl(z: number, x: number, y: number): string {
  return `${COLLECTION_SERVICE.baseUrl}/dem/${z}/${x}/${y}.png`;
}

export function isApprovedCachedDemUrl(candidate: string): boolean {
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return false;
  }
  if (url.origin !== collectionOrigin()) return false;
  if (url.search || url.hash || url.username || url.password) return false;
  return /^\/dem\/[0-9]+\/[0-9]+\/[0-9]+\.png$/.test(url.pathname);
}

/** Cached Overpass answer on the collection server; the query travels verbatim. */
export function cachedOsmUrl(query: string): string {
  const url = new URL(`${COLLECTION_SERVICE.baseUrl}/osm`);
  url.searchParams.set('data', query);
  return url.toString();
}

export function isApprovedCachedOsmUrl(candidate: string): boolean {
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return false;
  }
  if (url.origin !== collectionOrigin()) return false;
  if (url.pathname !== '/osm') return false;
  if (url.hash || url.username || url.password) return false;
  return [...url.searchParams.keys()].every((key) => key === 'data');
}

/**
 * The demo character, addressed by content hash. The generator
 * (`python -m blossom_gis.cli character`) is byte-deterministic, so this
 * SHA-256 is the same on every machine that runs it — content addressing
 * instead of a registry.
 */
export const CHARACTER_SHA = '74c9d7817e96f40b073f0d2c4d70b8116e3662f2cc91ee5a76f8b24eea1573e2';

export function characterUrl(): string {
  return `${COLLECTION_SERVICE.baseUrl}/${CHARACTER_SHA}.glb`;
}

export function isApprovedCharacterUrl(candidate: string): boolean {
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return false;
  }
  return (
    url.origin === collectionOrigin() &&
    /^\/[0-9a-f]{64}\.glb$/.test(url.pathname) &&
    !url.search &&
    !url.hash
  );
}

/** Fetch the character blob; a missing blob is a normal, named failure. */
export async function fetchCharacterBytes(signal?: AbortSignal): Promise<ArrayBuffer> {
  const blob = await loadApprovedBytes(characterUrl(), {
    deadlineMs: 15_000,
    isAllowed: isApprovedCharacterUrl,
    signal,
  });
  return blob.arrayBuffer();
}

/**
 * Try the collection server's cache, fall back to the direct upstream fetch.
 * Both attempts go through `loadApprovedBytes` with their own allowlists, so
 * neither path widens what the shell may be asked for.
 */
export async function loadBytesCacheFirst(
  cacheUrl: string,
  isCacheAllowed: (url: string) => boolean,
  directUrl: string,
  options: LoadApprovedBytesOptions,
): Promise<Blob> {
  try {
    return await loadApprovedBytes(cacheUrl, { ...options, isAllowed: isCacheAllowed });
  } catch {
    return loadApprovedBytes(directUrl, options);
  }
}
