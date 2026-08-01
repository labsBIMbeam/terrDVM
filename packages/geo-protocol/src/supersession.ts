/**
 * Which of several events sharing `(kind, pubkey, d)` is the head, and how a
 * publisher derives a `created_at` that can always be superseded.
 * CONTRACT.md §9.
 */

import { MAX_CREATED_AT } from './kinds';
import { reject } from './errors';

/** The minimum an event needs for supersession to be decidable. */
export type AddressableHead = { id: string; created_at: number };

/**
 * The next `created_at` for an addressable event, given the last one this
 * publisher wrote to the same `(kind, pubkey, d)`.
 *
 * `max(now, last + 1)`. This is the ONLY place a publisher may derive
 * `created_at` from — `docs/ARCHITECTURE.md:138` already mandates deriving it
 * monotonically per `(source, d)` from the publisher clock and never from the
 * upstream record, and version 1 had no guard at all. A clock that skews
 * forward once writes a head that can never be superseded, and the publisher
 * still sees `OK` from the relay: the failure is invisible from the inside.
 *
 * Builders are pure functions and hold no clock, so they cannot enforce this;
 * the publisher keeps the per-address high-water mark and calls this.
 *
 * Overflow REJECTS rather than wraps. A wrapped timestamp is a new head at
 * year 1970 that every existing event already supersedes, which loses the
 * write silently.
 */
export function nextCreatedAt(lastPublished: number | null, nowSeconds: number): number {
  if (!Number.isInteger(nowSeconds) || nowSeconds < 0 || nowSeconds > MAX_CREATED_AT) {
    reject(
      'CREATED_AT_RANGE',
      `nowSeconds must be an integer in 0..${MAX_CREATED_AT}, got ${String(nowSeconds)}`,
    );
  }
  if (lastPublished !== null) {
    if (!Number.isInteger(lastPublished) || lastPublished < 0 || lastPublished > MAX_CREATED_AT) {
      reject(
        'CREATED_AT_RANGE',
        `lastPublished must be an integer in 0..${MAX_CREATED_AT}, got ${String(lastPublished)}`,
      );
    }
  }

  const next = lastPublished === null ? nowSeconds : Math.max(nowSeconds, lastPublished + 1);
  if (next > MAX_CREATED_AT) {
    reject('CREATED_AT_RANGE', `created_at would exceed ${MAX_CREATED_AT}; refusing to wrap`);
  }
  return next;
}

/**
 * The head of an address: highest `created_at`, and on a tie the LOWEST event
 * id.
 *
 * NIP-01 leaves the tie unspecified, which means two clients can legitimately
 * disagree about which of two same-second events is current — and then render
 * different maps from the same relay. This protocol does not leave it
 * unspecified.
 */
export function selectHead<T extends AddressableHead>(events: readonly T[]): T | null {
  let head: T | null = null;
  for (const event of events) {
    if (head === null) {
      head = event;
      continue;
    }
    if (event.created_at > head.created_at) {
      head = event;
    } else if (event.created_at === head.created_at && event.id < head.id) {
      head = event;
    }
  }
  return head;
}
