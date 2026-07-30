import { PLACEMENT_RELAYS } from './publish';
import type { BBox4326 } from '../bbox/validate';

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

function queryRelay(
  relay: string,
  geohash: string | null,
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
      socket.send(
        JSON.stringify([
          'REQ',
          subscription,
          {
            kinds: [30315],
            '#t': ['terrdvm-presence'],
            limit: 128,
            ...(geohash ? { '#g': [geohash] } : {}),
          },
        ]),
      );
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
  const settled = await Promise.allSettled(
    PLACEMENT_RELAYS.map((relay) => queryRelay(relay, geohash, timeoutMs)),
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
