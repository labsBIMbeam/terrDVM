import { beforeEach, describe, expect, it, vi } from 'vitest';

// The shell client is the only transport this module touches; stubbing it
// keeps the test a unit test and lets it answer with bytes of its choosing —
// which is exactly the power a compromised blob server would have.
const loadApprovedBytes = vi.fn<(url: string, options: unknown) => Promise<Blob>>();
vi.mock('../../src/shell/resource-client', () => ({
  loadApprovedBytes: (url: string, options: unknown) => loadApprovedBytes(url, options),
}));

import {
  COLLECTION_SERVICE,
  cachedDemTileUrl,
  cachedOsmUrl,
  fetchCharacterBytes,
  isApprovedCachedDemUrl,
  isApprovedCachedOsmUrl,
} from '../../src/job/collection';
import { VerificationError, sha256 } from '../../src/verify';

describe('collection cache URLs', () => {
  it('builds and approves DEM cache tiles', () => {
    const url = cachedDemTileUrl(11, 927, 826);
    expect(url).toBe(`${COLLECTION_SERVICE.baseUrl}/dem/11/927/826.png`);
    expect(isApprovedCachedDemUrl(url)).toBe(true);
  });

  it('rejects DEM URLs off the collection origin or path shape', () => {
    expect(isApprovedCachedDemUrl('https://s3.amazonaws.com/dem/11/927/826.png')).toBe(false);
    expect(isApprovedCachedDemUrl(`${COLLECTION_SERVICE.baseUrl}/dem/11/927/826.jpg`)).toBe(false);
    expect(
      isApprovedCachedDemUrl(`${COLLECTION_SERVICE.baseUrl}/dem/11/927/826.png?x=1`),
    ).toBe(false);
    expect(isApprovedCachedDemUrl('not a url')).toBe(false);
  });

  it('builds and approves cached Overpass queries with only a data key', () => {
    const url = cachedOsmUrl('[out:json];way["building"](1,2,3,4);out geom 10;');
    expect(new URL(url).pathname).toBe('/osm');
    expect(isApprovedCachedOsmUrl(url)).toBe(true);
    expect(isApprovedCachedOsmUrl(`${COLLECTION_SERVICE.baseUrl}/osm?data=x&other=y`)).toBe(false);
    expect(isApprovedCachedOsmUrl('https://overpass-api.de/osm?data=x')).toBe(false);
  });
});

describe('a blob fetched by hash is checked against that hash', () => {
  const model = new Uint8Array([0x67, 0x6c, 0x54, 0x46, 1, 2, 3, 4]);

  beforeEach(() => {
    loadApprovedBytes.mockReset();
  });

  it('returns the bytes when they hash to the hash they were asked for', async () => {
    const hash = await sha256(model);
    loadApprovedBytes.mockResolvedValue(new Blob([model]));
    const bytes = await fetchCharacterBytes(hash);
    expect(new Uint8Array(bytes)).toEqual(model);
    expect(loadApprovedBytes.mock.calls[0][0]).toBe(`${COLLECTION_SERVICE.baseUrl}/${hash}.glb`);
  });

  it('refuses geometry the server substituted for the model we asked for', async () => {
    // The URL names a SHA-256. That is a REQUEST — nothing stops the server
    // answering with a different model, and until this check existed nothing
    // did. An unverified GLB then went straight into the parser.
    const hash = await sha256(model);
    loadApprovedBytes.mockResolvedValue(new Blob([new Uint8Array([0x67, 0x6c, 0x54, 0x46, 9])]));
    await expect(fetchCharacterBytes(hash)).rejects.toThrow(VerificationError);
    await expect(fetchCharacterBytes(hash)).rejects.toThrow(/BLOB_HASH_MISMATCH/);
  });

  it('refuses a single flipped byte, not just a wholesale swap', async () => {
    const hash = await sha256(model);
    const nudged = Uint8Array.from(model);
    nudged[5] ^= 0x01;
    loadApprovedBytes.mockResolvedValue(new Blob([nudged]));
    await expect(fetchCharacterBytes(hash)).rejects.toThrow(/BLOB_HASH_MISMATCH/);
  });

  it('refuses a hash that is not a content address', async () => {
    loadApprovedBytes.mockResolvedValue(new Blob([model]));
    await expect(fetchCharacterBytes('../etc/passwd')).rejects.toThrow(/MALFORMED_HEX/);
  });
});
