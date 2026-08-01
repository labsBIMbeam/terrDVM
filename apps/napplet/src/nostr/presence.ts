import { PLACEMENT_RELAYS } from './publish';
import {
  encode as geohashEncode,
  coverCellCount,
  coverCells,
} from '@terrdvm/geo-protocol/geohash';
import { SOCIAL_GEOHASH_PRECISIONS } from '@terrdvm/geo-protocol/kinds';
import type { BBox4326 } from '@terrdvm/terrain-engine/bbox/validate';
import { isVerifiedEvent } from '../verify';

/**
 * Live presence and the geo-note feed: who and what is here right now.
 *
 * Clients subscribe to kind 30315 (NIP-38 user status, replaceable) plus the
 * `g` geohash tags of the area — every hit is a person to render — and to
 * kinds 1 / 1063 / 31923 for notes, model announcements and meetups.
 *
 * THE PRECISION CONTRACT. Nostr tag filters are EXACT STRING MATCHES; there is
 * no prefix query. A client asking for a five-character cell can only ever
 * match an event that carries a five-character `g` tag. The social kinds
 * therefore carry a LADDER — one `g` tag per precision in
 * `SOCIAL_GEOHASH_PRECISIONS` (1..6), which is the same list the server emits
 * as `DEFAULT_GEOHASH_PRECISIONS` in
 * `services/blossom-gis/src/blossom_gis/nostr_geo.py`. This module must never
 * name a precision literally: every precision it queries is drawn from that
 * shared constant, and `assertQueryablePrecision` fails loudly if one ever is
 * not. A previous round hard-coded 5 here against a server emitting only 4,
 * and the result was an empty map with no error anywhere.
 *
 * A RELAY IS NOT A WITNESS. Every filter here is a request, and the answer is
 * whatever the relay felt like sending. Nothing from the wire reaches the map
 * until `verifiedEvents` has recomputed its NIP-01 id and checked its BIP-340
 * signature — see `../verify`.
 *
 * DEV-PATH NOTE: direct relay WebSockets are the plain-browser path; inside
 * a real napplet shell this module must route through the shell's OUTBOX
 * domain instead — the same seam as publish.ts.
 */

export type Presence = {
  pubkey: string;
  name: string;
  sha256: string;
  lon: number;
  lat: number;
  message: string;
  createdAt: number;
};

const GEOHASH_BASE32 = '0123456789bcdefghjkmnpqrstuvwxyz';

/**
 * Standard geohash — matches the server's encoder tag for tag.
 *
 * The implementation now lives in `@terrdvm/geo-protocol`, which is the lower
 * layer that also owns the kinds and the covering algorithm. Re-exported here
 * so this module's existing callers keep their import.
 */
export { geohashEncode };

/**
 * The precisions this client is allowed to ask a relay for, shortest first.
 *
 * Derived, never re-typed: it is the ladder the publisher actually tags, so
 * the two sides cannot drift apart without the shared constant changing.
 */
export const QUERYABLE_PRECISIONS: readonly number[] = [...SOCIAL_GEOHASH_PRECISIONS].sort(
  (a, b) => a - b,
);

/**
 * Cells in one `#g` filter, and therefore the ceiling on how much of a
 * viewport a single REQ can describe.
 *
 * CONSEQUENCE OF THE CAP: it is a budget on the filter, NOT a budget on the
 * area. `coverageFor` spends it by dropping to a coarser rung of the ladder
 * until the whole viewport fits, so the answer stays COMPLETE and only gets
 * less selective — a coarse cell over-fetches events the client then discards
 * against the exact bbox. Truncation happens only if the cap is set below the
 * 32 cells a whole-world cover needs at the coarsest rung, and when it does it
 * is reported rather than hidden. That distinction is the whole point: an
 * empty map must mean "nobody is here", never "we stopped looking".
 */
export const MAX_GEOHASH_CELLS = 48;

/** What a viewport query is actually asking the relay for. */
export type GeohashCoverage = {
  /** The rung of the ladder these cells sit on; always in QUERYABLE_PRECISIONS. */
  precision: number;
  /** The `#g` values, in `coverCells` order (longitude outer, latitude inner). */
  cells: string[];
  /**
   * False when `cells` is a PREFIX of the cover rather than the whole of it —
   * results are then a subset of what exists, and "no data" is not an answer
   * the caller may trust. Also false for a viewport too malformed to cover.
   */
  complete: boolean;
  /** How many cells a complete cover would have needed. */
  requiredCells: number;
  /**
   * The viewport after latitude clamping and antimeridian splitting — the
   * boxes the cells actually cover, and the right thing to test a decoded
   * event position against.
   */
  segments: BBox4326[];
};

type NostrEvent = {
  id: string;
  pubkey: string;
  kind: number;
  created_at: number;
  content: string;
  tags: string[][];
  sig: string;
};

/**
 * A relay frame is untrusted input. Anything that is not a well-formed NIP-01
 * event is dropped here, at ingest, so no downstream reader has to defend
 * itself against a missing `tags` array or a numeric `content`.
 *
 * SHAPE ONLY. Passing this proves the frame LOOKS like an event and nothing
 * else — not that the pubkey wrote it, not that the content is what was
 * signed. `verifiedEvents` below is the half that does; the two are kept
 * separate so it is impossible to read this function and think it is enough.
 */
function asEvent(value: unknown): NostrEvent | null {
  if (typeof value !== 'object' || value === null) return null;
  const candidate = value as Record<string, unknown>;
  const { id, pubkey, kind, created_at: createdAt, content, tags, sig } = candidate;
  if (typeof id !== 'string' || id.length === 0) return null;
  if (typeof pubkey !== 'string' || pubkey.length === 0) return null;
  if (typeof kind !== 'number' || !Number.isInteger(kind)) return null;
  if (typeof createdAt !== 'number' || !Number.isFinite(createdAt)) return null;
  if (typeof content !== 'string') return null;
  // An unsigned frame is not an event. Dropping it here means the verifier
  // below never has to invent a policy for "no signature at all".
  if (typeof sig !== 'string' || sig.length === 0) return null;
  if (!Array.isArray(tags)) return null;
  if (!tags.every((tag) => Array.isArray(tag) && tag.every((v) => typeof v === 'string'))) {
    return null;
  }
  return { id, pubkey, kind, created_at: createdAt, content, tags: tags as string[][], sig };
}

/**
 * The proof half of ingest: keep only the events whose id is their own hash
 * and whose signature is that id signed by the pubkey they claim.
 *
 * WHY THIS EXISTS AT ALL. Every filter in this module is a REQUEST. `#g` asks
 * for a cell, `authors` would ask for a pubkey — a relay may answer with
 * whatever it likes, and until this ran, whatever it liked is what appeared on
 * the map. Verification happens once, on the pooled result, BEFORE the
 * newest-per-pubkey merge, so a hostile relay cannot win that race with a
 * forged `created_at`.
 *
 * A failing event is dropped rather than thrown on: one bad relay must not
 * take the feed down, and an absent marker is the honest outcome.
 */
async function verifiedEvents(events: readonly NostrEvent[]): Promise<NostrEvent[]> {
  const verdicts = await Promise.all(events.map((event) => isVerifiedEvent(event)));
  return events.filter((_, index) => verdicts[index]);
}

function tagValue(event: NostrEvent, name: string): string | undefined {
  return event.tags.find((tag) => tag[0] === name)?.[1];
}

function toPresence(event: NostrEvent): Presence | null {
  const name = tagValue(event, 'name');
  const sha256 = tagValue(event, 'x');
  const bbox = tagValue(event, 'bbox');
  if (!name || !sha256 || !bbox) return null;
  // Exactly two fields, both finite, both in range. A three-field bbox is a
  // different convention and guessing which two it meant is how a marker ends
  // up in the sea.
  const parts = bbox.split(',');
  if (parts.length !== 2) return null;
  const [lon, lat] = parts.map(Number);
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
  if (lon < -180 || lon > 180 || lat < -90 || lat > 90) return null;
  return {
    pubkey: event.pubkey,
    name,
    sha256,
    lon,
    lat,
    message: event.content,
    createdAt: event.created_at,
  };
}

/** Decode a geohash back to its cell centre — the inverse of the encoder. */
export function geohashDecode(hash: string): { lon: number; lat: number } | null {
  let latMin = -90;
  let latMax = 90;
  let lonMin = -180;
  let lonMax = 180;
  let evenBit = true;
  for (const char of hash) {
    const value = GEOHASH_BASE32.indexOf(char);
    if (value < 0) return null;
    for (let bit = 4; bit >= 0; bit -= 1) {
      const on = (value >> bit) & 1;
      if (evenBit) {
        const mid = (lonMin + lonMax) / 2;
        if (on) lonMin = mid;
        else lonMax = mid;
      } else {
        const mid = (latMin + latMax) / 2;
        if (on) latMin = mid;
        else latMax = mid;
      }
      evenBit = !evenBit;
    }
  }
  return { lon: (lonMin + lonMax) / 2, lat: (latMin + latMax) / 2 };
}

/**
 * The guard that keeps this client and the publisher in step.
 *
 * Every precision that reaches a filter passes through here. It cannot fail
 * while precisions are drawn from `QUERYABLE_PRECISIONS`, and that is exactly
 * the property worth pinning: the day someone writes a literal `5` back into a
 * filter, this throws instead of returning an empty map.
 */
export function assertQueryablePrecision(precision: number): void {
  if (!QUERYABLE_PRECISIONS.includes(precision)) {
    throw new Error(
      `geohash precision ${String(precision)} is not on the social ladder ` +
        `[${QUERYABLE_PRECISIONS.join(', ')}] — relays match g tags exactly, ` +
        'so this filter could only ever return nothing',
    );
  }
}

/**
 * A viewport reduced to boxes the covering grid can accept: latitude clamped
 * to the geohash domain, longitude unwrapped, and a seam crossing split in
 * two.
 *
 * Both spellings of a crossing are handled — `[170, -10, -170, 10]` (east west
 * of west) and MapLibre's unwrapped `[170, -10, 190, 10]` after a horizontal
 * pan. Neither may be covered as one box: `coverCells` walks west to east, so
 * a wrapped box would enumerate the entire globe MINUS the viewport.
 *
 * Latitude is clamped and NOT rejected because presence exists above the
 * Mercator cut-off even though tiles do not; longitude is never clamped,
 * because clamping a seam viewport silently moves it.
 */
function viewportSegments(bbox: BBox4326): BBox4326[] {
  const [rawWest, rawSouth, rawEast, rawNorth] = bbox;
  if (![rawWest, rawSouth, rawEast, rawNorth].every((value) => Number.isFinite(value))) return [];

  const south = Math.min(Math.max(rawSouth, -90), 90);
  const north = Math.min(Math.max(rawNorth, -90), 90);
  if (south > north) return [];

  let west = rawWest;
  let east = rawEast;
  if (east < west) east += 360;
  if (east - west >= 360) return [[-180, south, 180, north]];

  const width = east - west;
  west = ((((west + 180) % 360) + 360) % 360) - 180;
  east = west + width;
  if (east > 180) {
    return [
      [west, south, 180, north],
      [-180, south, east - 360, north],
    ];
  }
  return [[west, south, east, north]];
}

/** Is this decoded position inside the viewport the cells were built for? */
function inSegments(segments: readonly BBox4326[], lon: number, lat: number): boolean {
  return segments.some(
    ([west, south, east, north]) =>
      west <= lon && lon <= east && south <= lat && lat <= north,
  );
}

/**
 * The `#g` cells covering a viewport, on the finest rung of the ladder that
 * fits in one filter.
 *
 * Finest-that-fits, not span-lookup-table: a tight cover over-fetches least,
 * and dropping a rung when it does not fit keeps the answer complete instead
 * of trading coverage for selectivity. The predecessor did the opposite — it
 * picked a precision from the span and then cut the cell list off at 48 with
 * no signal, which over continental Europe was 48 of the 43,617 cells needed,
 * or 0.1% of the viewport reported as if it were all of it.
 *
 * The cover itself is exact integer index arithmetic in `@terrdvm/geo-protocol`
 * — interior cells included by construction, no float stepping, no sampling.
 */
export function coverageFor(bbox: BBox4326, maxCells = MAX_GEOHASH_CELLS): GeohashCoverage {
  if (!Number.isInteger(maxCells) || maxCells < 1) {
    throw new Error(`maxCells must be a positive integer, got ${String(maxCells)}`);
  }
  const coarsest = QUERYABLE_PRECISIONS[0];
  const segments = viewportSegments(bbox);
  if (segments.length === 0) {
    // Nothing coverable. Reported as INCOMPLETE, never as an empty area.
    return { precision: coarsest, cells: [], complete: false, requiredCells: 0, segments };
  }

  for (let rung = QUERYABLE_PRECISIONS.length - 1; rung >= 0; rung -= 1) {
    const precision = QUERYABLE_PRECISIONS[rung];
    const required = segments.reduce(
      (total, segment) => total + coverCellCount(segment, precision),
      0,
    );
    // The coarsest rung is the floor: below it there is no ladder left, so it
    // is taken even when it overflows, and the overflow is reported.
    if (required > maxCells && rung > 0) continue;
    assertQueryablePrecision(precision);
    const cells = segments.flatMap((segment) => coverCells(segment, precision));
    return {
      precision,
      // Deterministic truncation: `coverCells` order is normative, so the kept
      // prefix is the westernmost columns rather than an arbitrary subset.
      cells: cells.slice(0, maxCells),
      complete: cells.length <= maxCells,
      requiredCells: cells.length,
      segments,
    };
  }

  /* c8 ignore next */
  throw new Error('QUERYABLE_PRECISIONS is empty — the social ladder has no rungs');
}

type RelayFilter = Record<string, unknown>;

function queryRelay(
  relay: string,
  filter: RelayFilter,
  timeoutMs: number,
): Promise<NostrEvent[]> {
  return new Promise((resolve) => {
    const events: NostrEvent[] = [];
    let socket: WebSocket;
    try {
      socket = new WebSocket(relay);
    } catch {
      resolve([]);
      return;
    }
    const finish = (): void => {
      clearTimeout(deadline);
      try {
        socket.close();
      } catch {
        // Already closed.
      }
      resolve(events);
    };
    const deadline = setTimeout(finish, timeoutMs);
    const subscription = `terrdvm-presence-${Math.floor(Math.random() * 1e9)}`;
    socket.onopen = () =>
      socket.send(JSON.stringify(['REQ', subscription, filter]));
    socket.onmessage = (message) => {
      try {
        const frame = JSON.parse(String(message.data));
        if (frame[0] === 'EVENT' && frame[1] === subscription) {
          const event = asEvent(frame[2]);
          if (event) events.push(event);
        }
        if (frame[0] === 'EOSE' && frame[1] === subscription) finish();
      } catch {
        // Ignore frames that are not for us.
      }
    };
    socket.onerror = finish;
  });
}

async function collectPresences(
  cells: readonly string[] | null,
  timeoutMs: number,
): Promise<Presence[]> {
  const filter: RelayFilter = {
    kinds: [30315],
    '#t': ['terrdvm-presence'],
    limit: 128,
    ...(cells && cells.length > 0 ? { '#g': [...cells] } : {}),
  };
  const settled = await Promise.allSettled(
    PLACEMENT_RELAYS.map((relay) => queryRelay(relay, filter, timeoutMs)),
  );
  const candidates = settled.flatMap((result) =>
    result.status === 'fulfilled' ? result.value : [],
  );
  const newest = new Map<string, NostrEvent>();
  for (const event of await verifiedEvents(candidates)) {
    if (event.kind !== 30315) continue;
    const seen = newest.get(event.pubkey);
    if (!seen || event.created_at > seen.created_at) newest.set(event.pubkey, event);
  }
  return [...newest.values()]
    .map(toPresence)
    .filter((presence): presence is Presence => presence !== null);
}

/**
 * Everyone whose latest status stands inside this bbox — newest event per
 * pubkey wins, exactly the replaceable semantics of kind 30315.
 *
 * `onCoverage` reports what was actually asked for. When it reports
 * `complete: false` the returned list is a subset and an empty result means
 * "we stopped looking", not "nobody is here" — the caller decides whether to
 * say so.
 */
export async function fetchPresences(
  bbox: BBox4326,
  timeoutMs = 4000,
  onCoverage?: (coverage: GeohashCoverage) => void,
): Promise<Presence[]> {
  const coverage = coverageFor(bbox);
  onCoverage?.(coverage);
  // No cells means no query worth sending: `'#g': []` is a filter that matches
  // nothing, which would arrive back looking exactly like an empty area.
  if (coverage.cells.length === 0) return [];
  const presences = await collectPresences(coverage.cells, timeoutMs);
  return presences.filter((presence) =>
    inSegments(coverage.segments, presence.lon, presence.lat),
  );
}

/** Every terrdvm presence on the wire, worldwide — the globe console feed. */
export function fetchGlobalPresences(timeoutMs = 4000): Promise<Presence[]> {
  return collectPresences(null, timeoutMs);
}

/** A live, geo-tagged note from the wider network. */
export type GeoNote = {
  id: string;
  pubkey: string;
  content: string;
  lon: number;
  lat: number;
  createdAt: number;
};

/** A NIP-52 meetup renders as calendar glyph + title + local start time. */
function meetupLabel(event: NostrEvent): string {
  const tag = (name: string): string =>
    event.tags.find((entry) => entry[0] === name && typeof entry[1] === 'string')?.[1] ?? '';
  const title = tag('title') || tag('location') || 'meetup';
  const starts = Number(tag('start'));
  if (!Number.isFinite(starts) || starts <= 0) return `📅 ${title}`;
  const when = new Date(starts * 1000);
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `📅 ${title} ${pad(when.getHours())}:${pad(when.getMinutes())}`;
}

const GEO_NOTE_KINDS = [1, 1063, 31923];

/**
 * Fresh geo-tagged notes (kind 1), model announcements (1063) and meetups
 * (31923) inside the bbox — the wider network on the map, newest first.
 *
 * `onCoverage` carries the same warning as `fetchPresences`: a `complete:
 * false` coverage means this list is a subset of what is out there.
 */
export async function fetchGeoNotes(
  bbox: BBox4326,
  timeoutMs = 4500,
  onCoverage?: (coverage: GeohashCoverage) => void,
): Promise<GeoNote[]> {
  const coverage = coverageFor(bbox);
  onCoverage?.(coverage);
  if (coverage.cells.length === 0) return [];

  const filter: RelayFilter = {
    // Plain notes, model announcements and NIP-52 meetups — anything
    // geo-tagged and fresh.
    kinds: [...GEO_NOTE_KINDS],
    '#g': [...coverage.cells],
    since: Math.floor(Date.now() / 1000) - 48 * 3600,
    limit: 100,
  };
  const settled = await Promise.allSettled(
    PLACEMENT_RELAYS.map((relay) => queryRelay(relay, filter, timeoutMs)),
  );
  const candidates = settled.flatMap((result) =>
    result.status === 'fulfilled' ? result.value : [],
  );
  const byId = new Map<string, NostrEvent>();
  for (const event of await verifiedEvents(candidates)) {
    if (GEO_NOTE_KINDS.includes(event.kind)) byId.set(event.id, event);
  }
  const notes: GeoNote[] = [];
  for (const event of byId.values()) {
    // The longest geohash carries the finest position.
    const hashes = event.tags
      .filter((tag) => tag[0] === 'g' && typeof tag[1] === 'string')
      .map((tag) => tag[1])
      .sort((a, b) => b.length - a.length);
    const spot = hashes.length > 0 ? geohashDecode(hashes[0]) : null;
    if (!spot) continue;
    if (!inSegments(coverage.segments, spot.lon, spot.lat)) continue;
    notes.push({
      id: event.id,
      pubkey: event.pubkey,
      content: event.kind === 31923 ? meetupLabel(event) : event.content,
      lon: spot.lon,
      lat: spot.lat,
      createdAt: event.created_at,
    });
  }
  return notes.sort((a, b) => b.createdAt - a.createdAt);
}
