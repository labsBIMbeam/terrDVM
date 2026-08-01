import { DATASET_SEPARATOR, GEOHASH_PRECISION, KIND_GEO_ITEM, MAX_TILE_ZOOM } from './kinds';
import { encode } from './geohash';
import { assertTile, tileBBox, tileCenter, type Tile } from './tile';
import { collectionAddress } from './collection';
import { canonicalCoordinate, canonicalNumber } from './number';
import {
  canonicalJson,
  canonicalObject,
  canonicalString,
  type JsonValue,
  type UnsignedEvent,
} from './event';
import {
  assertCreatedAt,
  assertDatetime,
  assertDataset,
  assertHex64,
  assertMimeType,
  assertSize,
  assertUrl,
  isDataset,
  resolveProperties,
} from './validate';

export type ItemInput = {
  /** Dataset name; must match the collection's `d`. */
  dataset: string;
  /** The tile this item describes. Its bbox is DERIVED from this. */
  tile: Tile;
  /** Publisher of the collection — the middle field of the `a` address. */
  pubkey: string;
  /** SHA-256 of the blob, lowercase hex; the blossom identity of the file. */
  sha256: string;
  /** Where the blob can be fetched. */
  url: string;
  /** Media type of the blob. */
  mimeType: string;
  /** Blob size in bytes. */
  size: number;
  /** Survey/acquisition instant, RFC 3339 in UTC. Required, never derived. */
  datetime: string;
  /**
   * Per-tile facts (counts, elevation range, ...); goes in `content`.
   *
   * Absent — missing, `undefined` or `null` — means `{}` (CONTRACT.md §7.5).
   */
  properties?: Readonly<Record<string, JsonValue>> | null;
  /** Publish timestamp, seconds. */
  createdAt: number;
};

/** The `d` value of an item: `<dataset>:<z>/<x>/<y>`. */
export function itemD(dataset: string, tile: Tile): string {
  assertDataset(dataset);
  assertTile(tile);
  return `${dataset}${DATASET_SEPARATOR}${tile.z}/${tile.x}/${tile.y}`;
}

/** A canonical non-negative decimal integer: no sign, no leading zero. */
const TILE_COMPONENT_PATTERN = /^(0|[1-9][0-9]*)$/;

/**
 * Reverse of `itemD`. Returns null rather than throwing — `d` values arrive
 * from the network, where malformed is normal and not exceptional.
 *
 * A WELL-FORMED `d` CONTAINS EXACTLY ONE SEPARATOR. That is the ruling of
 * CONTRACT.md §3.2, and it is what makes the split direction unobservable.
 * Version 1 split on the LAST `:` here and on the FIRST `:` in Python; the two
 * disagreed on 6 of 14 probe inputs — `"a:b:14/1/1"` gave `{dataset: 'a:b'}`
 * here and `None` there. Counting separators instead of picking an end removes
 * the question rather than answering it: a rule whose correctness depends on
 * which end you count from is a rule waiting to diverge again.
 *
 * A publisher who wants a versioned name uses `terrain-v2` or `terrain.v2`,
 * both of which are legal.
 */
export function parseItemD(value: string): { dataset: string; tile: Tile } | null {
  if (typeof value !== 'string') return null;

  const parts = value.split(DATASET_SEPARATOR);
  if (parts.length !== 2) return null;

  const [dataset, coordinate] = parts;
  if (!isDataset(dataset)) return null;

  const components = coordinate.split('/');
  if (components.length !== 3) return null;
  if (!components.every((part) => TILE_COMPONENT_PATTERN.test(part))) return null;

  const [z, x, y] = components.map(Number);
  if (z > MAX_TILE_ZOOM) return null;
  const span = 2 ** z;
  if (x >= span || y >= span) return null;

  return { dataset, tile: { z, x, y } };
}

/**
 * The LOCAL event — one per tile.
 *
 * Exactly one spatial tag (`g`, at GEOHASH_PRECISION, always from the tile
 * CENTRE) and exactly one identity tag (`d`, always dataset-prefixed). The
 * exact bbox, the datetime and the properties are canonical JSON in `content`,
 * because relays do not index content and moving them there is what keeps the
 * tag list at one spatial entry.
 *
 * THERE IS NO `bbox` PARAMETER. The bbox is a function of the tile; accepting
 * it as input is accepting a contradiction as input (CONTRACT.md §7.2).
 */
export function buildItem(input: ItemInput): UnsignedEvent {
  const { dataset, tile, pubkey, sha256, url, mimeType, size, datetime, createdAt } = input;

  // VALIDATION ORDER IS NORMATIVE — CONTRACT.md §14.1: `created_at`, then the
  // tags in tag order (`d` carries the dataset and the tile, `a` carries the
  // pubkey), then `content` (bbox is derived, so `datetime` then
  // `properties`). This side used to validate the pubkey first, because
  // `collectionAddress` was called first; Python validated the dataset first.
  assertCreatedAt(createdAt);
  assertDataset(dataset);
  assertTile(tile);
  assertHex64(pubkey, 'pubkey');
  assertHex64(sha256, 'sha256');
  assertUrl(url);
  assertMimeType(mimeType);
  assertSize(size);
  assertDatetime(datetime);
  const properties = resolveProperties(input.properties);

  const address = collectionAddress(pubkey, dataset);
  const center = tileCenter(tile);
  const bbox = tileBBox(tile);

  // Two formatters inside one object: `bbox` is QUANTISED to the 1e-6 grid
  // while `properties` is not, so the members are serialised separately and
  // then sorted by `canonicalObject`. Key order is part of the event id.
  const content = canonicalObject([
    ['bbox', `[${bbox.map(canonicalCoordinate).join(',')}]`],
    ['datetime', canonicalString(datetime)],
    ['properties', canonicalJson(properties)],
  ]);

  return {
    kind: KIND_GEO_ITEM,
    created_at: createdAt,
    tags: [
      ['d', itemD(dataset, tile)],
      ['g', encode(center.lat, center.lon, GEOHASH_PRECISION)],
      ['a', address],
      ['x', sha256],
      ['url', url],
      ['m', mimeType],
      // `canonicalNumber` rather than `String` — `size` is bounded by
      // MAX_SAFE_INTEGER so `String` cannot reach exponent notation today, but
      // relying on "the input happens to stay under 1e21" is the same latent
      // trap that put `8.6e-05` in a bbox.
      ['size', canonicalNumber(size)],
    ],
    content,
  };
}
