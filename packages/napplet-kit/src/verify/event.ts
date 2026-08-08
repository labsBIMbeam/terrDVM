import { schnorr } from '@noble/curves/secp256k1.js';

import { VerificationError } from './errors';
import { hexToBytes, sha256 } from './hash';

/**
 * What a relay's answer is worth before anybody checks it.
 *
 * A nostr filter is a REQUEST. `authors: [pubkey]` asks a relay to send events
 * from that pubkey; it does not oblige it to, and a hostile or compromised
 * relay can answer with anything at all — a different author, a mutated
 * `content`, an `id` that belongs to some other event. Nothing about the
 * transport prevents it. The only thing that does is this file: the id is the
 * SHA-256 of the event's own canonical serialisation, and the signature is a
 * BIP-340 signature over that id by the pubkey the event claims.
 *
 * `verifyEventId` needs no curve maths and catches a relay that edited the
 * content in flight. `verifyEventSignature` is the real proof of authorship
 * and costs ~10 kB gzipped of @noble/curves — measured, and roughly 3% of a
 * bundle that already carries MapLibre.
 */

export type SignedEvent = {
  id: string;
  pubkey: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
  sig: string;
};

function assertShape(event: SignedEvent): void {
  const ok =
    typeof event === 'object' &&
    event !== null &&
    typeof event.id === 'string' &&
    typeof event.pubkey === 'string' &&
    typeof event.sig === 'string' &&
    typeof event.content === 'string' &&
    Number.isInteger(event.kind) &&
    Number.isInteger(event.created_at) &&
    Array.isArray(event.tags) &&
    event.tags.every((tag) => Array.isArray(tag) && tag.every((v) => typeof v === 'string'));
  if (!ok) throw new VerificationError('EVENT_MALFORMED', 'not a signed NIP-01 event');
}

/**
 * The NIP-01 serialisation an event id is the hash of.
 *
 * The spec asks for a UTF-8 JSON array with no whitespace and the specific
 * escapes `\n \" \\ \r \t \b \f`, everything else literal. `JSON.stringify`
 * emits exactly that — no spaces, those seven escapes, `\uXXXX` for the
 * remaining control characters — so it is the serialiser rather than a
 * hand-rolled one that would drift from the relays.
 */
export function serializeEvent(event: SignedEvent): string {
  return JSON.stringify([
    0,
    event.pubkey,
    event.created_at,
    event.kind,
    event.tags,
    event.content,
  ]);
}

/**
 * Recompute the id and compare. Cheap, dependency-free, and enough on its own
 * to catch a relay that changed a byte of `content` or swapped the tags.
 *
 * It does NOT prove authorship: anyone can mint a consistent id for content
 * they wrote under someone else's pubkey. That is what the signature is for.
 */
export async function verifyEventId(event: SignedEvent): Promise<void> {
  assertShape(event);
  const computed = await sha256(new TextEncoder().encode(serializeEvent(event)));
  if (computed !== event.id.toLowerCase()) {
    throw new VerificationError(
      'EVENT_ID_MISMATCH',
      `event claims id ${event.id}, its own content hashes to ${computed}`,
    );
  }
}

/**
 * Full BIP-340 verification: the id must be the event's own hash, and the
 * signature must be that id signed by the pubkey the event claims.
 *
 * The id check comes first on purpose. Without it a forger could sign a
 * genuine id and attach it to different content, and the signature would
 * verify against a message that no longer describes the event.
 */
export async function verifyEventSignature(event: SignedEvent): Promise<void> {
  await verifyEventId(event);
  const signature = hexToBytes(event.sig, 64, 'event signature');
  const message = hexToBytes(event.id, 32, 'event id');
  const publicKey = hexToBytes(event.pubkey, 32, 'event pubkey');
  if (!schnorr.verify(signature, message, publicKey)) {
    throw new VerificationError(
      'EVENT_SIGNATURE_INVALID',
      `event ${event.id} is not signed by ${event.pubkey}`,
    );
  }
}

/**
 * The same check, as a boolean, for stream ingest.
 *
 * A feed of relay events cannot throw on the first bad frame — one hostile
 * relay would then take the whole map down. Dropping an unverified event IS
 * failing closed here: it never reaches the renderer, and an absent marker is
 * the honest outcome. This is the ONLY place a verification failure is allowed
 * to become a boolean, and it is deliberately not exported as a general
 * "verify, maybe" helper.
 */
export async function isVerifiedEvent(event: SignedEvent): Promise<boolean> {
  try {
    await verifyEventSignature(event);
    return true;
  } catch (error) {
    if (error instanceof VerificationError) return false;
    throw error;
  }
}
