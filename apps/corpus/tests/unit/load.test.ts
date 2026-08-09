import { describe, expect, it } from 'vitest';
import { schnorr } from '@noble/curves/secp256k1.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { buildCollection, buildItem } from '@terrcvm/geo-protocol';
import type { RelayEvent, RelayFilter } from '@terrcvm/napplet-kit/shell/outbox-client';
import { discoverTile, loadItemBytes } from '../../src/corpus/load';

const toHex = (bytes: Uint8Array): string =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
const fromHex = (hex: string): Uint8Array =>
  Uint8Array.from(hex.match(/../g) ?? [], (pair) => Number.parseInt(pair, 16));

const SECRET = Uint8Array.from({ length: 32 }, (_, i) => i + 1);
const PUBKEY = toHex(schnorr.getPublicKey(SECRET));

const OTHER_SECRET = Uint8Array.from({ length: 32 }, (_, i) => i + 9);
const OTHER_PUBKEY = toHex(schnorr.getPublicKey(OTHER_SECRET));

const FUNCHAL = { z: 14, x: 7422, y: 6618 };
const DEM_PARENT = { z: 13, x: 3711, y: 3309 };

const DEM_BYTES = new TextEncoder().encode('pretend PNG bytes');
const DEM_SHA = toHex(sha256(DEM_BYTES));

function sign(unsigned: { kind: number; created_at: number; tags: string[][]; content: string }, secret = SECRET): RelayEvent {
  const pubkey = toHex(schnorr.getPublicKey(secret));
  const serialized = JSON.stringify([
    0,
    pubkey,
    unsigned.created_at,
    unsigned.kind,
    unsigned.tags,
    unsigned.content,
  ]);
  const id = toHex(sha256(new TextEncoder().encode(serialized)));
  const sig = toHex(schnorr.sign(fromHex(id), secret));
  return { ...unsigned, id, pubkey, sig };
}

function demCollection(secret = SECRET): RelayEvent {
  return sign(
    buildCollection({
      dataset: 'dem',
      title: 'Madeira elevation',
      bbox: [-17.32, 32.35, -16.24, 33.15],
      mimeType: 'image/png',
      license: 'CC-BY-4.0',
      source: 'Mapzen Terrarium via AWS Open Data',
      server: 'http://blossom.test',
      createdAt: 1_754_000_000,
    }) as never,
    secret,
  );
}

function demItem(secret = SECRET, sha = DEM_SHA) {
  return sign(
    buildItem({
      dataset: 'dem',
      tile: DEM_PARENT,
      pubkey: toHex(schnorr.getPublicKey(secret)),
      sha256: sha,
      url: `http://blossom.test/${sha}`,
      mimeType: 'image/png',
      size: DEM_BYTES.length,
      datetime: '2026-08-02T12:00:00Z',
      createdAt: 1_754_000_000,
    }) as never,
    secret,
  );
}

type FakeTransport = {
  query: (filters: RelayFilter[]) => Promise<RelayEvent[]>;
  bytes: (url: string) => Promise<Uint8Array<ArrayBuffer>>;
  seenFilters: RelayFilter[][];
  seenUrls: string[];
};

function transportOf(events: RelayEvent[], blobs: Record<string, Uint8Array<ArrayBuffer>> = {}): FakeTransport {
  const seenFilters: RelayFilter[][] = [];
  const seenUrls: string[] = [];
  return {
    seenFilters,
    seenUrls,
    query: async (filters) => {
      seenFilters.push(filters);
      const kinds = new Set(filters.flatMap((filter) => filter.kinds));
      return events.filter((event) => kinds.has(event.kind));
    },
    bytes: async (url) => {
      seenUrls.push(url);
      const blob = blobs[url];
      if (blob === undefined) throw new Error(`no blob at ${url}`);
      return blob;
    },
  };
}

describe('discoverTile', () => {
  it('finds the collection and the covering item, from events alone', async () => {
    const transport = transportOf([demCollection(), demItem()]);
    const found = await discoverTile(transport, { publisher: PUBKEY, tile: FUNCHAL });

    expect(found.collections.map((c) => c.dataset)).toEqual(['dem']);
    // The server is learned from the event, not configured.
    expect(found.collections[0].server).toBe('http://blossom.test');
    expect(found.selected.get('dem')?.tile).toEqual(DEM_PARENT);
    expect(found.coverage).toEqual([{ dataset: 'dem', covered: true, tile: DEM_PARENT }]);
  });

  it('pins the publisher in the filters it sends', async () => {
    const transport = transportOf([demCollection(), demItem()]);
    await discoverTile(transport, { publisher: PUBKEY, tile: FUNCHAL });

    const everyFilter = transport.seenFilters.flat();
    expect(everyFilter.length).toBeGreaterThan(0);
    for (const filter of everyFilter) expect(filter.authors).toEqual([PUBKEY]);
    // The item query must carry the cell cover, including ancestors.
    const itemFilter = everyFilter.find((filter) => filter['#g'] !== undefined);
    expect(itemFilter?.['#g']).toContain('etgc');
  });

  it('drops an event whose signature does not verify', async () => {
    const forged = { ...demItem(), sig: 'f'.repeat(128) };
    const transport = transportOf([demCollection(), forged]);
    const found = await discoverTile(transport, { publisher: PUBKEY, tile: FUNCHAL });

    expect(found.selected.size).toBe(0);
    expect(found.rejected).toBeGreaterThan(0);
  });

  it('drops an event whose id does not match its own content', async () => {
    const tampered = { ...demItem(), content: '{"bbox":[0,0,1,1],"datetime":"x","properties":{}}' };
    const transport = transportOf([demCollection(), tampered]);
    const found = await discoverTile(transport, { publisher: PUBKEY, tile: FUNCHAL });

    expect(found.selected.size).toBe(0);
  });

  it('drops a correctly signed event from the wrong author', async () => {
    // A relay is free to answer with whatever it likes; the authors filter is
    // a request, not a proof. This event verifies perfectly — and is still not
    // the publisher we trust.
    const transport = transportOf([demCollection(), demItem(OTHER_SECRET)]);
    const found = await discoverTile(transport, { publisher: PUBKEY, tile: FUNCHAL });

    expect(OTHER_PUBKEY).not.toBe(PUBKEY);
    expect(found.selected.size).toBe(0);
  });

  it('reports an uncovered tile without inventing an error', async () => {
    const transport = transportOf([demCollection(), demItem()]);
    const found = await discoverTile(transport, {
      publisher: PUBKEY,
      tile: { z: 14, x: 8000, y: 6618 },
    });

    expect(found.selected.size).toBe(0);
    expect(found.coverage).toEqual([{ dataset: 'dem', covered: false, tile: null }]);
  });
});

describe('loadItemBytes', () => {
  it('returns bytes whose hash matches the announcement', async () => {
    const transport = transportOf([], { [`http://blossom.test/${DEM_SHA}`]: DEM_BYTES });
    const found = await discoverTile(transportOf([demCollection(), demItem()]), {
      publisher: PUBKEY,
      tile: FUNCHAL,
    });
    const item = found.selected.get('dem');
    expect(item).toBeDefined();

    const bytes = await loadItemBytes(transport, item!, 'http://blossom.test');
    expect(bytes).toEqual(DEM_BYTES);
  });

  it('refuses bytes that do not hash to the x tag', async () => {
    const wrong = new TextEncoder().encode('different bytes entirely');
    const transport = transportOf([], { [`http://blossom.test/${DEM_SHA}`]: wrong });
    const found = await discoverTile(transportOf([demCollection(), demItem()]), {
      publisher: PUBKEY,
      tile: FUNCHAL,
    });

    await expect(
      loadItemBytes(transport, found.selected.get('dem')!, 'http://blossom.test'),
    ).rejects.toThrow(/hash/i);
  });

  it('fetches from the collection server, not from the url tag host', async () => {
    // The url tag is a hint from a publisher; the server is the collection's
    // declared home. Pinning the host means a rewritten url tag cannot send
    // the client to a third party.
    const transport = transportOf([], { [`http://mirror.test/${DEM_SHA}`]: DEM_BYTES });
    const found = await discoverTile(transportOf([demCollection(), demItem()]), {
      publisher: PUBKEY,
      tile: FUNCHAL,
    });

    await loadItemBytes(transport, found.selected.get('dem')!, 'http://mirror.test');
    expect(transport.seenUrls).toEqual([`http://mirror.test/${DEM_SHA}`]);
  });
});
