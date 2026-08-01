import { describe, expect, it } from 'vitest';

import { schnorr } from '@noble/curves/secp256k1.js';
import { sha256 as nobleSha256 } from '@noble/hashes/sha2.js';

import {
  VerificationError,
  isVerifiedEvent,
  serializeEvent,
  sha256,
  verifyBlob,
  verifyEventId,
  verifyEventSignature,
  type SignedEvent,
} from '../../src/verify';

/**
 * A real secret key, so the fixtures below carry real signatures. Verification
 * tests that sign with a stub prove only that the stub agrees with itself.
 */
const SECRET = new Uint8Array(32).fill(7);
const PUBKEY = toHex(schnorr.getPublicKey(SECRET));

function toHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Build a genuinely signed event.
 *
 * The id is computed with @noble/hashes rather than with the module under
 * test, so the two implementations cross-check: if `serializeEvent` ever
 * drifts from NIP-01, these fixtures stop verifying.
 */
export function signEvent(draft: {
  kind: number;
  created_at: number;
  content: string;
  tags: string[][];
}): SignedEvent {
  const serialised = JSON.stringify([
    0,
    PUBKEY,
    draft.created_at,
    draft.kind,
    draft.tags,
    draft.content,
  ]);
  const id = toHex(nobleSha256(new TextEncoder().encode(serialised)));
  const sig = toHex(schnorr.sign(hexBytes(id), SECRET));
  return { id, pubkey: PUBKEY, sig, ...draft };
}

function hexBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i += 1) out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

const GOOD = signEvent({
  kind: 30315,
  created_at: 1_767_225_600,
  content: 'here: felix',
  tags: [['name', 'felix'], ['t', 'terrcvm-presence']],
});

describe('sha256', () => {
  it('matches the published digest of the empty input and of "abc"', async () => {
    expect(await sha256(new Uint8Array(0))).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
    expect(await sha256(new TextEncoder().encode('abc'))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('hashes only the bytes of a view, not its whole backing buffer', async () => {
    const backing = new Uint8Array([9, 9, 9, 97, 98, 99, 9, 9]);
    expect(await sha256(backing.subarray(3, 6))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });
});

describe('verifyBlob', () => {
  const bytes = new TextEncoder().encode('abc');
  const digest = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';

  it('accepts bytes that hash to the hash they were fetched under', async () => {
    await expect(verifyBlob(bytes, digest)).resolves.toBeUndefined();
  });

  it('refuses bytes the server substituted for the ones we asked for', async () => {
    // The whole point: the URL named a hash, the server answered with other
    // bytes, and before this check the app rendered them.
    const substituted = new TextEncoder().encode('abd');
    await expect(verifyBlob(substituted, digest)).rejects.toThrow(VerificationError);
    await expect(verifyBlob(substituted, digest)).rejects.toThrow(/BLOB_HASH_MISMATCH/);
  });

  it('refuses a single flipped byte in a large blob', async () => {
    const large = new Uint8Array(65_536).map((_, index) => index & 0xff);
    const hash = await sha256(large);
    await expect(verifyBlob(large, hash)).resolves.toBeUndefined();
    large[40_000] ^= 0x01;
    await expect(verifyBlob(large, hash)).rejects.toThrow(/BLOB_HASH_MISMATCH/);
  });

  it('refuses an expected hash that is not a hash', async () => {
    for (const bad of ['', 'deadbeef', digest.toUpperCase(), `${digest}0`]) {
      await expect(verifyBlob(bytes, bad)).rejects.toThrow(/MALFORMED_HEX/);
    }
  });
});

describe('verifyEventId', () => {
  it('accepts an untouched event', async () => {
    await expect(verifyEventId(GOOD)).resolves.toBeUndefined();
  });

  it('catches a relay that rewrote the content in flight', async () => {
    const tampered = { ...GOOD, content: 'here: someone else' };
    await expect(verifyEventId(tampered)).rejects.toThrow(/EVENT_ID_MISMATCH/);
  });

  it('catches a relay that added, removed or reordered a tag', async () => {
    await expect(verifyEventId({ ...GOOD, tags: [...GOOD.tags, ['g', 'u2ed']] })).rejects.toThrow(
      /EVENT_ID_MISMATCH/,
    );
    await expect(verifyEventId({ ...GOOD, tags: [] })).rejects.toThrow(/EVENT_ID_MISMATCH/);
    await expect(
      verifyEventId({ ...GOOD, tags: [...GOOD.tags].reverse() }),
    ).rejects.toThrow(/EVENT_ID_MISMATCH/);
  });

  it('catches a swapped id, a swapped author and a moved timestamp', async () => {
    await expect(verifyEventId({ ...GOOD, id: 'f'.repeat(64) })).rejects.toThrow(
      /EVENT_ID_MISMATCH/,
    );
    await expect(verifyEventId({ ...GOOD, pubkey: 'a'.repeat(64) })).rejects.toThrow(
      /EVENT_ID_MISMATCH/,
    );
    await expect(verifyEventId({ ...GOOD, created_at: GOOD.created_at + 1 })).rejects.toThrow(
      /EVENT_ID_MISMATCH/,
    );
  });

  it('refuses an object that is not a signed event at all', async () => {
    const broken = [
      { ...GOOD, tags: 'here' },
      { ...GOOD, created_at: 1.5 },
      { ...GOOD, content: 42 },
      { ...GOOD, sig: undefined },
      { ...GOOD, tags: [['g', 5]] },
    ] as unknown as SignedEvent[];
    for (const event of broken) {
      await expect(verifyEventId(event)).rejects.toThrow(/EVENT_MALFORMED/);
    }
  });

  it('survives content that needs every NIP-01 escape', async () => {
    const gnarly = signEvent({
      kind: 1,
      created_at: 7,
      content: 'line\nbreak "quoted" back\\slash tab\there  ünïcödé 🦀',
      tags: [['g', 'u2e"d\n']],
    });
    await expect(verifyEventId(gnarly)).resolves.toBeUndefined();
    expect(serializeEvent(gnarly)).not.toContain('\n\n');
  });
});

describe('verifyEventSignature', () => {
  it('accepts an event genuinely signed by the pubkey it claims', async () => {
    await expect(verifyEventSignature(GOOD)).resolves.toBeUndefined();
    await expect(isVerifiedEvent(GOOD)).resolves.toBe(true);
  });

  it('refuses an event signed by somebody else', async () => {
    // The forger writes their own content, mints a consistent id for it, and
    // signs it — but under a DIFFERENT key while claiming ours. The id check
    // passes; only the curve maths catches this.
    const otherSecret = new Uint8Array(32).fill(9);
    const forged = signEvent({ kind: 30315, created_at: 5, content: 'not mine', tags: [] });
    forged.sig = toHex(schnorr.sign(hexBytes(forged.id), otherSecret));
    await expect(verifyEventId(forged)).resolves.toBeUndefined();
    await expect(verifyEventSignature(forged)).rejects.toThrow(/EVENT_SIGNATURE_INVALID/);
    await expect(isVerifiedEvent(forged)).resolves.toBe(false);
  });

  it('refuses a flipped bit anywhere in the signature', async () => {
    for (const at of [0, 63, 127]) {
      const swapped = GOOD.sig[at] === '0' ? '1' : '0';
      const sig = `${GOOD.sig.slice(0, at)}${swapped}${GOOD.sig.slice(at + 1)}`;
      expect(sig).toHaveLength(GOOD.sig.length);
      await expect(verifyEventSignature({ ...GOOD, sig })).rejects.toThrow(
        /EVENT_SIGNATURE_INVALID/,
      );
    }
  });

  it('refuses a signature or pubkey of the wrong length', async () => {
    await expect(verifyEventSignature({ ...GOOD, sig: 'ab' })).rejects.toThrow(/MALFORMED_HEX/);
    await expect(verifyEventSignature({ ...GOOD, sig: `${GOOD.sig}ff` })).rejects.toThrow(
      /MALFORMED_HEX/,
    );
    await expect(isVerifiedEvent({ ...GOOD, sig: 'zz'.repeat(32) })).resolves.toBe(false);
  });

  it('will not pass tampered content just because the signature is real', async () => {
    // The signature over GOOD.id is genuine; the content underneath is not
    // what was signed. Checking the signature alone would wave this through.
    const tampered = { ...GOOD, content: 'edited by the relay' };
    await expect(verifyEventSignature(tampered)).rejects.toThrow(/EVENT_ID_MISMATCH/);
    await expect(isVerifiedEvent(tampered)).resolves.toBe(false);
  });
});
