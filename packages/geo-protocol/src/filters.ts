import {
  DEFAULT_FILTER_LIMIT,
  GEOHASH_PRECISION,
  KIND_GEO_COLLECTION,
  KIND_GEO_ITEM,
  MAX_COVER_CELLS,
} from './kinds';
import { coverCellCount, coverCells } from './geohash';
import { assertViewport, type BBox4326 } from './bbox';
import { collectionAddress } from './collection';
import { itemD } from './item';
import { reject } from './errors';
import { assertFilterLimit, assertHex64 } from './validate';
import type { Tile } from './tile';

/** The subset of a NIP-01 REQ filter this protocol ever needs. */
export type NostrFilter = {
  kinds: number[];
  authors?: string[];
  '#d'?: string[];
  '#g'?: string[];
  '#a'?: string[];
  limit?: number;
};

/**
 * Every collection. Collections are few and their `bbox` tag is not indexed
 * (it is not single-letter), so wholesale fetch plus local filtering is not a
 * shortcut — it is the only thing NIP-01 makes possible.
 */
export function catalog(options: { authors?: string[]; limit?: number } = {}): NostrFilter {
  const limit = resolveLimit(options.limit);
  const filter: NostrFilter = { kinds: [KIND_GEO_COLLECTION] };
  if (options.authors) filter.authors = copyAuthors(options.authors);
  filter.limit = limit;
  return filter;
}

/**
 * Items whose tile centre falls in the geohash cells covering a viewport.
 *
 * Returns NULL — not an error — when the cover exceeds `maxCells`. That is a
 * ROUTING SIGNAL: the caller falls back to `catalog()` and renders from the
 * collection layer, rather than sending a filter the relay will drop. A relay
 * that refuses a filter answers with CLOSED, not with an empty set, so the
 * difference matters.
 *
 * A malformed viewport still THROWS, because that is a caller bug and not a
 * routing decision.
 *
 * Note the tag-key budget: `#g` plus an optional `#a` is two keys, and
 * strfry's default `maxTagsPerFilter` is 3. There is room for exactly one more
 * dimension before relays start refusing outright.
 *
 * The bbox-or-cell-list overload of version 1 is gone: one signature, one
 * behaviour, no per-language convenience.
 */
export function nearby(
  bbox: BBox4326,
  options: {
    collection?: { pubkey: string; dataset: string };
    maxCells?: number;
    limit?: number;
  } = {},
): NostrFilter | null {
  const limit = resolveLimit(options.limit);
  const maxCells = options.maxCells ?? MAX_COVER_CELLS;
  if (!Number.isInteger(maxCells) || maxCells < 1) {
    reject('FILTER_LIMIT_RANGE', `maxCells must be a positive integer, got ${String(maxCells)}`);
  }

  assertViewport(bbox);
  if (coverCellCount(bbox, GEOHASH_PRECISION) > maxCells) return null;

  const filter: NostrFilter = {
    kinds: [KIND_GEO_ITEM],
    '#g': coverCells(bbox, GEOHASH_PRECISION),
  };
  if (options.collection) {
    filter['#a'] = [collectionAddress(options.collection.pubkey, options.collection.dataset)];
  }
  filter.limit = limit;
  return filter;
}

/**
 * The item for one tile of one dataset, by `d`.
 *
 * The limit is `DEFAULT_FILTER_LIMIT`, NOT 1, and that is deliberate.
 * Addressable identity is `(kind, pubkey, d)`, so several publishers can
 * legitimately hold the same `d`. NIP-01 only says a relay SHOULD return the
 * most recent events, and "most recent" across several pubkeys is not "the
 * most recent from each" — `limit: 1` silently hides every publisher but one.
 * Callers who want a single publisher pass `authors`.
 */
export function exactTile(
  dataset: string,
  tile: Tile,
  options: { authors?: string[]; limit?: number } = {},
): NostrFilter {
  const limit = resolveLimit(options.limit);
  const d = itemD(dataset, tile);
  const filter: NostrFilter = { kinds: [KIND_GEO_ITEM] };
  if (options.authors) filter.authors = copyAuthors(options.authors);
  filter['#d'] = [d];
  filter.limit = limit;
  return filter;
}

/**
 * `limit > MAX_FILTER_LIMIT` is REJECTED rather than clamped: strfry clamps
 * silently, so a full page would be indistinguishable from a truncated one and
 * the caller could never tell a complete answer from a hole in the map.
 */
function resolveLimit(limit: number | undefined): number {
  if (limit === undefined) return DEFAULT_FILTER_LIMIT;
  assertFilterLimit(limit);
  return limit;
}

/**
 * Authors are copied, never aliased, so a caller mutating its array afterwards
 * cannot rewrite a filter already handed to the transport.
 *
 * CONTRACT.md is silent on whether `authors` entries are validated; the
 * stricter option is taken. An `npub` in `authors` matches nothing on any
 * relay and returns an empty set, which is indistinguishable from "this
 * publisher has no data" — the same class of silent wrong answer the rest of
 * this layer exists to remove.
 */
function copyAuthors(authors: readonly string[]): string[] {
  for (const author of authors) assertHex64(author, 'authors[]');
  return [...authors];
}
