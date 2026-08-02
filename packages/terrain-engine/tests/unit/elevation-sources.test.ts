import { describe, expect, it } from 'vitest';
import {
  AUSTRIA_DTM_1M,
  ELEVATION_SOURCES,
  ElevationSourceError,
  GEDTM30,
  MAPTERHORN,
  NETHERLANDS_DTM_05M,
  REGION_ELEVATION_SOURCES,
  SOUTH_TYROL_DTM_05M,
  SWITZERLAND_DTM_05M,
  TERRARIUM,
  bareEarthReference,
  chooseElevationSource,
  defineElevationSource,
  elevationCredit,
  elevationCreditLine,
  elevationEndpoint,
  elevationProvenance,
  elevationTileUrl,
  getElevationSource,
  groundResolutionM,
  isApprovedElevationUrl,
  isBareEarthReference,
  nativeZoom,
  postingSigmaM,
  requireBareEarthReference,
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
      const native = nativeZoom(source.nativeResolutionM, midLat, source.tileSize);
      // Never below native (that would throw data away) and never more than
      // one level above it (that would only inflate the tile count).
      expect(source.maxZoom, source.id).toBeGreaterThanOrEqual(Math.floor(native));
      expect(source.maxZoom, source.id).toBeLessThanOrEqual(Math.ceil(native) + 1);
    }
  });

  it('caps the two 30 m global sources at the same zoom, from the same derivation', () => {
    // nativeZoom(30, 0) = 12.35 — the equator is the worst case, so 13.
    expect(Math.ceil(nativeZoom(30, 0))).toBe(13);
    expect(GEDTM30.maxZoom).toBe(13);
    expect(TERRARIUM.maxZoom).toBe(13);
  });
});

describe('vertical uncertainty is mandatory', () => {
  it('gives every source a positive 1σ and the basis of that number', () => {
    for (const source of Object.values(ELEVATION_SOURCES)) {
      expect(source.verticalUncertaintyM, source.id).toBeGreaterThan(0);
      expect(Number.isFinite(source.verticalUncertaintyM), source.id).toBe(true);
      expect(source.verticalUncertaintyBasis, source.id).toBeTruthy();
    }
  });

  it('refuses a source that declares no σ', () => {
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() =>
        defineElevationSource({ ...AUSTRIA_DTM_1M, id: 'sigmaless', verticalUncertaintyM: bad }),
      ).toThrow(/VERTICAL_UNCERTAINTY_UNDECLARED/);
    }
  });

  it('pins the seed values the refusal rule is calibrated on', () => {
    // MESH-CALCULATOR §4.3 turns these straight into "answerable at range X".
    expect(TERRARIUM.verticalUncertaintyM).toBe(14.31);
    expect(TERRARIUM.verticalUncertaintyBasis).toBe('measured');
    expect(GEDTM30.verticalUncertaintyM).toBe(10.69);
    expect(GEDTM30.verticalUncertaintyBasis).toBe('published');
  });

  it('never lets Mapterhorn look more certain than the surface it might be', () => {
    // No per-tile provenance means it can be the Copernicus DSM anywhere, so
    // it inherits the worst measured case rather than a flattering number.
    expect(MAPTERHORN.verticalUncertaintyM).toBe(TERRARIUM.verticalUncertaintyM);
    expect(MAPTERHORN.verticalUncertaintyBasis).toBe('inherited-worst-case');
    for (const source of Object.values(ELEVATION_SOURCES)) {
      expect(MAPTERHORN.verticalUncertaintyM, source.id).toBeGreaterThanOrEqual(
        source.verticalUncertaintyM,
      );
    }
  });

  it('labels an assumed σ as assumed, and derives it from one stated rule', () => {
    for (const source of Object.values(ELEVATION_SOURCES)) {
      if (source.verticalUncertaintyBasis !== 'assumed-from-posting') continue;
      expect(source.verticalUncertaintyM, source.id).toBe(postingSigmaM(source.nativeResolutionM));
    }
    expect(postingSigmaM(0.5)).toBe(0.5);
    expect(postingSigmaM(0.1)).toBe(0.3);
  });
});

describe('the composite-licence audit', () => {
  it('refuses a licence field that names no actual terms', () => {
    for (const license of ['various', 'Various open sources', 'see website', 'TBD', 'unknown']) {
      expect(() =>
        defineElevationSource({ ...AUSTRIA_DTM_1M, id: 'handwave', license }),
      ).toThrow(/COMPOSITE_LICENCE_UNRESOLVED/);
    }
  });

  it('accounts for every dataset it redistributes', () => {
    expect(MAPTERHORN.composite).not.toBeNull();
    const composite = MAPTERHORN.composite!;
    const counted = composite.families.reduce((total, row) => total + row.count, 0);
    expect(counted).toBe(composite.sourceCount);
    expect(composite.sourceCount).toBe(134);
    expect(composite.distinctTerms).toBe(28);
    expect(composite.obligation).toBe('attribution');
    expect(composite.manifestSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(composite.snapshot).toBe('2026-08-02');
  });

  it('refuses a census that does not add up', () => {
    expect(() =>
      defineElevationSource({
        ...MAPTERHORN,
        id: 'miscounted',
        composite: { ...MAPTERHORN.composite!, sourceCount: 200 },
      }),
    ).toThrow(/COMPOSITE_LICENCE_UNRESOLVED/);
  });

  it('refuses a composite that does not pin the bytes it audited', () => {
    expect(() =>
      defineElevationSource({
        ...MAPTERHORN,
        id: 'unpinned',
        composite: { ...MAPTERHORN.composite!, manifestSha256: 'nope' },
      }),
    ).toThrow(/COMPOSITE_LICENCE_UNRESOLVED/);
  });

  it('refuses a composite whose credit line does not lead to the per-dataset credits', () => {
    expect(() =>
      defineElevationSource({
        ...MAPTERHORN,
        id: 'dead-end',
        attribution: 'Elevation: © Mapterhorn',
      }),
    ).toThrow(/COMPOSITE_LICENCE_UNRESOLVED/);
  });

  it('records how much of the audit was name-only rather than glossing it', () => {
    expect(MAPTERHORN.composite!.termsReadByNameOnly).toBeGreaterThan(0);
    expect(MAPTERHORN.composite!.termsReadByNameOnly).toBeLessThanOrEqual(
      MAPTERHORN.composite!.sourceCount,
    );
  });
});

describe('source selection per region', () => {
  it('puts the 0.5 m CC0 DTM first over South Tyrol', () => {
    const chain = selectElevationSources('south-tyrol', BOLZANO);
    expect(chain.map((source) => source.id)).toEqual([
      'it-bz-dtm-05m',
      'it-bz-dtm-25m',
      'gedtm30',
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

  it('never hands out Mapterhorn, whatever the region or bbox', () => {
    const regions = [...Object.keys(REGION_ELEVATION_SOURCES), 'madeira', 'atlantis', undefined];
    for (const regionId of regions) {
      for (const bbox of [BOLZANO, VIENNA, MADEIRA, undefined]) {
        for (const source of selectElevationSources(regionId, bbox)) {
          expect(source.id, `${regionId ?? '(none)'}`).not.toBe('mapterhorn');
        }
      }
    }
    for (const ids of Object.values(REGION_ELEVATION_SOURCES)) {
      expect(ids).not.toContain('mapterhorn');
    }
    // Still reachable by name — opt-in, not absent.
    expect(getElevationSource('mapterhorn')).toBe(MAPTERHORN);
  });
});

describe('the global tail', () => {
  it('lands on the bare-earth global base outside every national coverage', () => {
    expect(chooseElevationSource('europe', MADEIRA).id).toBe('gedtm30');
    expect(chooseElevationSource('madeira', MADEIRA).id).toBe('gedtm30');
    expect(chooseElevationSource('europe', MADEIRA).model).toBe('dtm');
  });

  it('lands on the bare-earth global base for an unknown or missing region', () => {
    expect(chooseElevationSource('atlantis').id).toBe('gedtm30');
    expect(chooseElevationSource(undefined).id).toBe('gedtm30');
    expect(chooseElevationSource(null).id).toBe('gedtm30');
  });

  it('ends every chain in GEDTM30 then Terrarium, each exactly once', () => {
    for (const regionId of [...Object.keys(REGION_ELEVATION_SOURCES), 'madeira', 'africa']) {
      const chain = selectElevationSources(regionId, BOLZANO).map((source) => source.id);
      expect(chain.slice(-2), regionId).toEqual(['gedtm30', 'mapzen-terrarium']);
      expect(chain.filter((id) => id === 'gedtm30')).toHaveLength(1);
      expect(chain.filter((id) => id === 'mapzen-terrarium')).toHaveLength(1);
    }
  });

  it('keeps Terrarium last because it is the only direct global source', () => {
    // Demoted, not retired: with no collection server GEDTM30 cannot answer
    // and this can, so removing it would trade 14 m of error for no terrain.
    expect(TERRARIUM.delivery).toBe('direct');
    expect(GEDTM30.delivery).toBe('transcoded');
    expect(GEDTM30.verticalUncertaintyM).toBeLessThan(TERRARIUM.verticalUncertaintyM);
  });

  it('keeps a national source ahead of the tail even at equal coverage', () => {
    const chain = selectElevationSources('south-tyrol', BOLZANO);
    expect(chain.indexOf(SOUTH_TYROL_DTM_05M)).toBeLessThan(chain.indexOf(GEDTM30));
    expect(chain.indexOf(GEDTM30)).toBeLessThan(chain.indexOf(TERRARIUM));
  });
});

describe('the bare-earth guard', () => {
  it('admits only DTMs', () => {
    expect(isBareEarthReference(GEDTM30)).toBe(true);
    expect(isBareEarthReference(SOUTH_TYROL_DTM_05M)).toBe(true);
    expect(isBareEarthReference(TERRARIUM)).toBe(false);
    expect(isBareEarthReference(MAPTERHORN)).toBe(false);
  });

  it('refuses Mapterhorn as a bare-earth reference with a named error', () => {
    // The whole point of the §2.2 ruling: its metadata cannot say whether a
    // tile is bare earth, and its global filler is an undeclared DSM.
    expect(MAPTERHORN.model).toBe('mixed');
    expect(() => requireBareEarthReference(MAPTERHORN)).toThrow(ElevationSourceError);
    expect(() => requireBareEarthReference(MAPTERHORN)).toThrow(/NOT_BARE_EARTH/);
    expect(() => requireBareEarthReference(TERRARIUM)).toThrow(/NOT_BARE_EARTH/);
    expect(requireBareEarthReference(GEDTM30)).toBe(GEDTM30);
  });

  it('finds a bare-earth reference in every chain, and it is never Mapterhorn', () => {
    for (const regionId of [...Object.keys(REGION_ELEVATION_SOURCES), 'madeira', 'africa']) {
      const reference = bareEarthReference(selectElevationSources(regionId, BOLZANO));
      expect(reference, regionId).not.toBeNull();
      expect(reference?.model, regionId).toBe('dtm');
      expect(reference?.id, regionId).not.toBe('mapterhorn');
    }
    // Before GEDTM30 there was no bare-earth answer outside national coverage.
    expect(bareEarthReference(selectElevationSources('madeira', MADEIRA))?.id).toBe('gedtm30');
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

describe('the 512-pixel lossless-WebP path', () => {
  it('declares the contract that was probed live', () => {
    expect(MAPTERHORN.tileSize).toBe(512);
    expect(MAPTERHORN.format).toBe('image/webp');
    expect(MAPTERHORN.encoding).toBe('terrarium');
    expect(MAPTERHORN.delivery).toBe('direct');
    expect(MAPTERHORN.origin).toEqual({ scheme: 'https', host: 'tiles.mapterhorn.com', port: 443 });
  });

  it('builds and allowlists a .webp URL, and refuses the .png shape', () => {
    const url = elevationTileUrl(MAPTERHORN, 12, 2234, 1420);
    expect(url).toBe('https://tiles.mapterhorn.com/12/2234/1420.webp');
    expect(isApprovedElevationUrl(url, MAPTERHORN)).toBe(true);
    expect(isApprovedElevationUrl('https://tiles.mapterhorn.com/12/2234/1420.png', MAPTERHORN)).toBe(
      false,
    );
    expect(isApprovedElevationUrl('https://evil.example/12/2234/1420.webp', MAPTERHORN)).toBe(false);
    expect(isApprovedElevationUrl(url, TERRARIUM)).toBe(false);
  });

  it('turns 512 pixels into one zoom less, not into twice the tiles', () => {
    // A 512² tile at z has exactly the ground sampling of a 256² tile at z+1,
    // and chooseDemZoom reads tileSize rather than assuming 256.
    const wide: BBox4326 = [11.3, 46.4, 11.4, 46.5];
    const at512 = chooseDemZoom(wide, 192, { ...MAPTERHORN, maxZoom: 22, minZoom: 0 });
    const at256 = chooseDemZoom(wide, 192, { ...MAPTERHORN, tileSize: 256, maxZoom: 22, minZoom: 0 });
    expect(at256 - at512).toBe(1);
    expect(groundResolutionM(12, 48.2, 512)).toBeCloseTo(groundResolutionM(13, 48.2, 256), 6);
  });

  it('reports the resolution win honestly: it lives entirely in the sparse tail', () => {
    // Mapterhorn's reliable z12 is Terrarium's z13 to six decimals — the whole
    // upgrade is z13..z18, which is why it is opt-in rather than the base.
    expect(groundResolutionM(MAPTERHORN.denseMaxZoom!, 48.2, 512)).toBeCloseTo(
      groundResolutionM(TERRARIUM.maxZoom, 48.2, 256),
      6,
    );
    expect(groundResolutionM(16, 48.2, 512)).toBeLessThan(1);
  });
});

describe('the sparse zoom ceiling', () => {
  it('clamps to what the publisher answers everywhere, by default', () => {
    expect(MAPTERHORN.maxZoom).toBe(18);
    expect(MAPTERHORN.denseMaxZoom).toBe(12);
    expect(elevationEndpoint(MAPTERHORN).maxZoom).toBe(12);
    expect(elevationEndpoint(MAPTERHORN, { allowSparse: true }).maxZoom).toBe(18);
    expect(elevationEndpoint(MAPTERHORN, { allowSparse: true })).toBe(MAPTERHORN);
  });

  it('never asks the default endpoint for a zoom the pyramid may not hold', () => {
    const endpoint = elevationEndpoint(MAPTERHORN);
    for (const bbox of [BOLZANO, VIENNA, MADEIRA]) {
      expect(chooseDemZoom(bbox, 192, endpoint)).toBeLessThanOrEqual(12);
    }
    expect(() => elevationTileUrl(endpoint, 13, 1, 1)).toThrow(RangeError);
    expect(elevationTileUrl(MAPTERHORN, 13, 1, 1)).toContain('/13/1/1.webp');
  });

  it('leaves every dense source untouched', () => {
    for (const source of Object.values(ELEVATION_SOURCES)) {
      if (source.id === 'mapterhorn') continue;
      expect(source.denseMaxZoom, source.id).toBeNull();
      expect(elevationEndpoint(source), source.id).toBe(source);
    }
  });

  it('refuses a denseMaxZoom outside the source’s own range', () => {
    expect(() =>
      defineElevationSource({ ...MAPTERHORN, id: 'overreach', denseMaxZoom: 19 }),
    ).toThrow(/SOURCE_MALFORMED/);
    expect(() =>
      defineElevationSource({ ...MAPTERHORN, id: 'underreach', denseMaxZoom: 2 }),
    ).toThrow(/SOURCE_MALFORMED/);
  });
});

describe('GEDTM30 is declared against a documented interface, not an invented URL', () => {
  it('is the transcoded global bare-earth base', () => {
    expect(GEDTM30.model).toBe('dtm');
    expect(GEDTM30.license).toBe('CC-BY-4.0');
    expect(GEDTM30.coverage).toBeNull();
    expect(GEDTM30.delivery).toBe('transcoded');
    expect(GEDTM30.origin).toBeNull();
    expect(GEDTM30.upstream.kind).toBe('bulk-cog');
    expect(GEDTM30.verticalDatum).toContain('EGM2008');
  });

  it('addresses the project’s own /dem/{source_id} route, the way the national DTMs do', () => {
    const url = elevationTileUrl(GEDTM30, 13, 4468, 2840, COLLECTION);
    expect(url).toBe('http://127.0.0.1:8787/dem/gedtm30/13/4468/2840.png');
    expect(isApprovedElevationUrl(url, GEDTM30, COLLECTION)).toBe(true);
    expect(isApprovedElevationUrl(url, SOUTH_TYROL_DTM_05M, COLLECTION)).toBe(false);
  });

  it('refuses to name a URL when nothing can serve it', () => {
    // The route is not implemented; asking for a URL without the collection
    // origin is a named failure rather than a link to nowhere.
    expect(() => elevationTileUrl(GEDTM30, 13, 1, 1)).toThrow(/TRANSCODE_ORIGIN_REQUIRED/);
    expect(GEDTM30.notes).toContain('AWAITING THE SERVER-SIDE PATH');
  });
});

describe('provenance', () => {
  it('carries every licence in the chain, in use order', () => {
    const rows = elevationProvenance(selectElevationSources('south-tyrol', BOLZANO));
    expect(rows.map((row) => row.license)).toEqual([
      'CC0-1.0',
      'CC0-1.0',
      'CC-BY-4.0',
      TERRARIUM.license,
    ]);
    expect(rows[0].model).toBe('dtm');
    expect(rows.at(-1)?.model).toBe('mixed');
  });

  it('hands the UI a printable credit for every row, in one call', () => {
    // The defect this closes: the app hardcoded a Mapzen credit, so a CC-BY
    // source rendered under someone else's name.
    for (const row of elevationProvenance(Object.values(ELEVATION_SOURCES))) {
      expect(row.credit.trim(), row.id).not.toBe('');
      expect(row.credit, row.id).toContain(row.attribution);
      expect(row.verticalUncertaintyM, row.id).toBeGreaterThan(0);
    }
  });

  it('credits a CC-BY source under its own name and terms', () => {
    expect(elevationCredit(GEDTM30)).toBe(`${GEDTM30.attribution} — CC-BY-4.0`);
    expect(elevationCredit(GEDTM30)).toContain('OpenGeoHub');
    expect(elevationCredit(GEDTM30)).not.toContain('Mapzen');
    expect(elevationCredit(AUSTRIA_DTM_1M)).toContain('CC-BY-4.0');
    expect(elevationCredit(AUSTRIA_DTM_1M)).toContain('BEV');
  });

  it('gives the composite source a credit that discharges its obligation on its own', () => {
    const credit = elevationCredit(MAPTERHORN);
    expect(credit).toContain('Mapterhorn');
    expect(credit).toContain('134');
    expect(credit).toContain('CC BY 4.0');
    expect(credit).toContain('Licence Ouverte 2.0');
    // A URI to the per-dataset list is what CC BY 4.0 §3(a)(2) blesses, and it
    // prints identically offline — no runtime fetch anywhere in this path.
    expect(credit).toContain('mapterhorn.com/attribution');
    expect(credit).not.toMatch(/\bvarious\b/i);
    // The audit summary belongs in `composite`, not under a rendered tile.
    expect(credit).not.toContain(MAPTERHORN.license);
  });

  it('joins a chain into one deduplicated line', () => {
    const line = elevationCreditLine(selectElevationSources('south-tyrol', BOLZANO));
    // Both South Tyrol products share one credit; it appears once.
    expect(line.split(' · ')).toHaveLength(3);
    expect(line).toContain('Bozen');
    expect(line).toContain('OpenGeoHub');
    expect(line).toContain('Mapzen');
  });
});
