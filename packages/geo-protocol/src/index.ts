/**
 * terrDVM's geospatial protocol on nostr: one Collection kind, one Item kind,
 * one extent tag, one location tag.
 *
 * `CONTRACT.md` is the normative spec and `tests/fixtures/geo-vectors.json` is
 * the differential conformance suite. A Python implementation of the same
 * contract lives in `services/blossom-gis/src/blossom_gis/geo_protocol.py`,
 * and the two must emit BYTE-IDENTICAL events for identical input — `content`
 * is hashed into the event id, so a one-character difference is a different
 * event for one addressable address, which is a silent split-brain rather than
 * a visible error.
 *
 * Pure by construction — no DOM, no network, no `@napplet/sdk`, no dependency
 * on `@terrdvm/terrain-engine`. This is the lower layer; the engine and the
 * app sit on top of it.
 */
export * from './kinds';
export * from './errors';
export * from './number';
export * from './event';
export * from './bbox';
export * from './validate';
export * from './geohash';
export * from './tile';
export * from './collection';
export * from './item';
export * from './filters';
export * from './supersession';
