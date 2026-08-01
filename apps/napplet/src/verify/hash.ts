import { VerificationError } from './errors';

/**
 * Content addressing, actually addressed.
 *
 * The interop claim in the README is that any app which can fetch a blob by
 * hash can stand the same avatar in its own scene. That claim is only worth
 * anything if somebody recomputes the hash: a URL containing a SHA-256 is a
 * REQUEST for those bytes, and the server on the other end is free to answer
 * with different ones. Until these bytes hash to the hash we asked for, they
 * are not the model — they are a stranger's reply.
 *
 * `crypto.subtle` is available in the napplet iframe (secure context) and in
 * Node, so this costs no dependency and no bundle bytes.
 */

const HEX = '0123456789abcdef';

/** 64 lowercase hex characters — the shape of every SHA-256 in this app. */
const SHA256_HEX = /^[0-9a-f]{64}$/;

function toHex(bytes: Uint8Array): string {
  let out = '';
  for (const byte of bytes) out += HEX[byte >> 4] + HEX[byte & 15];
  return out;
}

/**
 * Parse a fixed-length hex string into bytes, or fail with a named error.
 *
 * Length is part of the contract: a 63-character "signature" that parsed into
 * 31 bytes would be handed to the curve library as a shorter message and get
 * an answer to a question nobody asked.
 */
export function hexToBytes(hex: string, expectedBytes: number, what: string): Uint8Array {
  if (typeof hex !== 'string' || hex.length !== expectedBytes * 2 || !/^[0-9a-f]+$/i.test(hex)) {
    throw new VerificationError(
      'MALFORMED_HEX',
      `${what} must be ${expectedBytes * 2} hex characters`,
    );
  }
  const out = new Uint8Array(expectedBytes);
  for (let i = 0; i < expectedBytes; i += 1) {
    out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

/** SHA-256 of `bytes`, lowercase hex. */
export async function sha256(bytes: BufferSource): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    // Not a soft failure. Without a digest there is no verification, and a
    // client that cannot verify must not pretend it did.
    throw new VerificationError(
      'DIGEST_UNAVAILABLE',
      'crypto.subtle is unavailable, so nothing can be verified',
    );
  }
  const digest = await subtle.digest('SHA-256', bytes);
  return toHex(new Uint8Array(digest));
}

/**
 * The gate every blob fetched by hash passes through.
 *
 * Throws on mismatch rather than returning false: a caller that forgets to
 * test a boolean renders the wrong bytes, and a caller that forgets to await a
 * throwing check renders nothing. Fail closed means the failure mode of the
 * MISUSE has to be safe too.
 */
export async function verifyBlob(
  bytes: BufferSource,
  expectedSha256: string,
): Promise<void> {
  if (!SHA256_HEX.test(expectedSha256)) {
    throw new VerificationError(
      'MALFORMED_HEX',
      `expected hash must be 64 lowercase hex characters, got ${JSON.stringify(expectedSha256)}`,
    );
  }
  const actual = await sha256(bytes);
  if (actual !== expectedSha256) {
    throw new VerificationError(
      'BLOB_HASH_MISMATCH',
      `asked for ${expectedSha256}, the bytes that arrived hash to ${actual}`,
    );
  }
}
