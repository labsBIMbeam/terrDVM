import { describe, expect, it } from 'vitest';
import { buildCollection, buildItem } from '@terrcvm/geo-protocol';
import {
  coverageForTile,
  parseCollectionEvent,
  parseItemEvent,
  queryCells,
  selectForTile,
  tileCovers,
  type CorpusItem,
} from '../../src/corpus/select';

const PUBKEY = 'a'.repeat(64);
const SHA_DEM = '87719b68d24463b569fbee9a14282dae2f7763c19412b09c09ccfbbf894d29bc';
const SHA_FEATURES = 'b'.repeat(64);

/** The slice's tiles: features at z14, DEM at the z13 parent covering it. */
const FUNCHAL = { z: 14, x: 7422, y: 6618 };
const NEIGHBOUR = { z: 14, x: 7423, y: 6618 };
const DEM_PARENT = { z: 13, x: 3711, y: 3309 };

function signedShape(unsigned: ReturnType<typeof buildItem>, pubkey = PUBKEY) {
  return { ...unsigned, id: 'c'.repeat(64), pubkey, sig: 'd'.repeat(128) };
}

function demItem(tile = DEM_PARENT, createdAt = 1_754_000_000) {
  return signedShape(
    buildItem({
      dataset: 'dem',
      tile,
      pubkey: PUBKEY,
      sha256: SHA_DEM,
      url: `http://127.0.0.1:3000/${SHA_DEM}`,
      mimeType: 'image/png',
      size: 43_014,
      datetime: '2026-08-02T12:00:00Z',
      createdAt,
    }),
  );
}

function featuresItem(tile = FUNCHAL, createdAt = 1_754_000_000) {
  return signedShape(
    buildItem({
      dataset: 'features',
      tile,
      pubkey: PUBKEY,
      sha256: SHA_FEATURES,
      url: `http://127.0.0.1:3000/${SHA_FEATURES}`,
      mimeType: 'application/vnd.terrcvm.tft',
      size: 139_699,
      datetime: '2026-08-02T12:00:00Z',
      createdAt,
    }),
  );
}

function demCollection() {
  return signedShape(
    buildCollection({
      dataset: 'dem',
      title: 'Madeira elevation',
      bbox: [-17.32, 32.35, -16.24, 33.15],
      mimeType: 'image/png',
      license: 'CC-BY-4.0',
      source: 'Mapzen Terrarium via AWS Open Data',
      server: 'http://127.0.0.1:3000',
      createdAt: 1_754_000_000,
    }) as ReturnType<typeof buildItem>,
  );
}

describe('tileCovers', () => {
  it('accepts a tile as covering itself', () => {
    expect(tileCovers(FUNCHAL, FUNCHAL)).toBe(true);
  });

  it('accepts a coarser ancestor — the whole reason DEM may sit at z13', () => {
    expect(tileCovers(DEM_PARENT, FUNCHAL)).toBe(true);
    expect(tileCovers(DEM_PARENT, NEIGHBOUR)).toBe(true);
    expect(tileCovers({ z: 12, x: 1855, y: 1654 }, FUNCHAL)).toBe(true);
  });

  it('rejects a finer tile as a cover for a coarser one', () => {
    expect(tileCovers(FUNCHAL, DEM_PARENT)).toBe(false);
  });

  it('rejects a same-zoom neighbour and an unrelated ancestor', () => {
    expect(tileCovers(NEIGHBOUR, FUNCHAL)).toBe(false);
    expect(tileCovers({ z: 13, x: 3712, y: 3309 }, FUNCHAL)).toBe(false);
  });
});

describe('queryCells', () => {
  it('includes the wanted tile cell and every ancestor cell, deduped', () => {
    const cells = queryCells(FUNCHAL);
    expect(cells).toContain('etgc');
    expect(new Set(cells).size).toBe(cells.length);
  });

  it('is non-empty for every zoom it is asked about', () => {
    for (const z of [1, 8, 13, 14, 18]) {
      expect(queryCells({ z, x: 0, y: 0 }).length).toBeGreaterThan(0);
    }
  });
});

describe('parseItemEvent', () => {
  it('reads the tile, hash, url and bbox off a real built item', () => {
    const item = parseItemEvent(demItem());
    expect(item).not.toBeNull();
    expect(item?.dataset).toBe('dem');
    expect(item?.tile).toEqual(DEM_PARENT);
    expect(item?.sha256).toBe(SHA_DEM);
    expect(item?.size).toBe(43_014);
    expect(item?.bbox).toHaveLength(4);
  });

  it('refuses events that are not items, or whose d is malformed', () => {
    expect(parseItemEvent({ ...demItem(), kind: 30550 })).toBeNull();
    const broken = demItem();
    broken.tags = broken.tags.map((tag) => (tag[0] === 'd' ? ['d', 'dem:not/a/tile'] : tag));
    expect(parseItemEvent(broken)).toBeNull();
  });

  it('refuses an item with no hash — an unverifiable blob is not a blob', () => {
    const noHash = demItem();
    noHash.tags = noHash.tags.filter((tag) => tag[0] !== 'x');
    expect(parseItemEvent(noHash)).toBeNull();
  });

  it('refuses content that is not the canonical JSON object', () => {
    expect(parseItemEvent({ ...demItem(), content: 'not json' })).toBeNull();
  });
});

describe('parseCollectionEvent', () => {
  it('reads the server, licence and extent the client must not hardcode', () => {
    const collection = parseCollectionEvent(demCollection());
    expect(collection?.dataset).toBe('dem');
    expect(collection?.server).toBe('http://127.0.0.1:3000');
    expect(collection?.license).toBe('CC-BY-4.0');
    expect(collection?.source).toContain('Terrarium');
    expect(collection?.bbox).toEqual([-17.32, 32.35, -16.24, 33.15]);
  });

  it('refuses a collection with no server — there would be nowhere to fetch', () => {
    const noServer = demCollection();
    noServer.tags = noServer.tags.filter((tag) => tag[0] !== 'server');
    expect(parseCollectionEvent(noServer)).toBeNull();
  });
});

describe('selectForTile', () => {
  const items = (): CorpusItem[] =>
    [demItem(), featuresItem()].map(parseItemEvent).filter((i): i is CorpusItem => i !== null);

  it('matches the exact features tile and the covering DEM tile', () => {
    const selected = selectForTile(items(), FUNCHAL);
    expect([...selected.keys()].sort()).toEqual(['dem', 'features']);
    expect(selected.get('dem')?.tile).toEqual(DEM_PARENT);
    expect(selected.get('features')?.tile).toEqual(FUNCHAL);
  });

  it('drops the features tile for the neighbour while DEM still covers it', () => {
    // This is the negative case as it ACTUALLY stands after the DEM moved to
    // z13: the neighbour shares the etgc cell so the query returns both items,
    // refinement keeps the covering DEM and finds no features for that tile.
    const selected = selectForTile(items(), NEIGHBOUR);
    expect(selected.has('features')).toBe(false);
    expect(selected.get('dem')?.tile).toEqual(DEM_PARENT);
  });

  it('prefers the finer tile when two cover the same ground', () => {
    const parsed = [demItem(), demItem(FUNCHAL)]
      .map(parseItemEvent)
      .filter((i): i is CorpusItem => i !== null);
    expect(selectForTile(parsed, FUNCHAL).get('dem')?.tile).toEqual(FUNCHAL);
  });

  it('prefers the newer event when the same tile is announced twice', () => {
    const parsed = [featuresItem(FUNCHAL, 1_754_000_000), featuresItem(FUNCHAL, 1_754_009_999)]
      .map(parseItemEvent)
      .filter((i): i is CorpusItem => i !== null);
    expect(selectForTile(parsed, FUNCHAL).get('features')?.createdAt).toBe(1_754_009_999);
  });

  it('returns nothing for a tile no item covers', () => {
    expect(selectForTile(items(), { z: 14, x: 8000, y: 6618 }).size).toBe(0);
  });
});

describe('coverageForTile', () => {
  const parsedItems = (): CorpusItem[] =>
    [demItem(), featuresItem()].map(parseItemEvent).filter((i): i is CorpusItem => i !== null);
  const collections = () => {
    const dem = parseCollectionEvent(demCollection());
    return dem === null ? [] : [dem];
  };

  it('names every announced dataset as covered or missing, never silently', () => {
    const report = coverageForTile(collections(), parsedItems(), NEIGHBOUR);

    // The neighbour is the negative case AS IT NOW STANDS: elevation reaches
    // it through the z13 parent, features do not exist for it. Both facts are
    // reported; neither collapses into a bare "no data".
    expect(report.find((entry) => entry.dataset === 'dem')?.covered).toBe(true);
    expect(report.find((entry) => entry.dataset === 'features')?.covered).toBe(false);

    // 'features' has items but no collection of its own in this fixture, and
    // is still named rather than dropped.
    expect(report.map((entry) => entry.dataset)).toEqual(['dem', 'features']);
  });

  it('marks a dataset missing when nothing covers the tile', () => {
    const report = coverageForTile(collections(), parsedItems(), { z: 14, x: 8000, y: 6618 });
    expect(report.every((entry) => !entry.covered)).toBe(true);
    expect(report.some((entry) => entry.dataset === 'dem')).toBe(true);
  });
});
