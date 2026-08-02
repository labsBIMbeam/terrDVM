/**
 * Every constant the protocol pins, in one module.
 *
 * CONTRACT.md §2 requires both implementations to export exactly these names
 * (snake_case in Python). One name per constant, in one place: two names for
 * one number — Python once had `GLOBAL_GEOHASH_PRECISION` where TypeScript had
 * `GEOHASH_PRECISION`, and `MAX_ITEM_FILTER_CELLS` where TypeScript had
 * `MAX_COVER_CELLS` — is precisely how the two sides drift apart.
 *
 * The layer's shape is deliberately minimal: exactly ONE global event, ONE
 * local event, ONE global spatial tag, ONE local spatial tag. It maps onto
 * STAC — the global event is a Collection (a dataset with an extent), the
 * local event is an Item (a single tile with a location).
 */

/**
 * Global event — one per dataset, addressable, replaceable head.
 *
 * Carries `["bbox", w, s, e, n]` and deliberately NO geohash tag: a dataset
 * has an EXTENT, not a location, and `bbox` is the honest GIS representation.
 * `bbox` is not a single-letter tag so relays do not index it (NIP-01: "all
 * single-letter key tags are expected to be indexed" — and only the FIRST
 * value of any tag at that). Clients therefore fetch `{kinds:[30550]}`
 * wholesale and filter locally; collections are few, so that is cheap and it
 * is in fact the only strategy the protocol permits.
 *
 * KIND CHOICE: 30550/30551 rather than the originally sketched 30450/30451.
 * Both pairs are unclaimed today across the NIPs README, fiatjaf's
 * registry-of-kinds, nostrability/schemata, nostrbook, nostr-tools and NDK.
 * But Marmot (MLS-over-nostr) holds seven consecutive LOW kinds 443-449 and
 * its MIP-00 established a `30000 + N` addressable-mirror convention (443 ->
 * 30443, real and deployed). Its next free low slot is 450, which would mirror
 * to exactly 30450. 30550/30551 sits mid-run in 30516..30616, the largest
 * fully-empty stretch of the addressable space, and low kinds 550/551 are
 * themselves unclaimed so no future mirror can land on them either.
 */
export const KIND_GEO_COLLECTION = 30550;

/**
 * Local event — one per tile, addressable.
 *
 * Carries exactly one spatial tag, `["g", <geohash>]` at GEOHASH_PRECISION,
 * plus `["a", ...]` back to its collection. The exact bbox, the datetime and
 * the per-tile properties live in `content` as JSON, NOT as tags: relays do
 * not index content, and keeping them out of the tag list is precisely what
 * holds the spatial tag count at one.
 */
export const KIND_GEO_ITEM = 30551;

/**
 * Geohash precision for the item `g` tag — FOR KINDS 30550/30551 ONLY.
 *
 * REASON — chosen by EVENTS PER CELL, not by cell area. A p4 cell is 20 bits
 * (10 lon + 10 lat), i.e. 0.3515625 deg x 0.17578125 deg; on the ground that
 * is 39 x 19 km at the equator and 28 x 19.5 km at 45 N. A z14 slippy tile is
 * 2.446 km at the equator but only 1.73 km at 45 N and 1.22 km at 60 N, so a
 * p4 cell holds ~128 z14 tiles at the equator and ~200-290 across the 45-60 N
 * band this project targets. That fits inside strfry's default
 * `maxFilterLimit = 500` with room to spare.
 *
 * p3 (15 bits — note the ODD split, 8 lon / 7 lat, giving square 1.40625 deg
 * cells) would hold ~3300-4100 z14 tiles per cell and be silently CLAMPED to
 * 500 by the relay, punching holes in the map with no error. p5 would multiply
 * the cell count of every viewport query by 32 for no gain.
 *
 * THE SOCIAL KINDS ARE GOVERNED BY THE OPPOSITE RULE. Kinds 1, 1063, 30315 and
 * 31923 carry a LADDER of `g` tags — every prefix of the precision-6 geohash,
 * precisions 1..6 — because nostr tag filters are EXACT STRING MATCHES and a
 * client querying precision 5 can never match a lone precision-4 tag. See
 * CONTRACT.md §13 and `SOCIAL_GEOHASH_PRECISIONS` below.
 */
export const GEOHASH_PRECISION = 4;

/**
 * Separator between the dataset name and the tile coordinate in an item's
 * `d` tag: `terrain:14/8593/5677`.
 *
 * REASON — NIP-01 defines addressable identity as exactly `(kind, pubkey, d)`.
 * The `a` tag is NOT part of it; NIP-01 defines `a` purely as a pointer ("used
 * to refer to an addressable or replaceable event") and it appears nowhere in
 * the replacement rule. So two kind-30551 events from the SAME publisher for
 * the SAME tile but pointing at different collections — say a terrain dataset
 * and an imagery dataset — would collide on `d = "14/8593/5677"` and silently
 * annihilate each other, with a successful OK returned on every publish. The
 * dataset prefix is what makes the address unique. It is not decoration.
 *
 * The separator is illegal INSIDE a dataset name, so a well-formed item `d`
 * contains exactly one of them — which is what makes the split direction
 * unobservable. See CONTRACT.md §3.2.
 */
export const DATASET_SEPARATOR = ':';

/** Longest legal dataset name; bounds the `a` address. */
export const MAX_DATASET_LENGTH = 64;

/**
 * Deepest slippy zoom an item `d` tag may address.
 *
 * RULING (CONTRACT.md §2.1) — TypeScript said 22, Python said 30, and both
 * suites asserted the disagreement and both passed. 22 wins: a z22 tile is
 * 9.55 m at the equator, finer than any DEM or orthophoto this protocol will
 * carry, and it is still 86 steps of the 1e-6 coordinate grid wide, so
 * adjacent tiles serialise to distinct bboxes. That stops being true around
 * z28.4 — by z29 a tile is narrower than one grid step and two neighbouring
 * items would carry an IDENTICAL content bbox. A ceiling of 30 publishes
 * events that cannot be told apart.
 */
export const MAX_TILE_ZOOM = 22;

/**
 * Decimal places every coordinate is quantised to, in tags and in content
 * alike. 1e-6 degrees is about 11 cm, far finer than any DEM this will ever
 * carry, and it keeps bbox strings short and stable against float drift.
 */
export const COORDINATE_DECIMALS = 6;

/** Web Mercator's latitude cut-off — nothing above this is ever tiled. */
export const MAX_MERCATOR_LATITUDE = 85.05112878;

/**
 * strfry's default `maxFilterLimit`, and the only filter limit this protocol
 * has. Version 1 had three different defaults (TypeScript `catalog()` 500,
 * Python `collection_filter` 200, TypeScript `exactTile()` 1); all three
 * become this one.
 */
export const DEFAULT_FILTER_LIMIT = 500;

/**
 * The ceiling a caller may ask for. Above it strfry CLAMPS silently, so a full
 * page would be indistinguishable from a truncated one — which is why asking
 * for more is REJECTED rather than clamped.
 */
export const MAX_FILTER_LIMIT = 500;

/**
 * Cell ceiling above which a viewport query is refused.
 *
 * 128 p4 cells is a 2.81 deg square — about 210 km east-west at 48 N. Above it
 * the caller must fall back to `catalog()`, because the cover grows
 * quadratically and fast: Austria alone needs 352 cells, the Alps 864,
 * continental Europe 43,617 and the whole world 1,048,576. Those are not
 * filters any relay will honour, and a relay that refuses one answers with
 * CLOSED, not with an empty set.
 */
export const MAX_COVER_CELLS = 128;

/**
 * Highest legal `created_at`, and a deliberate MILLISECOND TRAP.
 *
 * Passing `Date.now()` unscaled is the single most common timestamp bug, and
 * 1767225600000 is comfortably over 2^31-1, so it fails loudly instead of
 * publishing an event dated year 57,000 that no later event can ever
 * supersede.
 */
export const MAX_CREATED_AT = 2147483647;

/**
 * 2^53-1 — the magnitude ceiling for any number reaching the wire. Beyond it a
 * value does not round-trip through every JSON consumer in the chain: a Python
 * int of 2^60 cannot be represented in JavaScript at all.
 */
export const MAX_SAFE_INTEGER = 9007199254740991;

/** Base-32 geohash alphabet; note the absent `a`, `i`, `l`, `o`. */
export const GEOHASH_ALPHABET = '0123456789bcdefghjkmnpqrstuvwxyz';

/**
 * The kinds that carry a geohash LADDER rather than one tag: 1 (notes), 1063
 * (NIP-94 file metadata), 30315 (NIP-38 presence), 31923 (NIP-52 calendar).
 * See CONTRACT.md §13.
 */
export const SOCIAL_GEOHASH_KINDS: readonly number[] = [1, 1063, 30315, 31923];

/** Precisions of the social ladder, shortest first. */
export const SOCIAL_GEOHASH_PRECISIONS: readonly number[] = [1, 2, 3, 4, 5, 6];
