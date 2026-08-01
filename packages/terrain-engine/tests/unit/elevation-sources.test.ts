import { describe, expect, it } from 'vitest';
import {
  AUSTRIA_DTM_1M,
  ELEVATION_SOURCES,
  ElevationSourceError,
  NETHERLANDS_DTM_05M,
  REGION_ELEVATION_SOURCES,
  SOUTH_TYROL_DTM_05M,
  SWITZERLAND_DTM_05M,
  TERRARIUM,
  chooseElevationSource,
  defineElevationSource,
  elevationProvenance,
  elevationTileUrl,
  getElevationSource,
  isApprovedElevationUrl,
  nativeZoom,
  selectElevationSources,
} from '../../src/terrain/elevation-sources';
import { DEM_SOURCE, chooseDemZoom, demTilesForBBox } from '../../src/terrain/dem';
import type { BBox4326 } from '../../src/bbox/validate';

const BOLZANO: BBox4326 = [11.34, 46.49, 11.35, 46.5];
const VIENNA: BBox4326 = [16.36, 48.2, 16.37, 48.21];
const MADEIRA: BBox4326 = [-16.95, 32.63, -16.9, 32.67];
const COLLECTION = 'http://127.0.0.1:8787';

describe('registry integrity', () => {
  it('gives every source a licence and an attribution', () => {
    for (const source of Object.values(ELEVATION_SOURCES)) {
      expect(source.license.trim(), source.id).not.toBe('');
      expect(source.attribution.trim(), source.id).not.toBe('');
    }
  });

  it('refuses a source declared without a licence', () => {
    const attempt = () =>
      defineElevationSource({
        ...SOUTH_TYROL_DTM_05M,
        id: 'unlicensed',
        license: '   ',
      });
    expect(attempt).toThrow(ElevationSourceError);
    expect(attempt).toThrow(/LICENCE_MISSING/);
  });

  it('refuses a source declared without an attribution', () => {
    expect(() =>
      defineElevationSource({ ...AUSTRIA_DTM_1M, id: 'unattributed', attribution: '' }),
    ).toThrow(/ATTRIBUTION_MISSING/);
  });

  it('refuses a transcoded source that claims its own origin', () => {
    expect(() =>
      defineElevationSource({
        ...AUSTRIA_DTM_1M,
        id: 'confused',
        origin: { scheme: 'https', host: 'example.test', port: 443 },
      }),
    ).toThrow(/SOURCE_MALFORMED/);
  });

  it('refuses a path template that cannot address a tile', () => {
    expect(() =>
      defineElevationSource({ ...AUSTRIA_DTM_1M, id: 'flat', pathTemplate: '/dem/{z}/{x}.png' }),
    ).toThrow(/SOURCE_MALFORMED/);
  });

  it('keys every entry by its own id', () => {
    for (const [id, source] of Object.entries(ELEVATION_SOURCES)) {
      expect(source.id).toBe(id);
    }
  });

  it('names only known ids in the region chains', () => {
    for (const ids of Object.values(REGION_ELEVATION_SOURCES)) {
      for (const id of ids) expect(() => getElevationSource(id)).not.toThrow();
    }
  });

  it('raises a named error for an unknown id', () => {
    expect(() => getElevationSource('nope')).toThrow(/UNKNOWN_SOURCE/);
  });

  it('shares one endpoint contract with DEM_SOURCE for Terrarium', () => {
    expect(TERRARIUM.pathTemplate).toBe(DEM_SOURCE.pathTemplate);
    expect(TERRARIUM.maxZoom).toBe(DEM_SOURCE.maxZoom);
    expect(TERRARIUM.origin).toEqual({
      scheme: DEM_SOURCE.scheme,
      host: DEM_SOURCE.host,
      port: DEM_SOURCE.port,
    });
  });

  it('caps every source at the first zoom that carries its native posting', () => {
    for (const source of Object.values(ELEVATION_SOURCES)) {
      if (source.coverage === null) continue;
      const midLat = (source.coverage.south + source.coverage.north) / 2;
      const native = nativeZoom(source.nativeResolutionM, midLat);
      // Never below native (that would throw data away) and never more than
      // one level above it (that would only inflate the tile count).
      expect(source.maxZoom, source.id).toBeGreaterThanOrEqual(Math.floor(native));
      expect(source.maxZoom, source.id).toBeLessThanOrEqual(Math.ceil(native) + 1);
    }
  });
});

describe('source selection per region', () => {
  it('puts the 0.5 m CC0 DTM first over South Tyrol', () => {
    const chain = selectElevationSources('south-tyrol', BOLZANO);
    expect(chain.map((source) => source.id)).toEqual([
      'it-bz-dtm-05m',
      'it-bz-dtm-25m',
      'mapzen-terrarium',
    ]);
    expect(chain[0].model).toBe('dtm');
    expect(chain[0].license).toBe('CC0-1.0');
  });

  it('picks the Austrian 1 m DTM over Vienna', () => {
    expect(chooseElevationSource('vienna', VIENNA).id).toBe('at-bev-dtm-1m');
  });

  it('resolves the continental region by coverage, not by name', () => {
    expect(chooseElevationSource('europe', BOLZANO).id).toBe('it-bz-dtm-05m');
    expect(chooseElevationSource('europe', VIENNA).id).toBe('at-bev-dtm-1m');
    expect(chooseElevationSource('europe', [8.54, 47.36, 8.55, 47.38]).id).toBe('ch-swissalti3d');
    expect(chooseElevationSource('europe', [4.89, 52.36, 4.9, 52.38]).id).toBe('nl-ahn-dtm-05m');
  });

  it('never leaves a national source in the chain outside its coverage', () => {
    for (const source of selectElevationSources('europe', MADEIRA)) {
      expect(source.coverage).toBeNull();
    }
  });
});

describe('fallback to Terrarium', () => {
  it('falls back outside every national coverage', () => {
    expect(chooseElevationSource('europe', MADEIRA).id).toBe('mapzen-terrarium');
    expect(chooseElevationSource('madeira', MADEIRA).id).toBe('mapzen-terrarium');
  });

  it('falls back for an unknown or missing region', () => {
    expect(chooseElevationSource('atlantis').id).toBe('mapzen-terrarium');
    expect(chooseElevationSource(undefined).id).toBe('mapzen-terrarium');
    expect(chooseElevationSource(null).id).toBe('mapzen-terrarium');
  });

  it('ends every chain in Terrarium exactly once', () => {
    for (const regionId of [...Object.keys(REGION_ELEVATION_SOURCES), 'madeira', 'africa']) {
      const chain = selectElevationSources(regionId, BOLZANO);
      expect(chain.at(-1)?.id, regionId).toBe('mapzen-terrarium');
      expect(chain.filter((source) => source.id === 'mapzen-terrarium')).toHaveLength(1);
    }
  });

  it('keeps a national source ahead of the fallback even at equal coverage', () => {
    const chain = selectElevationSources('south-tyrol', BOLZANO);
    expect(chain.indexOf(SOUTH_TYROL_DTM_05M)).toBeLessThan(chain.indexOf(TERRARIUM));
  });
});

describe('tile URLs and the fail-closed allowlist', () => {
  it('builds a direct URL for Terrarium and approves only that origin', () => {
    const url = elevationTileUrl(TERRARIUM, 12, 1855, 1653);
    expect(url).toBe('https://s3.amazonaws.com/elevation-tiles-prod/terrarium/12/1855/1653.png');
    expect(isApprovedElevationUrl(url, TERRARIUM)).toBe(true);
    expect(
      isApprovedElevationUrl(
        'https://evil.example/elevation-tiles-prod/terrarium/12/1855/1653.png',
        TERRARIUM,
      ),
    ).toBe(false);
  });

  it('builds a transcoded URL under the collection origin', () => {
    const url = elevationTileUrl(SOUTH_TYROL_DTM_05M, 17, 70123, 47901, COLLECTION);
    expect(url).toBe('http://127.0.0.1:8787/dem/it-bz-dtm-05m/17/70123/47901.png');
    expect(isApprovedElevationUrl(url, SOUTH_TYROL_DTM_05M, COLLECTION)).toBe(true);
  });

  it('refuses a transcoded URL with no collection origin rather than inventing one', () => {
    expect(() => elevationTileUrl(SOUTH_TYROL_DTM_05M, 17, 1, 1)).toThrow(
      /TRANSCODE_ORIGIN_REQUIRED/,
    );
    expect(isApprovedElevationUrl('http://127.0.0.1:8787/dem/it-bz-dtm-05m/17/1/1.png', SOUTH_TYROL_DTM_05M)).toBe(
      false,
    );
  });

  it('does not let one transcoded source approve another source’s path', () => {
    const swiss = elevationTileUrl(SWITZERLAND_DTM_05M, 17, 1, 1, COLLECTION);
    expect(isApprovedElevationUrl(swiss, SWITZERLAND_DTM_05M, COLLECTION)).toBe(true);
    expect(isApprovedElevationUrl(swiss, NETHERLANDS_DTM_05M, COLLECTION)).toBe(false);
  });

  it('refuses query strings, fragments and credentials', () => {
    const base = 'http://127.0.0.1:8787/dem/it-bz-dtm-05m/17/1/1.png';
    for (const candidate of [`${base}?a=1`, `${base}#x`, 'http://u:p@127.0.0.1:8787/dem/it-bz-dtm-05m/17/1/1.png', 'not-a-url']) {
      expect(isApprovedElevationUrl(candidate, SOUTH_TYROL_DTM_05M, COLLECTION)).toBe(false);
    }
  });

  it('refuses a zoom the source does not carry', () => {
    expect(() =>
      elevationTileUrl(SOUTH_TYROL_DTM_05M, SOUTH_TYROL_DTM_05M.maxZoom + 1, 1, 1, COLLECTION),
    ).toThrow(RangeError);
  });
});

describe('the tile maths honours the source, not Terrarium', () => {
  it('reaches a national zoom that Terrarium’s cap forbids', () => {
    const terrarium = chooseDemZoom(BOLZANO, 192, TERRARIUM);
    const national = chooseDemZoom(BOLZANO, 192, SOUTH_TYROL_DTM_05M);
    expect(terrarium).toBe(13);
    expect(national).toBeGreaterThan(terrarium);
    expect(national).toBeLessThanOrEqual(SOUTH_TYROL_DTM_05M.maxZoom);
  });

  it('keeps the default behaviour byte-for-byte when no source is passed', () => {
    expect(chooseDemZoom(BOLZANO, 192)).toBe(chooseDemZoom(BOLZANO, 192, DEM_SOURCE));
    expect(demTilesForBBox(BOLZANO, 12).tiles).toEqual(demTilesForBBox(BOLZANO, 12, DEM_SOURCE).tiles);
  });

  it('still respects the tile budget on a national source', () => {
    const zoom = chooseDemZoom(BOLZANO, 192, SOUTH_TYROL_DTM_05M);
    const { tiles } = demTilesForBBox(BOLZANO, zoom, SOUTH_TYROL_DTM_05M);
    expect(tiles.length).toBeLessThanOrEqual(16);
    expect(tiles.length).toBeGreaterThan(0);
  });
});

describe('provenance', () => {
  it('carries every licence in the chain, in use order', () => {
    const rows = elevationProvenance(selectElevationSources('south-tyrol', BOLZANO));
    expect(rows.map((row) => row.license)).toEqual([
      'CC0-1.0',
      'CC0-1.0',
      TERRARIUM.license,
    ]);
    expect(rows[0].model).toBe('dtm');
    expect(rows.at(-1)?.model).toBe('mixed');
  });
});
