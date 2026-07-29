import { describe, expect, it, vi } from 'vitest';

import {
  HATCH_IMAGE_ID,
  SOURCE_ID,
  addCoverageOverlay,
  summarise,
} from '../../src/map/coverage-overlay';
import { coverageFor } from '../../src/config/coverage';

type Layer = { id: string; filter?: unknown; layout?: Record<string, unknown> };

/** Minimal stand-in for the parts of MapLibre the overlay touches. */
function stubMap() {
  const layers: Layer[] = [];
  const sources = new Set<string>();
  const images = new Set<string>();
  return {
    layers,
    sources,
    images,
    hasImage: (id: string) => images.has(id),
    addImage: (id: string) => images.add(id),
    addSource: (id: string) => sources.add(id),
    getSource: (id: string) => (sources.has(id) ? {} : undefined),
    removeSource: (id: string) => sources.delete(id),
    addLayer: (layer: Layer) => layers.push(layer),
    getLayer: (id: string) => layers.find((l) => l.id === id),
    removeLayer: (id: string) => {
      const index = layers.findIndex((l) => l.id === id);
      if (index >= 0) layers.splice(index, 1);
    },
    setLayoutProperty: (id: string, key: string, value: unknown) => {
      const layer = layers.find((l) => l.id === id);
      if (layer) layer.layout = { ...layer.layout, [key]: value };
    },
  };
}

function collection(statuses: string[]): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: statuses.map((status, i) => ({
      type: 'Feature',
      properties: { status, tile: `12/${i}/0` },
      geometry: {
        type: 'Polygon',
        coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]],
      },
    })),
  } as GeoJSON.FeatureCollection;
}

describe('coverage summary', () => {
  it('counts the three states and derives land', () => {
    const summary = summarise(collection(['covered', 'covered', 'gap', 'sea', 'sea', 'sea']));
    expect(summary).toEqual({ covered: 2, gap: 1, sea: 3, land: 3 });
  });

  it('ignores features with no status rather than miscounting them', () => {
    const missing = {
      type: 'FeatureCollection',
      features: [{ type: 'Feature', properties: {}, geometry: null }],
    } as unknown as GeoJSON.FeatureCollection;
    expect(summarise(missing)).toEqual({ covered: 0, gap: 0, sea: 0, land: 0 });
  });
});

describe('coverage overlay', () => {
  it('draws gaps only — covered and sea are never rendered', () => {
    const map = stubMap();
    addCoverageOverlay(map as never, collection(['covered', 'gap', 'sea']));

    expect(map.sources.has(SOURCE_ID)).toBe(true);
    const ids = map.layers.map((l) => l.id);
    expect(ids).toContain('coverage-gap');
    expect(ids).toContain('coverage-outline');
    // Marking what works adds nothing; only warnings belong on the map.
    expect(ids).not.toContain('coverage-covered');
    expect(ids).not.toContain('coverage-sea');
  });

  it('starts visible so gaps are seen without asking', () => {
    const map = stubMap();
    const overlay = addCoverageOverlay(map as never, collection(['gap']));

    expect(overlay.isVisible()).toBe(true);
    for (const layer of map.layers) {
      expect(layer.layout?.visibility).toBe('visible');
    }
  });

  it('toggles every layer together', () => {
    const map = stubMap();
    const overlay = addCoverageOverlay(map as never, collection(['covered', 'gap']));

    overlay.setVisible(true);
    for (const layer of map.layers) {
      expect(layer.layout?.visibility).toBe('visible');
    }

    overlay.setVisible(false);
    for (const layer of map.layers) {
      expect(layer.layout?.visibility).toBe('none');
    }
  });

  it('filters each layer to its own status', () => {
    const map = stubMap();
    addCoverageOverlay(map as never, collection(['covered', 'gap', 'sea']));

    for (const id of ['coverage-gap', 'coverage-outline']) {
      const layer = map.layers.find((l) => l.id === id);
      expect(JSON.stringify(layer?.filter)).toContain('gap');
    }
  });

  it('exposes the summary for the toolbar announcement', () => {
    const map = stubMap();
    const overlay = addCoverageOverlay(map as never, collection(['covered', 'gap', 'sea']));
    expect(overlay.summary).toEqual({ covered: 1, gap: 1, sea: 1, land: 2 });
  });

  it('removes every layer and the source on destroy', () => {
    const map = stubMap();
    const overlay = addCoverageOverlay(map as never, collection(['covered', 'gap']));
    overlay.destroy();

    expect(map.layers).toHaveLength(0);
    expect(map.sources.has(SOURCE_ID)).toBe(false);
  });

  it('does not re-register the hatch image on a second overlay', () => {
    const map = stubMap();
    const addImage = vi.spyOn(map, 'addImage');
    addCoverageOverlay(map as never, collection(['gap']));
    addCoverageOverlay(map as never, collection(['gap']));

    // jsdom has no canvas, so the image may be skipped entirely; what must not
    // happen is registering it twice.
    expect(addImage.mock.calls.filter(([id]) => id === HATCH_IMAGE_ID).length).toBeLessThanOrEqual(1);
  });
});

describe('shipped surveys', () => {
  it('madeira reports real gaps on land, not just sea', () => {
    const survey = coverageFor('madeira');
    expect(survey).not.toBeNull();

    const summary = summarise(survey!);
    // Porto Santo has no architectural imagery from any configured source.
    expect(summary.gap).toBeGreaterThan(0);
    expect(summary.covered).toBeGreaterThan(0);
    expect(summary.sea).toBeGreaterThan(summary.land);
  });

  it('south tyrol is mostly covered', () => {
    const summary = summarise(coverageFor('south-tyrol')!);
    expect(summary.covered).toBeGreaterThan(summary.gap);
  });

  it('returns null for a region with no survey', () => {
    expect(coverageFor('atlantis')).toBeNull();
  });

  it('every feature carries a status and a closed ring', () => {
    for (const id of ['madeira', 'south-tyrol']) {
      for (const feature of coverageFor(id)!.features) {
        expect(['covered', 'gap', 'sea', 'unknown']).toContain(feature.properties?.status);
        const ring = (feature.geometry as GeoJSON.Polygon).coordinates[0];
        expect(ring[0]).toEqual(ring[ring.length - 1]);
      }
    }
  });
});
