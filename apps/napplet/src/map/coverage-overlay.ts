import type { Map as MapLibreMap } from 'maplibre-gl';

/**
 * Imagery-coverage overlay.
 *
 * Answers one question before a user commits to a site: will this area come
 * back with usable imagery, or a blank? Esri answers everywhere, but over parts
 * of the Madeira archipelago it returns the same placeholder it serves for open
 * ocean, so "the service is up" is not the same as "your site is covered".
 *
 * The survey classifies covered / gap / sea, but only **gaps** are drawn.
 * Marking what works adds nothing — a user assumes coverage. Marking what does
 * not is the whole point, so the map stays clean and every mark is a warning.
 * Sea is excluded too: open water is not a data gap.
 */

export type CoverageStatus = 'covered' | 'gap' | 'sea' | 'unknown';

export const SOURCE_ID = 'imagery-coverage';
export const HATCH_IMAGE_ID = 'coverage-hatch';

const LAYER_GAP = 'coverage-gap';
const LAYER_GAP_HATCH = 'coverage-gap-hatch';
const LAYER_OUTLINE = 'coverage-outline';

const COLOR_GAP = '#FF6A00';

export type CoverageSummary = {
  covered: number;
  gap: number;
  sea: number;
  land: number;
};

/**
 * A 45° stripe tile for the gap fill.
 *
 * Hatching rather than a flat colour on purpose: a solid red block reads as
 * "imagery that happens to be red", whereas stripes read as an annotation over
 * the map. It also stays legible on top of dark satellite tiles.
 */
export function createHatchImage(size = 8): ImageData | null {
  // Degrade rather than throw where there is no DOM: the solid gap fill still
  // reads correctly without the stripes.
  if (typeof document === 'undefined') return null;

  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  if (!context) return null;

  context.clearRect(0, 0, size, size);
  context.strokeStyle = COLOR_GAP;
  context.lineWidth = 2;
  context.beginPath();
  // Two strokes so the pattern tiles seamlessly across the diagonal.
  context.moveTo(-size, size);
  context.lineTo(size, -size);
  context.moveTo(0, size * 2);
  context.lineTo(size * 2, 0);
  context.stroke();

  return context.getImageData(0, 0, size, size);
}

export function summarise(collection: GeoJSON.FeatureCollection): CoverageSummary {
  const summary: CoverageSummary = { covered: 0, gap: 0, sea: 0, land: 0 };
  for (const feature of collection.features) {
    const status = (feature.properties?.status ?? 'unknown') as CoverageStatus;
    if (status === 'covered') summary.covered += 1;
    else if (status === 'gap') summary.gap += 1;
    else if (status === 'sea') summary.sea += 1;
  }
  summary.land = summary.covered + summary.gap;
  return summary;
}

export type CoverageOverlay = {
  setVisible: (visible: boolean) => void;
  isVisible: () => boolean;
  summary: CoverageSummary;
  destroy: () => void;
};

/** Add the overlay to a loaded map. Safe to call before any selection exists. */
export function addCoverageOverlay(
  map: MapLibreMap,
  collection: GeoJSON.FeatureCollection,
  { visible = true }: { visible?: boolean } = {},
): CoverageOverlay {
  const summary = summarise(collection);

  if (!map.hasImage(HATCH_IMAGE_ID)) {
    const hatch = createHatchImage();
    if (hatch) map.addImage(HATCH_IMAGE_ID, hatch, { pixelRatio: 1 });
  }

  map.addSource(SOURCE_ID, { type: 'geojson', data: collection });

  const visibility = visible ? 'visible' : 'none';

  map.addLayer({
    id: LAYER_GAP,
    type: 'fill',
    source: SOURCE_ID,
    filter: ['==', ['get', 'status'], 'gap'],
    layout: { visibility },
    paint: { 'fill-color': COLOR_GAP, 'fill-opacity': 0.25 },
  });

  if (map.hasImage(HATCH_IMAGE_ID)) {
    map.addLayer({
      id: LAYER_GAP_HATCH,
      type: 'fill',
      source: SOURCE_ID,
      filter: ['==', ['get', 'status'], 'gap'],
      layout: { visibility },
      paint: { 'fill-pattern': HATCH_IMAGE_ID, 'fill-opacity': 0.9 },
    });
  }

  map.addLayer({
    id: LAYER_OUTLINE,
    type: 'line',
    source: SOURCE_ID,
    filter: ['==', ['get', 'status'], 'gap'],
    layout: { visibility },
    paint: {
      'line-color': COLOR_GAP,
      'line-width': 1,
      'line-opacity': 0.7,
    },
  });

  const layers = [LAYER_GAP, LAYER_GAP_HATCH, LAYER_OUTLINE];
  let current = visible;

  return {
    summary,
    isVisible: () => current,
    setVisible: (next: boolean) => {
      current = next;
      for (const id of layers) {
        if (map.getLayer(id)) {
          map.setLayoutProperty(id, 'visibility', next ? 'visible' : 'none');
        }
      }
    },
    destroy: () => {
      for (const id of layers) {
        if (map.getLayer(id)) map.removeLayer(id);
      }
      if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);
    },
  };
}
