import { PLACEMENT_RELAYS } from './publish';
import type { BBox4326 } from '@terrdvm/terrain-engine/bbox/validate';

/**
 * Live presence: who is standing in this area right now.
 *
 * Clients subscribe to kind 30315 (NIP-38 user status, replaceable) plus a
 * `g` geohash tag of the area — every hit is a person to render. The events
 * carry one `g` tag per precision 1-8, so an exact-match tag filter at any
 * precision works as a prefix query.
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

/** Standard geohash — matches the server's encoder tag for tag. */
export function geohashEncode(lat: number, lon: number, precision: number): string {
  let latMin = -90;
  let latMax = 90;
  let lonMin = -180;
  let lonMax = 180;
  let hash = '';
  let bit = 0;
  let value = 0;
  let evenBit = true;
  while (hash.length < precision) {
    if (evenBit) {
      const mid = (lonMin + lonMax) / 2;
      if (lon >= mid) {
        value = value * 2 + 1;
        lonMin = mid;
      } else {
        value *= 2;
        lonMax = mid;
      }
    } else {
      const mid = (latMin + latMax) / 2;
      if (lat >= mid) {
        value = value * 2 + 1;
        latMin = mid;
      } else {
        value *= 2;
        latMax = mid;
      }
    }
    evenBit = !evenBit;
    bit += 1;
    if (bit === 5) {
      hash += GEOHASH_BASE32[value];
      bit = 0;
      value = 0;
    }
  }
  return hash;
}

type NostrEvent = {
  id: string;
  pubkey: string;
  kind: number;
  created_at: number;
  content: string;
  tags: string[][];
};

function tagValue(event: NostrEvent, name: string): string | undefined {
  return event.tags.find((tag) => tag[0] === name)?.[1];
}

function toPresence(event: NostrEvent): Presence | null {
  const name = tagValue(event, 'name');
  const sha256 = tagValue(event, 'x');
  const bbox = tagValue(event, 'bbox');
  if (!name || !sha256 || !bbox) return null;
  const [lon, lat] = bbox.split(',').map(Number);
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
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
        if (frame[0] === 'EVENT' && frame[1] === subscription) events.push(frame[2]);
        if (frame[0] === 'EOSE' && frame[1] === subscription) finish();
      } catch {
        // Ignore frames that are not for us.
      }
    };
    socket.onerror = finish;
  });
}

async function collectPresences(
  geohash: string | null,
  timeoutMs: number,
): Promise<Presence[]> {
  const filter: RelayFilter = {
    kinds: [30315],
    '#t': ['terrdvm-presence'],
    limit: 128,
    ...(geohash ? { '#g': [geohash] } : {}),
  };
  const settled = await Promise.allSettled(
    PLACEMENT_RELAYS.map((relay) => queryRelay(relay, filter, timeoutMs)),
  );
  const newest = new Map<string, NostrEvent>();
  for (const result of settled) {
    if (result.status !== 'fulfilled') continue;
    for (const event of result.value) {
      if (event.kind !== 30315) continue;
      const seen = newest.get(event.pubkey);
      if (!seen || event.created_at > seen.created_at) newest.set(event.pubkey, event);
    }
  }
  return [...newest.values()]
    .map(toPresence)
    .filter((presence): presence is Presence => presence !== null);
}

/**
 * Everyone whose latest status stands inside this bbox — newest event per
 * pubkey wins, exactly the replaceable semantics of kind 30315.
 */
export async function fetchPresences(
  bbox: BBox4326,
  timeoutMs = 4000,
): Promise<Presence[]> {
  const [west, south, east, north] = bbox;
  const geohash = geohashEncode((south + north) / 2, (west + east) / 2, 5);
  const presences = await collectPresences(geohash, timeoutMs);
  return presences.filter(
    (presence) =>
      west <= presence.lon && presence.lon <= east &&
      south <= presence.lat && presence.lat <= north,
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

/**
 * Geohash cells covering a bbox, precision chosen by span. Tag filters are
 * exact-match, so this catches events following the multi-precision g-tag
 * convention (as terrdvm's own do) — a prefix query does not exist in
 * nostr filters.
 */
function cellsFor(bbox: BBox4326, cap = 48): string[] {
  const [west, south, east, north] = bbox;
  const span = Math.max(east - west, north - south);
  const precision = span > 60 ? 2 : span > 8 ? 3 : 4;
  const lonStep = precision === 2 ? 11.25 : precision === 3 ? 1.40625 : 0.3515625;
  const latStep = precision === 2 ? 5.625 : precision === 3 ? 1.40625 : 0.17578125;
  const cells = new Set<string>();
  for (let lat = south; lat <= north + latStep && cells.size < cap; lat += latStep) {
    for (let lon = west; lon <= east + lonStep && cells.size < cap; lon += lonStep) {
      cells.add(geohashEncode(Math.min(85, lat), Math.min(180, lon), precision));
    }
  }
  return [...cells];
}

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

/** Fresh geo-tagged notes (kind 1) inside the bbox — the wider network on
 * the map, newest first. */
export async function fetchGeoNotes(
  bbox: BBox4326,
  timeoutMs = 4500,
): Promise<GeoNote[]> {
  const [west, south, east, north] = bbox;
  const filter: RelayFilter = {
    // Plain notes, model announcements and NIP-52 meetups — anything
    // geo-tagged and fresh.
    kinds: [1, 1063, 31923],
    '#g': cellsFor(bbox),
    since: Math.floor(Date.now() / 1000) - 48 * 3600,
    limit: 100,
  };
  const settled = await Promise.allSettled(
    PLACEMENT_RELAYS.map((relay) => queryRelay(relay, filter, timeoutMs)),
  );
  const byId = new Map<string, NostrEvent>();
  for (const result of settled) {
    if (result.status !== 'fulfilled') continue;
    for (const event of result.value) {
      if (event.kind === 1 || event.kind === 1063 || event.kind === 31923) {
        byId.set(event.id, event);
      }
    }
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
    if (spot.lon < west || spot.lon > east || spot.lat < south || spot.lat > north) continue;
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
