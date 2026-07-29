import { describe, expect, it } from 'vitest';

import {
  COLLECTION_SERVICE,
  cachedDemTileUrl,
  cachedOsmUrl,
  isApprovedCachedDemUrl,
  isApprovedCachedOsmUrl,
} from '../../src/job/collection';

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
