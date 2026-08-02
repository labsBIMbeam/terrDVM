import { loadApprovedBytes } from '@terrcvm/napplet-kit/shell/resource-client';
import { COLLECTION_SERVICE, collectionOrigin } from '@terrcvm/napplet-kit/job/collection';

/**
 * Placement publishing: the collection server builds the unsigned NIP-94
 * announcement, a NIP-07 signer signs it, and the signed event goes to the
 * relays. The app never sees a key.
 *
 * DEV-PATH NOTE: `window.nostr` and a direct relay WebSocket are the plain-
 * browser path. Inside a real napplet shell both must route through shell
 * domains (signer capability, OUTBOX publish) instead — this module is the
 * seam where that swap happens.
 */

export const PLACEMENT_RELAYS = ['wss://relay.bimcvp.com', 'wss://relay.damus.io'] as const;

export type UnsignedEvent = {
  kind: number;
  created_at: number;
  content: string;
  tags: string[][];
};

export type SignedEvent = UnsignedEvent & { id: string; pubkey: string; sig: string };

type Nip07 = { signEvent: (event: UnsignedEvent) => Promise<SignedEvent> };

export function nipSigner(): Nip07 | null {
  const candidate = (window as Window & { nostr?: unknown }).nostr;
  if (
    candidate &&
    typeof (candidate as Record<string, unknown>).signEvent === 'function'
  ) {
    return candidate as Nip07;
  }
  return null;
}

export function isApprovedPlacementEventUrl(candidate: string): boolean {
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return false;
  }
  if (url.origin !== collectionOrigin() || url.pathname !== '/placements/event') return false;
  return [...url.searchParams.keys()].every(
    (key) => key === 'character' || key === 'at' || key === 'heading' || key === 'message',
  );
}

export function isApprovedCalendarEventUrl(candidate: string): boolean {
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return false;
  }
  if (url.origin !== collectionOrigin() || url.pathname !== '/calendar/event') return false;
  return [...url.searchParams.keys()].every(
    (key) => key === 'title' || key === 'at' || key === 'starts' || key === 'description',
  );
}

export function isApprovedPresenceEventUrl(candidate: string): boolean {
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return false;
  }
  if (url.origin !== collectionOrigin() || url.pathname !== '/presence/event') return false;
  return [...url.searchParams.keys()].every(
    (key) => key === 'character' || key === 'at' || key === 'message',
  );
}

/**
 * Ask the server for the unsigned NIP-38 status (kind 30315): replaceable,
 * so publishing from a new spot overwrites the old one — presence semantics
 * for free, on an existing kind.
 */
export async function buildPresenceEvent(
  character: string,
  lon: number,
  lat: number,
  message = '',
): Promise<UnsignedEvent> {
  const url = new URL(`${COLLECTION_SERVICE.baseUrl}/presence/event`);
  url.searchParams.set('character', character);
  url.searchParams.set('at', `${lon.toFixed(6)},${lat.toFixed(6)}`);
  if (message) url.searchParams.set('message', message);
  const blob = await loadApprovedBytes(url.toString(), {
    deadlineMs: 15_000,
    isAllowed: isApprovedPresenceEventUrl,
    signal: undefined,
  });
  const event = JSON.parse(await blob.text()) as UnsignedEvent;
  if (event.kind !== 30315 || !Array.isArray(event.tags)) {
    throw new Error('Server returned an unexpected status shape.');
  }
  return event;
}

/**
 * Ask the server for the unsigned NIP-52 calendar event (kind 31923): the
 * map message grown into a meetup with venue, start time and geo tags.
 */
export async function buildCalendarEvent(
  title: string,
  lon: number,
  lat: number,
  startsAt: number,
  description = '',
): Promise<UnsignedEvent> {
  const url = new URL(`${COLLECTION_SERVICE.baseUrl}/calendar/event`);
  url.searchParams.set('title', title);
  url.searchParams.set('at', `${lon.toFixed(6)},${lat.toFixed(6)}`);
  url.searchParams.set('starts', String(startsAt));
  if (description) url.searchParams.set('description', description);
  const blob = await loadApprovedBytes(url.toString(), {
    deadlineMs: 15_000,
    isAllowed: isApprovedCalendarEventUrl,
    signal: undefined,
  });
  const event = JSON.parse(await blob.text()) as UnsignedEvent;
  if (event.kind !== 31923 || !Array.isArray(event.tags)) {
    throw new Error('Server returned an unexpected calendar shape.');
  }
  return event;
}

/** Ask the server for the unsigned announcement of this placement. */
export async function buildPlacementEvent(
  character: string,
  lon: number,
  lat: number,
  heading = 0,
  message = '',
): Promise<UnsignedEvent> {
  const url = new URL(`${COLLECTION_SERVICE.baseUrl}/placements/event`);
  url.searchParams.set('character', character);
  url.searchParams.set('at', `${lon.toFixed(6)},${lat.toFixed(6)}`);
  url.searchParams.set('heading', String(heading));
  if (message) url.searchParams.set('message', message);
  const blob = await loadApprovedBytes(url.toString(), {
    deadlineMs: 15_000,
    isAllowed: isApprovedPlacementEventUrl,
    signal: undefined,
  });
  const event = JSON.parse(await blob.text()) as UnsignedEvent;
  if (event.kind !== 1063 || !Array.isArray(event.tags)) {
    throw new Error('Server returned an unexpected announcement shape.');
  }
  return event;
}

/** Publish a signed event to one relay; resolves on OK, rejects otherwise. */
function publishToRelay(relay: string, event: SignedEvent, timeoutMs = 8000): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(relay);
    const deadline = setTimeout(() => {
      socket.close();
      reject(new Error(`${relay}: timeout`));
    }, timeoutMs);
    socket.onopen = () => socket.send(JSON.stringify(['EVENT', event]));
    socket.onmessage = (message) => {
      try {
        const frame = JSON.parse(String(message.data));
        if (frame[0] === 'OK' && frame[1] === event.id) {
          clearTimeout(deadline);
          socket.close();
          if (frame[2]) resolve(relay);
          else reject(new Error(`${relay}: ${frame[3] ?? 'rejected'}`));
        }
      } catch {
        // Ignore frames that are not for us.
      }
    };
    socket.onerror = () => {
      clearTimeout(deadline);
      socket.close();
      reject(new Error(`${relay}: connection failed`));
    };
  });
}

/** Sign with the NIP-07 signer and publish to the relays. */
export async function signAndPublish(event: UnsignedEvent): Promise<{
  accepted: string[];
  event: SignedEvent;
}> {
  const signer = nipSigner();
  if (!signer) {
    throw new Error('No NIP-07 signer available — install a nostr signer extension.');
  }
  const signed = await signer.signEvent(event);
  const results = await Promise.allSettled(
    PLACEMENT_RELAYS.map((relay) => publishToRelay(relay, signed)),
  );
  const accepted = results
    .filter((r): r is PromiseFulfilledResult<string> => r.status === 'fulfilled')
    .map((r) => r.value);
  if (accepted.length === 0) {
    throw new Error('No relay accepted the event.');
  }
  return { accepted, event: signed };
}
