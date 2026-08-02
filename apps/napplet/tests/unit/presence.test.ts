import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { schnorr } from '@noble/curves/secp256k1.js';
import { sha256 as nobleSha256 } from '@noble/hashes/sha2.js';
import { SOCIAL_GEOHASH_PRECISIONS } from '@terrcvm/geo-protocol/kinds';
import { socialGeohashTags } from '@terrcvm/geo-protocol/geohash';

// The relay list is the only thing this module needs from publish.ts, and
// publish.ts drags in the shell client. Mocking it keeps this a unit test and
// pins the relay fan-out at exactly two.
vi.mock('../../src/nostr/publish', () => ({
  PLACEMENT_RELAYS: ['wss://relay.one.test', 'wss://relay.two.test'],
}));

import {
  MAX_GEOHASH_CELLS,
  QUERYABLE_PRECISIONS,
  assertQueryablePrecision,
  coverageFor,
  fetchGeoNotes,
  fetchPresences,
  geohashEncode,
  type GeohashCoverage,
} from '../../src/nostr/presence';

type RelayFilter = Record<string, unknown>;

const sentFilters: RelayFilter[] = [];
const openedUrls: string[] = [];
let eventScript: (filter: RelayFilter) => unknown[] = () => [];
let rawFrames: string[] = [];

/**
 * A relay that answers from a script and records what it was asked. No socket
 * is opened anywhere in this file — the point is to assert on the FILTER, and
 * a real relay would answer a wrong filter with a plausible empty set.
 */
class FakeWebSocket {
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;

  constructor(readonly url: string) {
    openedUrls.push(url);
    setTimeout(() => this.onopen?.(), 0);
  }

  send(raw: string): void {
    const [, subscription, filter] = JSON.parse(raw) as [string, string, RelayFilter];
    sentFilters.push(filter);
    for (const frame of rawFrames) this.onmessage?.({ data: frame });
    for (const event of eventScript(filter)) {
      this.onmessage?.({ data: JSON.stringify(['EVENT', subscription, event]) });
    }
    this.onmessage?.({ data: JSON.stringify(['EOSE', subscription]) });
  }

  close(): void {
    this.closed = true;
  }
}

const originalWebSocket = globalThis.WebSocket;

beforeEach(() => {
  sentFilters.length = 0;
  openedUrls.length = 0;
  rawFrames = [];
  eventScript = () => [];
  (globalThis as { WebSocket: unknown }).WebSocket = FakeWebSocket;
});

afterEach(() => {
  (globalThis as { WebSocket: unknown }).WebSocket = originalWebSocket;
});

const VIENNA: readonly [number, number, number, number] = [16.2, 48.1, 16.5, 48.3];

function toHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function hexBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i += 1) out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/**
 * A stable identity per test label.
 *
 * These fixtures used to carry made-up pubkeys and ids like `aaa…-1`, which
 * was fine while nothing checked them. Now that presence.ts verifies every
 * frame, a fixture that is not really signed is indistinguishable from a
 * hostile relay's forgery — so the fixtures sign for real, from a secret
 * derived deterministically from the label.
 */
const identities = new Map<string, { secret: Uint8Array; pubkey: string }>();
function identity(label: string): { secret: Uint8Array; pubkey: string } {
  let found = identities.get(label);
  if (!found) {
    const secret = nobleSha256(new TextEncoder().encode(`terrcvm-test:${label}`));
    found = { secret, pubkey: toHex(schnorr.getPublicKey(secret)) };
    identities.set(label, found);
  }
  return found;
}

/** Compute the NIP-01 id and sign it — a real event, not an event-shaped object. */
function sign(
  label: string,
  draft: { kind: number; created_at: number; content: string; tags: string[][] },
): Record<string, unknown> {
  const { secret, pubkey } = identity(label);
  const serialised = JSON.stringify([
    0,
    pubkey,
    draft.created_at,
    draft.kind,
    draft.tags,
    draft.content,
  ]);
  const id = toHex(nobleSha256(new TextEncoder().encode(serialised)));
  return { id, pubkey, sig: toHex(schnorr.sign(hexBytes(id), secret)), ...draft };
}

function presenceEvent(options: {
  pubkey: string;
  name: string;
  lon: number;
  lat: number;
  createdAt?: number;
  omitHash?: boolean;
  bboxTag?: string;
}): unknown {
  const tags: string[][] = [['name', options.name], ['t', 'terrcvm-presence']];
  if (!options.omitHash) tags.push(['x', 'a'.repeat(64)]);
  tags.push(['bbox', options.bboxTag ?? `${options.lon},${options.lat}`]);
  tags.push(...socialGeohashTags(options.lat, options.lon));
  return sign(options.pubkey, {
    kind: 30315,
    created_at: options.createdAt ?? 1,
    content: `here: ${options.name}`,
    tags,
  });
}

/** Computed event id → the readable handle its fixture was built with. */
const noteHandles = new Map<string, string>();

function noteEvent(options: {
  id: string;
  kind: number;
  lon: number;
  lat: number;
  createdAt: number;
  content?: string;
  extraTags?: string[][];
  omitGeohash?: boolean;
}): unknown {
  const tags: string[][] = options.omitGeohash ? [] : socialGeohashTags(options.lat, options.lon);
  // `options.id` is the fixture's HANDLE, not the event id: an id is now the
  // hash of the event, so it cannot also be a name the test chose.
  const event = sign('notes', {
    kind: options.kind,
    created_at: options.createdAt,
    content: options.content ?? 'hello',
    tags: [...tags, ...(options.extraTags ?? [])],
  });
  noteHandles.set(event.id as string, options.id);
  return event;
}

/** Name a returned note by the fixture handle it came from. */
function handleOf(note: { id: string }): string {
  return noteHandles.get(note.id) ?? note.id;
}

describe('the precision ladder the client queries', () => {
  it('draws every precision from the shared social constant', () => {
    expect(QUERYABLE_PRECISIONS).toEqual([...SOCIAL_GEOHASH_PRECISIONS].sort((a, b) => a - b));
    expect(QUERYABLE_PRECISIONS.length).toBeGreaterThan(0);
  });

  it('matches the ladder the publisher actually emits', () => {
    // THE TRIPWIRE. These are the exact numbers the server tags social events
    // with: `DEFAULT_GEOHASH_PRECISIONS` in
    // services/blossom-gis/src/blossom_gis/nostr_geo.py, which is applied to
    // kinds 1063, 30315 and 31923 in app.py. They are written out here, not
    // derived, so that a change on either side lands as a red test rather than
    // as an empty map: nostr tag filters are exact string matches, and the bug
    // this file exists for was a client asking for precision 5 against a
    // server tagging only precision 4. Nothing reported it.
    expect([...QUERYABLE_PRECISIONS]).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('refuses a precision the publisher does not tag', () => {
    for (const precision of QUERYABLE_PRECISIONS) {
      expect(() => assertQueryablePrecision(precision)).not.toThrow();
    }
    expect(() => assertQueryablePrecision(0)).toThrow(/social ladder/);
    expect(() => assertQueryablePrecision(7)).toThrow(/social ladder/);
    expect(() => assertQueryablePrecision(5.5)).toThrow(/social ladder/);
  });

  it('asks for cells whose length is exactly the rung it chose', () => {
    const viewports: (readonly [number, number, number, number])[] = [
      [16.37, 48.21, 16.37, 48.21],
      VIENNA,
      [9, 46, 17, 49],
      [-25, 34, 45, 72],
      [-180, -90, 180, 90],
    ];
    for (const viewport of viewports) {
      const coverage = coverageFor(viewport);
      expect(QUERYABLE_PRECISIONS).toContain(coverage.precision);
      for (const cell of coverage.cells) expect(cell.length).toBe(coverage.precision);
      expect(coverage.complete).toBe(true);
    }
  });
});

describe('coverageFor completeness', () => {
  it('covers every cell of a viewport many cells wide', () => {
    const coverage = coverageFor(VIENNA);
    expect(coverage.cells.length).toBeGreaterThan(1);
    expect(new Set(coverage.cells).size).toBe(coverage.cells.length);

    // Independent check: any point inside the viewport must fall in a cell we
    // asked for. Corner sampling — the shape this replaces — misses every
    // interior column and fails this outright.
    const [west, south, east, north] = VIENNA;
    const asked = new Set(coverage.cells);
    for (let i = 0; i <= 40; i += 1) {
      for (let j = 0; j <= 40; j += 1) {
        const lon = west + ((east - west) * i) / 40;
        const lat = south + ((north - south) * j) / 40;
        expect(asked).toContain(geohashEncode(lat, lon, coverage.precision));
      }
    }
  });

  it('drops to a coarser rung rather than cutting a continental view short', () => {
    // Europe needs 43,617 cells at precision 4. The predecessor kept precision
    // 4 and returned 48 of them — 0.1% of the viewport, reported as all of it.
    const coverage = coverageFor([-25, 34, 45, 72]);
    expect(coverage.complete).toBe(true);
    expect(coverage.cells.length).toBeLessThanOrEqual(MAX_GEOHASH_CELLS);
    const asked = new Set(coverage.cells);
    for (const [lon, lat] of [
      [-24, 35],
      [2.35, 48.85],
      [16.37, 48.21],
      [30, 60],
      [44, 71],
    ]) {
      expect(asked).toContain(geohashEncode(lat, lon, coverage.precision));
    }
  });

  it('covers a point query with a single cell', () => {
    const coverage = coverageFor([16.37, 48.21, 16.37, 48.21]);
    expect(coverage.cells).toEqual([geohashEncode(48.21, 16.37, coverage.precision)]);
    expect(coverage.complete).toBe(true);
  });
});

describe('coverageFor at the edges of the world', () => {
  it('splits an antimeridian viewport instead of enumerating the globe', () => {
    const crossing = coverageFor([170, -10, -170, 10]);
    expect(crossing.segments).toHaveLength(2);
    expect(crossing.complete).toBe(true);
    const asked = new Set(crossing.cells);
    for (const lon of [170.5, 179.9, -179.9, -170.5]) {
      expect(asked).toContain(geohashEncode(0, lon, crossing.precision));
    }
    // Nothing from the far side of the planet: a wrapped cover would have
    // enumerated the globe MINUS the viewport.
    expect(asked).not.toContain(geohashEncode(0, 0, crossing.precision));
    expect(crossing.cells.length).toBeLessThan(32);
  });

  it('treats MapLibre unwrapped longitudes as the same viewport', () => {
    const unwrapped = coverageFor([170, -10, 190, 10]);
    const crossing = coverageFor([170, -10, -170, 10]);
    expect([...unwrapped.cells].sort()).toEqual([...crossing.cells].sort());
    expect(coverageFor([530, -10, 550, 10]).cells.sort()).toEqual([...crossing.cells].sort());
  });

  it('covers latitudes above the Mercator cut-off', () => {
    // Presence exists above 85.05 even though tiles do not. The predecessor
    // clamped every sample to 85, so a person at 88 N was never asked for.
    const coverage = coverageFor([10, 84, 11, 89]);
    expect(coverage.complete).toBe(true);
    const asked = new Set(coverage.cells);
    for (const lat of [84.5, 86, 88.9]) {
      expect(asked).toContain(geohashEncode(lat, 10.5, coverage.precision));
    }
  });

  it('clamps latitude into the geohash domain instead of failing', () => {
    const coverage = coverageFor([10, 80, 11, 95]);
    expect(coverage.complete).toBe(true);
    expect(coverage.segments[0][3]).toBe(90);
    expect(new Set(coverage.cells)).toContain(geohashEncode(89.99, 10.5, coverage.precision));
  });

  it('covers the whole world completely', () => {
    const coverage = coverageFor([-180, -90, 180, 90]);
    expect(coverage.precision).toBe(QUERYABLE_PRECISIONS[0]);
    expect(coverage.complete).toBe(true);
    expect(coverage.cells).toHaveLength(32);
  });
});

describe('truncation is reported, never silent', () => {
  it('signals an incomplete cover when the cell budget cannot hold one', () => {
    const coverage = coverageFor([-180, -90, 180, 90], 4);
    expect(coverage.complete).toBe(false);
    expect(coverage.cells).toHaveLength(4);
    expect(coverage.requiredCells).toBe(32);
    // Deterministic prefix, not an arbitrary subset.
    expect(coverage.cells).toEqual(coverageFor([-180, -90, 180, 90]).cells.slice(0, 4));
  });

  it('reports a viewport it cannot cover at all as incomplete, not as empty', () => {
    for (const broken of [
      [Number.NaN, 0, 1, 1],
      [0, 1, 1, 0],
      [0, Number.POSITIVE_INFINITY, 1, 1],
    ] as (readonly [number, number, number, number])[]) {
      const coverage = coverageFor(broken);
      expect(coverage.cells).toEqual([]);
      expect(coverage.complete).toBe(false);
    }
  });

  it('rejects a nonsensical cell budget', () => {
    expect(() => coverageFor(VIENNA, 0)).toThrow(/maxCells/);
    expect(() => coverageFor(VIENNA, 2.5)).toThrow(/maxCells/);
  });

  it('hands the truncation signal to the caller of both feeds', () => {
    const seen: GeohashCoverage[] = [];
    return Promise.all([
      fetchPresences([-180, -90, 180, 90], 50, (coverage) => seen.push(coverage)),
      fetchGeoNotes([-180, -90, 180, 90], 50, (coverage) => seen.push(coverage)),
    ]).then(() => {
      expect(seen).toHaveLength(2);
      for (const coverage of seen) {
        expect(coverage.complete).toBe(true);
        expect(coverage.requiredCells).toBe(32);
      }
    });
  });

  it('never sends a query it knows matches nothing', async () => {
    const coverage: GeohashCoverage[] = [];
    const presences = await fetchPresences([Number.NaN, 0, 1, 1], 50, (c) => coverage.push(c));
    const notes = await fetchGeoNotes([Number.NaN, 0, 1, 1], 50, (c) => coverage.push(c));
    expect(presences).toEqual([]);
    expect(notes).toEqual([]);
    expect(coverage.every((entry) => entry.complete === false)).toBe(true);
    // An empty '#g' matches nothing, which on the wire is indistinguishable
    // from an empty area. No socket may be opened at all.
    expect(openedUrls).toEqual([]);
    expect(sentFilters).toEqual([]);
  });
});

describe('fetchPresences', () => {
  it('asks for kind 30315 in exactly the cells of the cover', async () => {
    await fetchPresences(VIENNA, 50);
    const coverage = coverageFor(VIENNA);
    expect(sentFilters).toHaveLength(2);
    expect(openedUrls).toEqual(['wss://relay.one.test', 'wss://relay.two.test']);
    for (const filter of sentFilters) {
      expect(filter.kinds).toEqual([30315]);
      expect(filter['#t']).toEqual(['terrcvm-presence']);
      expect(filter['#g']).toEqual(coverage.cells);
      expect(filter.limit).toBe(128);
    }
  });

  it('keeps the newest status per pubkey and drops the ones outside the view', async () => {
    eventScript = () => [
      presenceEvent({ pubkey: 'a'.repeat(64), name: 'stale', lon: 16.37, lat: 48.21, createdAt: 1 }),
      presenceEvent({ pubkey: 'a'.repeat(64), name: 'fresh', lon: 16.38, lat: 48.22, createdAt: 9 }),
      presenceEvent({ pubkey: 'c'.repeat(64), name: 'faraway', lon: -73.9, lat: 40.7, createdAt: 5 }),
    ];
    const presences = await fetchPresences(VIENNA, 50);
    expect(presences.map((presence) => presence.name)).toEqual(['fresh']);
    expect(presences[0].createdAt).toBe(9);
    expect(presences[0].message).toBe('here: fresh');
  });

  it('drops malformed events instead of rendering a guess', async () => {
    eventScript = () => [
      // Not an event at all.
      null,
      'nope',
      { id: 'x' },
      // Right shape, wrong types.
      { id: 1, pubkey: 'd'.repeat(64), kind: 30315, created_at: 1, content: '', tags: [] },
      {
        id: 'no-tags',
        pubkey: 'd'.repeat(64),
        kind: 30315,
        created_at: 1,
        content: '',
        tags: 'here',
      },
      {
        id: 'nested-non-string',
        pubkey: 'd'.repeat(64),
        kind: 30315,
        created_at: 1,
        content: '',
        tags: [['bbox', 16.37, 48.21]],
      },
      // Well-formed event, unusable payload.
      presenceEvent({ pubkey: 'e'.repeat(64), name: 'nohash', lon: 16.37, lat: 48.21, omitHash: true }),
      presenceEvent({
        pubkey: 'f'.repeat(64),
        name: 'threefields',
        lon: 16.37,
        lat: 48.21,
        bboxTag: '16.37,48.21,99',
      }),
      presenceEvent({
        pubkey: '0'.repeat(64),
        name: 'notanumber',
        lon: 16.37,
        lat: 48.21,
        bboxTag: 'here,there',
      }),
      presenceEvent({
        pubkey: '1'.repeat(64),
        name: 'offplanet',
        lon: 16.37,
        lat: 48.21,
        bboxTag: '16.37,481.2',
      }),
      presenceEvent({ pubkey: '2'.repeat(64), name: 'good', lon: 16.37, lat: 48.21 }),
    ];
    rawFrames = ['{not json', JSON.stringify(['EVENT', 'someone-elses-sub', { id: 'other' }])];
    const presences = await fetchPresences(VIENNA, 50);
    expect(presences.map((presence) => presence.name)).toEqual(['good']);
  });
});

/**
 * A relay answers a filter; it does not obey one. Every case here is a frame a
 * relay is free to send today, and every one of them rendered a marker on the
 * map before the events were verified.
 */
describe('a relay cannot put an unverified marker on the map', () => {
  it('drops an event whose content the relay rewrote in flight', async () => {
    eventScript = () => {
      const good = presenceEvent({
        pubkey: 'a'.repeat(64),
        name: 'real',
        lon: 16.37,
        lat: 48.21,
      }) as Record<string, unknown>;
      const tampered = { ...good, content: 'here: someone else entirely' };
      return [tampered];
    };
    expect(await fetchPresences(VIENNA, 50)).toEqual([]);
  });

  it('drops an event whose tags the relay rewrote, id left untouched', async () => {
    eventScript = () => {
      const good = presenceEvent({
        pubkey: 'a'.repeat(64),
        name: 'real',
        lon: 16.37,
        lat: 48.21,
      }) as { tags: string[][] } & Record<string, unknown>;
      // Move the marker across the city without touching id or signature.
      const tags = good.tags.map((tag) => (tag[0] === 'bbox' ? ['bbox', '16.5,48.3'] : tag));
      return [{ ...good, tags }];
    };
    expect(await fetchPresences(VIENNA, 50)).toEqual([]);
  });

  it('drops an event whose id the relay swapped', async () => {
    eventScript = () => {
      const good = presenceEvent({
        pubkey: 'a'.repeat(64),
        name: 'real',
        lon: 16.37,
        lat: 48.21,
      }) as Record<string, unknown>;
      return [{ ...good, id: 'f'.repeat(64) }];
    };
    expect(await fetchPresences(VIENNA, 50)).toEqual([]);
  });

  it('drops an event that claims an author who did not sign it', async () => {
    // A consistent id over content the impostor wrote, signed with their own
    // key while claiming somebody else's pubkey. Only the curve maths catches
    // this — the id recomputes perfectly.
    eventScript = () => {
      const impostor = presenceEvent({
        pubkey: 'impostor',
        name: 'not-me',
        lon: 16.37,
        lat: 48.21,
      }) as Record<string, unknown>;
      return [{ ...impostor, pubkey: identity('victim').pubkey }];
    };
    expect(await fetchPresences(VIENNA, 50)).toEqual([]);
  });

  it('drops an unsigned event outright', async () => {
    eventScript = () => {
      const good = presenceEvent({
        pubkey: 'a'.repeat(64),
        name: 'real',
        lon: 16.37,
        lat: 48.21,
      }) as Record<string, unknown>;
      const unsigned = { ...good };
      delete unsigned.sig;
      return [unsigned, { ...good, sig: '' }, { ...good, sig: 'not-hex'.repeat(16) }];
    };
    expect(await fetchPresences(VIENNA, 50)).toEqual([]);
  });

  it('cannot be beaten to the newest-per-pubkey slot by a forgery', async () => {
    // The forged event carries a LATER created_at, so if verification happened
    // after the merge it would win and be dropped, leaving the real presence
    // invisible. Verification runs first, so the real one survives.
    eventScript = () => {
      const real = presenceEvent({
        pubkey: 'a'.repeat(64),
        name: 'real',
        lon: 16.37,
        lat: 48.21,
        createdAt: 10,
      }) as Record<string, unknown>;
      const forged = {
        ...(presenceEvent({
          pubkey: 'a'.repeat(64),
          name: 'forged',
          lon: 16.38,
          lat: 48.22,
          createdAt: 99,
        }) as Record<string, unknown>),
        content: 'here: rewritten by the relay',
      };
      return [real, forged];
    };
    const presences = await fetchPresences(VIENNA, 50);
    expect(presences.map((presence) => presence.name)).toEqual(['real']);
    expect(presences[0].createdAt).toBe(10);
  });

  it('drops a tampered geo-note as well as a tampered presence', async () => {
    eventScript = () => {
      const good = noteEvent({
        id: 'real',
        kind: 1,
        lon: 16.37,
        lat: 48.21,
        createdAt: 10,
      }) as Record<string, unknown>;
      return [good, { ...good, id: 'e'.repeat(64), content: 'injected' }];
    };
    const notes = await fetchGeoNotes(VIENNA, 50);
    expect(notes.map(handleOf)).toEqual(['real']);
    expect(notes.every((note) => note.content !== 'injected')).toBe(true);
  });
});

describe('fetchGeoNotes', () => {
  it('asks for the social kinds in exactly the cells of the cover', async () => {
    await fetchGeoNotes(VIENNA, 50);
    const coverage = coverageFor(VIENNA);
    for (const filter of sentFilters) {
      expect(filter.kinds).toEqual([1, 1063, 31923]);
      expect(filter['#g']).toEqual(coverage.cells);
      expect(filter.limit).toBe(100);
      expect(typeof filter.since).toBe('number');
    }
  });

  it('returns notes inside the view, newest first, meetups labelled', async () => {
    eventScript = () => [
      noteEvent({ id: 'older', kind: 1, lon: 16.37, lat: 48.21, createdAt: 10 }),
      noteEvent({ id: 'newer', kind: 1063, lon: 16.38, lat: 48.22, createdAt: 20 }),
      noteEvent({
        id: 'meetup',
        kind: 31923,
        lon: 16.36,
        lat: 48.2,
        createdAt: 15,
        extraTags: [['title', 'terrCVM meetup'], ['start', '1767225600']],
      }),
      noteEvent({ id: 'faraway', kind: 1, lon: -73.9, lat: 40.7, createdAt: 30 }),
      noteEvent({ id: 'nogeo', kind: 1, lon: 16.37, lat: 48.21, createdAt: 40, omitGeohash: true }),
      noteEvent({ id: 'wrongkind', kind: 7, lon: 16.37, lat: 48.21, createdAt: 50 }),
    ];
    const notes = await fetchGeoNotes(VIENNA, 50);
    expect(notes.map(handleOf)).toEqual(['newer', 'meetup', 'older']);
    expect(notes[1].content.startsWith('📅 terrCVM meetup')).toBe(true);
    // Deduplicated across the two relays, which both answered.
    expect(new Set(notes.map((note) => note.id)).size).toBe(3);
    // Positioned from the finest rung of the ladder, not the coarsest.
    expect(Math.abs(notes[0].lon - 16.38)).toBeLessThan(0.02);
    expect(Math.abs(notes[0].lat - 48.22)).toBeLessThan(0.02);
  });

  it('finds notes on both sides of the antimeridian', async () => {
    eventScript = () => [
      noteEvent({ id: 'east', kind: 1, lon: 179.5, lat: 1, createdAt: 10 }),
      noteEvent({ id: 'west', kind: 1, lon: -179.5, lat: -1, createdAt: 20 }),
      noteEvent({ id: 'greenwich', kind: 1, lon: 0, lat: 0, createdAt: 30 }),
    ];
    const notes = await fetchGeoNotes([170, -10, -170, 10], 50);
    expect(notes.map(handleOf).sort()).toEqual(['east', 'west']);
  });
});
