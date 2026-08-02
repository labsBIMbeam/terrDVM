/**
 * The house rule, made real: nothing is delivered until bytes and hash verify.
 *
 * Before this module the napplet contained no cryptography whatsoever — no
 * `crypto.subtle`, no signature check anywhere in `apps/` or `packages/`. The
 * consequences were specific, not theoretical:
 *
 *  - an `authors` filter was a request to a relay, not a proof of authorship;
 *  - a blob fetched at `/<sha256>.glb` was trusted because of its URL;
 *  - the interop story ("fetch the avatar by hash") had nobody checking hashes.
 *
 * Two seams close that: `verifyBlob` where bytes enter (`job/collection.ts`)
 * and `isVerifiedEvent` where relay frames enter (`nostr/presence.ts`).
 */

export { VerificationError, type VerificationCode } from './errors';
export { hexToBytes, sha256, verifyBlob } from './hash';
export {
  isVerifiedEvent,
  serializeEvent,
  verifyEventId,
  verifyEventSignature,
  type SignedEvent,
} from './event';
