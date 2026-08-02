/**
 * The one failure type the verification layer raises.
 *
 * Named, coded and thrown — never swallowed into a boolean at this level. A
 * caller that wants a boolean asks for one explicitly (`isVerifiedEvent`), so
 * that "we did not check" can never be spelled the same way as "it checked
 * out".
 */
export type VerificationCode =
  /** The environment has no `crypto.subtle`; nothing can be verified at all. */
  | 'DIGEST_UNAVAILABLE'
  /** A hash, pubkey or signature was not the hex string it had to be. */
  | 'MALFORMED_HEX'
  /** The bytes that arrived do not hash to the hash they were asked for. */
  | 'BLOB_HASH_MISMATCH'
  /** The object does not have the fields a signed NIP-01 event has. */
  | 'EVENT_MALFORMED'
  /** The event's `id` is not the SHA-256 of its own serialisation. */
  | 'EVENT_ID_MISMATCH'
  /** The BIP-340 signature does not verify against the pubkey and id. */
  | 'EVENT_SIGNATURE_INVALID';

export class VerificationError extends Error {
  readonly code: VerificationCode;

  constructor(code: VerificationCode, detail: string) {
    super(`${code}: ${detail}`);
    this.name = 'VerificationError';
    this.code = code;
  }
}
