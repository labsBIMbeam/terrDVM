import { describe, expect, it, vi } from 'vitest';

// The collection module is the only transport `generateTerrain` touches for
// bytes; stubbing it lets a source be made to fail exactly the way a missing
// collection server makes a transcoded national source fail.
const loadBytesCacheFirst =
  vi.fn<(cacheUrl: string, isCacheAllowed: unknown, directUrl: string, options: unknown) => Promise<Blob>>();

vi.mock('../../src/job/collection', async () => {
  const actual = await vi.importActual<typeof import('../../src/job/collection')>(
    '../../src/job/collection',
  );
  return {
    ...actual,
    loadBytesCacheFirst: (
      cacheUrl: string,
      isCacheAllowed: unknown,
      directUrl: string,
      options: unknown,
    ) => loadBytesCacheFirst(cacheUrl, isCacheAllowed, directUrl, options),
  };
});

import { generateTerrain } from '../../src/terrain/generate';
import {
  SOUTH_TYROL_DTM_05M,
  TERRARIUM,
  selectElevationSources,
} from '@terrcvm/terrain-engine/terrain/elevation-sources';
import type { BBox4326 } from '@terrcvm/terrain-engine/bbox/validate';

const BOLZANO: BBox4326 = [11.34, 46.49, 11.35, 46.5];

/**
 * A one-pixel-per-tile stand-in. `generateTerrain` decodes with
 * `createImageBitmap`, which jsdom does not have, so the decode is stubbed and
 * the test stays about source selection and failover — which is what changed.
 */
function stubDecode(): void {
  vi.stubGlobal('createImageBitmap', async () => ({ width: 4, height: 4, close() {} }));
  vi.stubGlobal(
    'OffscreenCanvas',
    class {
      constructor(
        public width: number,
        public height: number,
      ) {}
      getContext() {
        return {
          drawImage() {},
          getImageData: (_x: number, _y: number, w: number, h: number) => ({
            data: new Uint8ClampedArray(w * h * 4).fill(128),
          }),
        };
      }
    },
  );
}

describe('elevation source chain in the generator', () => {
  it('asks the collection server for the national source before Terrarium', async () => {
    stubDecode();
    loadBytesCacheFirst.mockReset();
    loadBytesCacheFirst.mockResolvedValue(new Blob([new Uint8Array(64)]));

    await generateTerrain(BOLZANO, { region: 'south-tyrol', gridN: 4 });

    const [cacheUrl] = loadBytesCacheFirst.mock.calls[0];
    expect(cacheUrl).toContain('/dem/it-bz-dtm-05m/');
    expect(cacheUrl).not.toContain('amazonaws');
  });

  it('demotes to the next source when the transcode is unavailable', async () => {
    stubDecode();
    loadBytesCacheFirst.mockReset();
    loadBytesCacheFirst.mockImplementation(async (cacheUrl: string) => {
      // No collection server: every transcoded tile fails, Terrarium's own
      // upstream still answers.
      if (cacheUrl.includes('/dem/it-bz-')) throw new Error('ECONNREFUSED');
      return new Blob([new Uint8Array(64)]);
    });

    const mesh = await generateTerrain(BOLZANO, { region: 'south-tyrol', gridN: 4 });

    expect(mesh).toBeTruthy();
    const asked = loadBytesCacheFirst.mock.calls.map(([url]) => url);
    expect(asked.some((url) => url.includes('/dem/it-bz-dtm-05m/'))).toBe(true);
    expect(asked.some((url) => url.includes('/dem/it-bz-dtm-25m/'))).toBe(true);
    // The chain demotes into GLOBAL_TAIL, whose head is GEDTM30 — bare earth,
    // and the first source that answers here. Terrarium is behind it and is
    // never reached, which is the point: the tail is ordered, not a fallback
    // list to be exhausted.
    expect(asked.some((url) => url.includes('/dem/gedtm30/'))).toBe(true);
    expect(asked.some((url) => /\/dem\/\d+\/\d+\/\d+\.png$/.test(url))).toBe(false);
  });

  it('reaches Terrarium only when the whole bare-earth tail is unavailable', async () => {
    stubDecode();
    loadBytesCacheFirst.mockReset();
    loadBytesCacheFirst.mockImplementation(async (cacheUrl: string) => {
      // Every transcoded source needs the collection server; without it only
      // Terrarium's own direct upstream answers.
      if (cacheUrl.includes('/dem/it-bz-') || cacheUrl.includes('/dem/gedtm30/')) {
        throw new Error('ECONNREFUSED');
      }
      return new Blob([new Uint8Array(64)]);
    });

    const mesh = await generateTerrain(BOLZANO, { region: 'south-tyrol', gridN: 4 });

    expect(mesh).toBeTruthy();
    const asked = loadBytesCacheFirst.mock.calls.map(([url]) => url);
    expect(asked.some((url) => url.includes('/dem/gedtm30/'))).toBe(true);
    expect(asked.some((url) => /\/dem\/\d+\/\d+\/\d+\.png$/.test(url))).toBe(true);
  });

  it('reports every source that failed rather than a bare error', async () => {
    stubDecode();
    loadBytesCacheFirst.mockReset();
    loadBytesCacheFirst.mockRejectedValue(new Error('shell capability denied'));

    await expect(generateTerrain(BOLZANO, { region: 'south-tyrol', gridN: 4 })).rejects.toThrow(
      /No elevation source produced terrain/,
    );
  });

  it('uses Terrarium alone outside every national coverage', async () => {
    stubDecode();
    loadBytesCacheFirst.mockReset();
    loadBytesCacheFirst.mockResolvedValue(new Blob([new Uint8Array(64)]));

    const madeira: BBox4326 = [-16.95, 32.63, -16.9, 32.67];
    // Outside every national footprint the chain is the global tail alone, and
    // its head is bare earth. "No national source here" is not a failure state.
    expect(selectElevationSources('europe', madeira).map((s) => s.id)).toEqual([
      'gedtm30',
      'mapzen-terrarium',
    ]);
    // Mapterhorn is opt-in: it carries no DTM/DSM classification, so selection
    // must never reach for it on its own.
    expect(selectElevationSources('europe', madeira).map((s) => s.id)).not.toContain('mapterhorn');

    await generateTerrain(madeira, { region: 'europe', gridN: 4 });
    for (const [cacheUrl] of loadBytesCacheFirst.mock.calls) {
      expect(cacheUrl).toMatch(/\/dem\/(gedtm30\/)?\d+\/\d+\/\d+\.png$/);
    }
  });

  it('honours an explicitly pinned source chain', async () => {
    stubDecode();
    loadBytesCacheFirst.mockReset();
    loadBytesCacheFirst.mockResolvedValue(new Blob([new Uint8Array(64)]));

    await generateTerrain(BOLZANO, { sources: [SOUTH_TYROL_DTM_05M], gridN: 4 });
    for (const [cacheUrl] of loadBytesCacheFirst.mock.calls) {
      expect(cacheUrl).toContain('/dem/it-bz-dtm-05m/');
    }
  });
});
