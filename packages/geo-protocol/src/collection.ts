import { KIND_GEO_COLLECTION } from './kinds';
import { assertExtent, type BBox4326 } from './bbox';
import { canonicalCoordinate } from './number';
import type { UnsignedEvent } from './event';
import {
  assertCreatedAt,
  assertDataset,
  assertDescription,
  assertHex64,
  assertMimeType,
  assertText,
} from './validate';

export type CollectionInput = {
  /** The `d` value and the dataset name every item prefixes itself with. */
  dataset: string;
  /** Human title for the dataset; unrestricted, unlike `dataset`. */
  title: string;
  /** Extent of the whole dataset, `[west, south, east, north]`. */
  bbox: BBox4326;
  /** Media type of the blobs the items point at. */
  mimeType: string;
  /** SPDX id or licence URL. */
  license: string;
  /** Provenance of the underlying data. */
  source: string;
  /** Blossom server the item blobs are served from. */
  server: string;
  /**
   * Free text; becomes `content` VERBATIM, never JSON.
   *
   * OPTIONAL: absent — missing, `undefined` or `null` — means the empty
   * string, the same rule `properties` follows (CONTRACT.md §7.5). Python
   * declared it `description: str = ""` while this side required it, so the
   * same call was valid there and a type error here.
   */
  description?: string | null;
  /** Publish timestamp, seconds. */
  createdAt: number;
};

/**
 * The NIP-01 `a` address of a collection: `<kind>:<pubkey>:<d>`.
 *
 * This is a POINTER only. NIP-01 defines addressable identity as
 * `(kind, pubkey, d)` and the `a` tag is no part of it — which is exactly why
 * item `d` values carry the dataset prefix (see `DATASET_SEPARATOR`).
 */
export function collectionAddress(pubkey: string, dataset: string): string {
  assertHex64(pubkey, 'pubkey');
  assertDataset(dataset);
  return `${KIND_GEO_COLLECTION}:${pubkey}:${dataset}`;
}

/**
 * The GLOBAL event — one per dataset.
 *
 * Exactly seven tags, in the fixed order of CONTRACT.md §6, and no geohash: a
 * dataset has an extent, not a location. `bbox` is not a single-letter tag so
 * relays will not index it; clients fetch `{kinds:[30550]}` wholesale and
 * filter locally, which is affordable because collections are few and is in
 * any case the only strategy NIP-01 permits.
 *
 * Tag order is part of the event id, so it is fixed rather than incidental.
 */
export function buildCollection(input: CollectionInput): UnsignedEvent {
  const { dataset, title, bbox, mimeType, license, source, server, createdAt } = input;
  const description = input.description ?? '';

  // VALIDATION ORDER IS NORMATIVE — CONTRACT.md §14.1: fields are checked in
  // the order they are EMITTED, `created_at` then the tags in tag order then
  // `content`. §14 makes the code normative, so an input with two defects
  // must name the same field in both languages; otherwise a publisher fixing
  // what its own language named is still rejected by the other. Python
  // checked the extent third and this side checked it last.
  assertCreatedAt(createdAt);
  assertDataset(dataset);
  assertText(title, 'title');
  assertExtent(bbox);
  assertMimeType(mimeType);
  assertText(license, 'license');
  assertText(source, 'source');
  assertText(server, 'server');
  assertDescription(description, 'description');

  return {
    kind: KIND_GEO_COLLECTION,
    created_at: createdAt,
    tags: [
      ['d', dataset],
      ['title', title],
      ['bbox', ...bbox.map(canonicalCoordinate)],
      ['m', mimeType],
      ['license', license],
      ['source', source],
      ['server', server],
    ],
    content: description,
  };
}
