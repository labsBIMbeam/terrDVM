/**
 * Discovery and delivery: relay events in, verified bytes out.
 *
 * Two gates, both mandatory, both here rather than at the edges:
 *
 *  1. **Every event is verified and re-attributed.** An `authors` filter is a
 *     REQUEST to a relay, not a proof of authorship — the relay is free to
 *     answer with anything. So each event's id and signature are recomputed,
 *     and its pubkey is compared against the pinned publisher. A perfectly
 *     valid event from the wrong key is dropped exactly like a forgery.
 *  2. **Every blob is hashed before it is used.** A URL containing a SHA-256
 *     is a request for those bytes; what arrives is a stranger's reply until
 *     it hashes to the `x` tag of the item that announced it.
 *
 * The transport is injected, which is what keeps this testable without a
 * relay, and what lets the same code run on the shell OUTBOX domain in a
 * napplet and on a plain WebSocket in `vite dev`.
 */

import { KIND_GEO_ITEM, catalog, type Tile } from '@terrcvm/geo-protocol';
import type { RelayEvent, RelayFilter } from '@terrcvm/napplet-kit/shell/outbox-client';
import { isVerifiedEvent, verifyBlob } from '@terrcvm/napplet-kit/verify';
import {
  coverageForTile,
  parseCollectionEvent,
  parseItemEvent,
  queryCells,
  selectForTile,
  type CorpusCollection,
  type CorpusItem,
  type DatasetCoverage,
} from './select';

export type CorpusTransport = {
  query: (filters: RelayFilter[]) => Promise<RelayEvent[]>;
  /**
   * `Uint8Array<ArrayBuffer>` rather than a bare `Uint8Array`: the digest API
   * will not accept a view onto a SharedArrayBuffer, and corpus bytes never
   * are one — they come from a fetch body or a shell blob.
   */
  bytes: (url: string) => Promise<Uint8Array<ArrayBuffer>>;
};

export type TileDiscovery = {
  collections: CorpusCollection[];
  items: CorpusItem[];
  /** Best covering item per dataset, after refinement. */
  selected: Map<string, CorpusItem>;
  coverage: DatasetCoverage[];
  /** Events that failed verification or attribution — surfaced, never hidden. */
  rejected: number;
};

/**
 * The item filter is built here rather than with `nearby()` because the cover
 * this client needs is not a viewport's: it is the wanted tile's cell PLUS its
 * ancestors', so a dataset published on a coarser ladder (this corpus keeps
 * DEM at z13 and features at z14) is still reachable. `nearby()` answers the
 * viewport question correctly and is the right tool there.
 */
function itemFilter(publisher: string, tile: Tile, limit?: number): RelayFilter {
  const filter: RelayFilter = {
    kinds: [KIND_GEO_ITEM],
    authors: [publisher],
    '#g': queryCells(tile),
  };
  if (limit !== undefined) filter.limit = limit;
  return filter;
}

async function verifiedFrom(
  events: readonly RelayEvent[],
  publisher: string,
): Promise<{ kept: RelayEvent[]; rejected: number }> {
  const kept: RelayEvent[] = [];
  let rejected = 0;

  for (const event of events) {
    if (event.pubkey !== publisher) {
      rejected += 1;
      continue;
    }
    // Sequential rather than parallel: the corpus answers are small and the
    // ordering keeps the rejected count deterministic for a given input.
    if (await isVerifiedEvent(event)) kept.push(event);
    else rejected += 1;
  }

  return { kept, rejected };
}

/** Everything the client can honestly say about one tile. */
export async function discoverTile(
  transport: CorpusTransport,
  options: { publisher: string; tile: Tile; limit?: number },
): Promise<TileDiscovery> {
  const { publisher, tile } = options;

  // One REQ, two filters: collections wholesale (few, and their bbox tag is
  // deliberately unindexed) and items by cell cover.
  const events = await transport.query([
    catalog({ authors: [publisher], ...(options.limit ? { limit: options.limit } : {}) }),
    itemFilter(publisher, tile, options.limit),
  ]);

  const { kept, rejected } = await verifiedFrom(events, publisher);

  const collections = kept
    .map(parseCollectionEvent)
    .filter((entry): entry is CorpusCollection => entry !== null);
  const items = kept.map(parseItemEvent).filter((entry): entry is CorpusItem => entry !== null);

  return {
    collections,
    items,
    selected: selectForTile(items, tile),
    coverage: coverageForTile(collections, items, tile),
    rejected,
  };
}

/**
 * Fetch one item's bytes from the collection's own server and verify them.
 *
 * The host comes from the COLLECTION, not from the item's `url` tag: the tag
 * is a hint, and honouring it verbatim would let a rewritten item send this
 * client to a third-party host. The hash is what makes that safe to ignore —
 * the same bytes are the same bytes wherever they come from, and bytes that
 * are not the same never leave this function.
 */
export async function loadItemBytes(
  transport: CorpusTransport,
  item: CorpusItem,
  server: string,
): Promise<Uint8Array<ArrayBuffer>> {
  const url = `${server.replace(/\/+$/, '')}/${item.sha256}`;
  const bytes = await transport.bytes(url);
  await verifyBlob(bytes, item.sha256);
  return bytes;
}
