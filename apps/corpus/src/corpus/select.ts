/**
 * Reading the corpus: what the relay says, refined into what covers a tile.
 *
 * Pure by construction — no DOM, no transport, no shell. Everything here takes
 * events and returns facts, which is what makes the load-bearing decisions
 * (does this item cover the tile I asked about? which dataset is missing?)
 * testable without a browser or a running stack.
 *
 * The refinement step is not optional politeness. A `#g` query returns a
 * SUPERSET — every item whose tile centre lands in the same geohash cell — so
 * the client that skips refinement renders its neighbour's data and calls it
 * this tile.
 */

import {
  GEOHASH_PRECISION,
  KIND_GEO_COLLECTION,
  KIND_GEO_ITEM,
  encode,
  parseItemD,
  tileCenter,
  type Tile,
} from '@terrcvm/geo-protocol';
import type { BBox4326 } from '@terrcvm/terrain-engine/bbox/validate';
import type { RelayEvent } from '@terrcvm/napplet-kit/shell/outbox-client';

/**
 * Coarsest zoom a dataset is assumed to publish at.
 *
 * `queryCells` walks ancestors down to here so a dataset on a coarser ladder
 * than the tile being viewed is still FINDABLE: its tile centre is a different
 * point and therefore possibly a different geohash cell. z8 is ~150 km per
 * tile; coarser than that is not a tile corpus.
 */
export const MIN_DATASET_ZOOM = 8;

export type CorpusItem = {
  dataset: string;
  tile: Tile;
  sha256: string;
  url: string;
  mimeType: string;
  size: number;
  bbox: BBox4326;
  createdAt: number;
  pubkey: string;
};

export type CorpusCollection = {
  dataset: string;
  title: string;
  bbox: BBox4326;
  mimeType: string;
  license: string;
  source: string;
  /** Where this dataset's blobs live — learned from the event, never configured. */
  server: string;
  description: string;
  createdAt: number;
};

export type DatasetCoverage = {
  dataset: string;
  covered: boolean;
  /** The tile that actually answered, which may be coarser than the one asked for. */
  tile: Tile | null;
};

function tagValue(event: RelayEvent, name: string): string | null {
  const tag = event.tags.find((entry) => entry[0] === name);
  return tag === undefined || typeof tag[1] !== 'string' ? null : tag[1];
}

function finiteNumber(value: unknown): number | null {
  const parsed = typeof value === 'string' ? Number(value) : value;
  return typeof parsed === 'number' && Number.isFinite(parsed) ? parsed : null;
}

function bboxFrom(values: readonly unknown[]): BBox4326 | null {
  if (values.length !== 4) return null;
  const [west, south, east, north] = values.map(finiteNumber);
  if (west === null || south === null || east === null || north === null) return null;
  return [west, south, east, north];
}

/**
 * Does `outer` contain `inner`?
 *
 * True for the same tile and for any ancestor. This is what lets the DEM
 * dataset live at z13 while features live at z14: the client asks about a
 * z14 tile and the z13 parent legitimately answers for it. The reverse is
 * false — a finer tile covers only part of a coarser one, and part is not
 * cover.
 */
export function tileCovers(outer: Tile, inner: Tile): boolean {
  if (outer.z > inner.z) return false;
  const shift = inner.z - outer.z;
  return (inner.x >> shift) === outer.x && (inner.y >> shift) === outer.y;
}

/**
 * The geohash cells to ask a relay for, when the question is "what covers this
 * tile".
 *
 * The tile's own cell plus every ancestor's cell. Ancestor centres are
 * different points, so a coarse dataset can sit in a cell the wanted tile is
 * nowhere near; asking only for the wanted tile's cell would silently miss it.
 * In the Funchal case every cell collapses to `etgc`, which is exactly why
 * this has to be derived rather than assumed.
 */
export function queryCells(tile: Tile, minZoom: number = MIN_DATASET_ZOOM): string[] {
  const cells = new Set<string>();
  // `min(minZoom, tile.z)` so a tile ALREADY coarser than the floor still
  // yields its own cell. Bounding on minZoom alone returned an empty cell list
  // there, which a relay reads as "match nothing" — a query that silently
  // cannot succeed.
  const floor = Math.max(0, Math.min(minZoom, tile.z));
  for (let z = tile.z; z >= floor; z -= 1) {
    const shift = tile.z - z;
    const center = tileCenter({ z, x: tile.x >> shift, y: tile.y >> shift });
    cells.add(encode(center.lat, center.lon, GEOHASH_PRECISION));
  }
  return [...cells];
}

/**
 * An item event as facts, or null.
 *
 * Null rather than throwing: these arrive from a relay, where malformed is
 * normal traffic and not an exceptional condition. Every field the render path
 * needs is required here, so a half-formed item can never reach it — most
 * importantly `x`, without which the bytes could not be verified and therefore
 * must never be fetched.
 */
export function parseItemEvent(event: RelayEvent): CorpusItem | null {
  if (event.kind !== KIND_GEO_ITEM) return null;

  const d = tagValue(event, 'd');
  const parsed = d === null ? null : parseItemD(d);
  if (parsed === null) return null;

  const sha256 = tagValue(event, 'x');
  const url = tagValue(event, 'url');
  const mimeType = tagValue(event, 'm');
  const size = finiteNumber(tagValue(event, 'size'));
  if (sha256 === null || url === null || mimeType === null || size === null) return null;
  if (!/^[0-9a-f]{64}$/.test(sha256)) return null;

  let content: unknown;
  try {
    content = JSON.parse(event.content);
  } catch {
    return null;
  }
  if (typeof content !== 'object' || content === null) return null;
  const rawBbox = (content as { bbox?: unknown }).bbox;
  const bbox = Array.isArray(rawBbox) ? bboxFrom(rawBbox) : null;
  if (bbox === null) return null;

  return {
    dataset: parsed.dataset,
    tile: parsed.tile,
    sha256,
    url,
    mimeType,
    size,
    bbox,
    createdAt: event.created_at,
    pubkey: event.pubkey,
  };
}

/**
 * A collection event as facts, or null.
 *
 * `server`, `license` and `source` are required because they are the reason
 * this layer exists: the client learns where bytes live and what it must
 * credit FROM THE PROTOCOL, not from its own configuration. A collection
 * without a server names no place to fetch from and is not usable.
 */
export function parseCollectionEvent(event: RelayEvent): CorpusCollection | null {
  if (event.kind !== KIND_GEO_COLLECTION) return null;

  const dataset = tagValue(event, 'd');
  const title = tagValue(event, 'title');
  const mimeType = tagValue(event, 'm');
  const license = tagValue(event, 'license');
  const source = tagValue(event, 'source');
  const server = tagValue(event, 'server');
  if (
    dataset === null ||
    title === null ||
    mimeType === null ||
    license === null ||
    source === null ||
    server === null
  ) {
    return null;
  }

  const bboxTag = event.tags.find((entry) => entry[0] === 'bbox');
  const bbox = bboxTag === undefined ? null : bboxFrom(bboxTag.slice(1));
  if (bbox === null) return null;

  return {
    dataset,
    title,
    bbox,
    mimeType,
    license,
    source,
    server,
    description: event.content,
    createdAt: event.created_at,
  };
}

/**
 * The refinement: from a cell's worth of items to the best item per dataset
 * that actually covers the wanted tile.
 *
 * Ordering rules, in force order: finer tiles beat coarser ones (a z14 answer
 * is about this tile, a z13 answer is about this tile and three others), then
 * newer events beat older ones. Both are decided here rather than left to
 * relay order, which NIP-01 does not promise.
 */
export function selectForTile(items: readonly CorpusItem[], wanted: Tile): Map<string, CorpusItem> {
  const best = new Map<string, CorpusItem>();

  for (const item of items) {
    if (!tileCovers(item.tile, wanted)) continue;
    const incumbent = best.get(item.dataset);
    if (incumbent === undefined) {
      best.set(item.dataset, item);
      continue;
    }
    const finer = item.tile.z > incumbent.tile.z;
    const sameZoomAndNewer =
      item.tile.z === incumbent.tile.z && item.createdAt > incumbent.createdAt;
    if (finer || sameZoomAndNewer) best.set(item.dataset, item);
  }

  return best;
}

/**
 * Per-dataset coverage for one tile — the input to an honest no-data state.
 *
 * Every dataset the publisher announces appears in the report, covered or not.
 * A missing dataset must be NAMED: "no features here" and "no data at all" are
 * different facts about the world, and collapsing them is the failure mode
 * this project exists to avoid.
 */
export function coverageForTile(
  collections: readonly CorpusCollection[],
  items: readonly CorpusItem[],
  wanted: Tile,
): DatasetCoverage[] {
  const selected = selectForTile(items, wanted);
  const datasets = new Set<string>([
    ...collections.map((collection) => collection.dataset),
    ...items.map((item) => item.dataset),
  ]);

  return [...datasets].sort().map((dataset) => {
    const hit = selected.get(dataset);
    return { dataset, covered: hit !== undefined, tile: hit?.tile ?? null };
  });
}
