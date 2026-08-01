import maplibregl, { type Map as MapLibreMap } from 'maplibre-gl';
import {
  TerraDraw,
  TerraDrawRectangleMode,
  TerraDrawSelectMode,
} from 'terra-draw';
import { TerraDrawMapLibreGLAdapter } from 'terra-draw-maplibre-gl-adapter';

import { loadApprovedBytes } from '../shell/resource-client';
import {
  assertApprovedSourceRequest,
  composeAttribution,
  contractMetadata,
  tileUrlFor,
  validateSourceRequest,
  type SourceRole,
} from '@terrcvm/terrain-engine/map/source';
import { getRegion, viewBoundsTuple, type Region } from '@terrcvm/terrain-engine/config/regions';
import { coverageFor } from '@terrcvm/terrain-engine/config/coverage';
import { fetchPlacements } from '../job/collection';
import cities from '@terrcvm/terrain-engine/config/cities.json';
import { addCoverageOverlay, type CoverageOverlay } from '@terrcvm/terrain-engine/map/coverage-overlay';
import type { BBox4326 } from '@terrcvm/terrain-engine/bbox/validate';

const PROTOCOL = 'terrcvm';
const TILE_PATH = /^\/(\d+)\/(\d+)\/(\d+)\/?$/;
const TILE_DEADLINE_MS = 15_000;
const MAX_TILE_BYTES = 1_000_000;

/** Custom-protocol host → approved source role. Nothing else is routable. */
const ROLE_BY_HOST: Record<string, SourceRole> = {
  tile: 'basemap',
  imagery: 'imagery',
};
const MARKER_DATA_URL =
  'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="8" height="8" viewBox="0 0 8 8"%3E%3Ccircle cx="4" cy="4" r="3" fill="%23F7931A" stroke="%23000000" stroke-width="1"/%3E%3C/svg%3E';

type MapViewCallbacks = {
  /** Fired when the user picks a spot in place-avatar mode. */
  onPlacePick?: (lon: number, lat: number) => void;
  onDrawComplete: (bbox: BBox4326) => void;
  onEditStart: () => void;
  onEditComplete: (bbox: BBox4326) => void;
  onMapError?: (error: unknown) => void;
  /** Fired once a role has actually delivered a tile, so the UI can stop claiming it is unavailable. */
  onSourceActive?: (role: SourceRole) => void;
};

export type MapView = {
  toggleCoverage: () => boolean;
  coverageSummary: () => { covered: number; gap: number; sea: number; land: number } | null;
  armDrawing: () => void;
  stopDrawing: () => void;
  /** Next map click reports a position instead of starting a selection. */
  armPlacing: () => void;
  /** Show a placed avatar immediately, without waiting for a refetch. */
  addAvatarMarker: (name: string, lon: number, lat: number, sha256: string) => void;
  /** A live geo-tagged note from the wider network. */
  addNoteMarker: (id: string, text: string, lon: number, lat: number) => void;
  setSelection: (bbox: BBox4326) => void;
  clearSelection: () => void;
  destroy: () => void;
};

type PolygonFeature = {
  id?: string | number;
  type?: string;
  properties?: Record<string, unknown>;
  geometry?: {
    type?: string;
    coordinates?: unknown;
  };
};

function parseTileUrl(rawUrl: string): { role: SourceRole; z: number; x: number; y: number } {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch (error) {
    throw new Error('Map tile URL is not a valid custom-protocol URL.', { cause: error });
  }

  const role = ROLE_BY_HOST[parsed.hostname];
  if (parsed.protocol !== `${PROTOCOL}:` || !role || parsed.search || parsed.hash) {
    throw new Error('Map tile URL uses an unapproved protocol, host, or query string.');
  }

  const match = parsed.pathname.match(TILE_PATH);
  if (!match) {
    throw new Error('Map tile URL does not match the approved tile path.');
  }

  const [z, x, y] = match.slice(1).map(Number);
  if (![z, x, y].every((value) => Number.isSafeInteger(value) && value >= 0)) {
    throw new Error('Map tile coordinates are outside the safe integer range.');
  }
  return { role, z, x, y };
}

async function loadRoleTile(
  rawUrl: string,
  abortController: AbortController,
): Promise<{ data: ArrayBuffer }> {
  const { role, z, x, y } = parseTileUrl(rawUrl);
  const { layer, format } = contractMetadata(role);
  const url = tileUrlFor(role, z, x, y);

  const contractValidation = validateSourceRequest(role, { url, layer, format });
  if (!contractValidation.ok) {
    throw new Error(`${role} tile failed source-policy validation: ${contractValidation.message}`);
  }
  assertApprovedSourceRequest(role, { url, layer, format });

  const blob = await loadApprovedBytes(url, {
    deadlineMs: TILE_DEADLINE_MS,
    isAllowed: (candidate) => validateSourceRequest(role, { url: candidate, layer, format }).ok,
    signal: abortController.signal,
  });
  if (blob.size > MAX_TILE_BYTES) {
    throw new Error(`${role} tile exceeded the approved response-size bound.`);
  }
  return { data: await blob.arrayBuffer() };
}

function bboxFromFeature(feature: PolygonFeature): BBox4326 {
  if (feature.geometry?.type !== 'Polygon' || !Array.isArray(feature.geometry.coordinates)) {
    throw new Error('Terra Draw returned a non-polygon selection.');
  }
  const ring = feature.geometry.coordinates[0];
  if (!Array.isArray(ring)) {
    throw new Error('Terra Draw returned a polygon without coordinates.');
  }
  const points = ring.filter(
    (point): point is [number, number] =>
      Array.isArray(point) && point.length >= 2 &&
      typeof point[0] === 'number' && typeof point[1] === 'number',
  );
  if (points.length < 4) {
    throw new Error('Terra Draw returned an incomplete rectangle.');
  }
  const longitudes = points.map(([longitude]) => longitude);
  const latitudes = points.map(([, latitude]) => latitude);
  return [
    Math.min(...longitudes),
    Math.min(...latitudes),
    Math.max(...longitudes),
    Math.max(...latitudes),
  ];
}

function rectangleFeature(bbox: BBox4326): PolygonFeature {
  const [west, south, east, north] = bbox;
  return {
    id: 'terrcvm-selection',
    type: 'Feature',
    properties: {},
    geometry: {
      type: 'Polygon',
      coordinates: [[
        [west, south],
        [east, south],
        [east, north],
        [west, north],
        [west, south],
      ]],
    },
  };
}

export function createMapView(
  container: HTMLDivElement,
  callbacks: MapViewCallbacks,
  region: Region = getRegion(undefined),
): MapView {
  let protocolRegistered = true;
  let destroyed = false;
  let drawReady = false;
  let pendingMode: 'select' | 'rectangle' = 'select';
  let pendingSelection: BBox4326 | null = null;
  let editingNotified = false;
  let coverage: CoverageOverlay | null = null;
  let placing = false;

  // --- Coordinate-anchored labels -------------------------------------------
  // Dots and names render as symbol layers INSIDE the GL scene, positioned
  // purely by their coordinates — no DOM markers that can drift or need CSS
  // the shell does not ship. Labels are baked into per-name icons because
  // the style has no glyph server.
  const bakeLabelIcon = (
    label: string,
    style: 'city' | 'avatar' | 'note',
  ): { data: ImageData; pixelRatio: number } | null => {
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (!context) return null;
    const font = `${style === 'avatar' ? 700 : style === 'note' ? 400 : 600} ${
      (style === 'note' ? 10 : 11) * ratio}px system-ui, sans-serif`;
    context.font = font;
    const textWidth = Math.ceil(context.measureText(label).width);
    const dot = (style === 'avatar' ? 9 : style === 'note' ? 6 : 7) * ratio;
    const gap = 5 * ratio;
    const pad = 3 * ratio;
    canvas.width = pad + dot + gap + textWidth + pad;
    canvas.height = Math.ceil(18 * ratio);
    // Resizing resets 2D state, so the font is set again.
    context.font = font;
    context.textBaseline = 'middle';
    const midY = canvas.height / 2;
    context.strokeStyle = '#111111';
    context.lineWidth = ratio;
    if (style === 'avatar') {
      // The ember diamond of the placed avatars.
      context.fillStyle = '#FF6A00';
      context.beginPath();
      context.moveTo(pad + dot / 2, midY - dot / 2);
      context.lineTo(pad + dot, midY);
      context.lineTo(pad + dot / 2, midY + dot / 2);
      context.lineTo(pad, midY);
      context.closePath();
    } else {
      // Cities bone-white, live notes phosphor green.
      context.fillStyle = style === 'note' ? '#4be38a' : '#f5efe2';
      context.beginPath();
      context.arc(pad + dot / 2, midY, dot / 2, 0, Math.PI * 2);
    }
    context.fill();
    context.stroke();
    const textX = pad + dot + gap;
    context.lineJoin = 'round';
    context.lineWidth = 3 * ratio;
    context.strokeStyle = 'rgba(17, 17, 17, 0.92)';
    context.strokeText(label, textX, midY);
    context.fillStyle =
      style === 'avatar' ? '#FFA733' : style === 'note' ? '#8df5b6' : '#f5efe2';
    context.fillText(label, textX, midY);
    return {
      data: context.getImageData(0, 0, canvas.width, canvas.height),
      pixelRatio: ratio,
    };
  };

  type LabelFeature = GeoJSON.Feature<GeoJSON.Point, { icon: string; name: string }>;
  let avatarFeatures: LabelFeature[] = [];

  const labelLayer = (id: string): maplibregl.LayerSpecification => ({
    id,
    type: 'symbol',
    source: id,
    layout: {
      'icon-image': ['get', 'icon'],
      'icon-anchor': 'left',
      'icon-allow-overlap': true,
      'icon-ignore-placement': true,
      'icon-offset': [2, 0],
    },
  });

  let noteFeatures: LabelFeature[] = [];

  const noteMarker = (id: string, text: string, lon: number, lat: number): void => {
    const source = map.getSource('notes') as maplibregl.GeoJSONSource | undefined;
    if (!source || noteFeatures.some((feature) => feature.properties.name === id)) return;
    const label = text.replace(/\s+/g, ' ').trim().slice(0, 28) || '(note)';
    const iconId = `note-${id.slice(0, 12)}`;
    if (!map.hasImage(iconId)) {
      const icon = bakeLabelIcon(label, 'note');
      if (!icon) return;
      map.addImage(iconId, icon.data, { pixelRatio: icon.pixelRatio });
    }
    noteFeatures.push({
      type: 'Feature',
      properties: { icon: iconId, name: id },
      geometry: { type: 'Point', coordinates: [lon, lat] },
    });
    source.setData({ type: 'FeatureCollection', features: noteFeatures });
  };

  const avatarMarker = (name: string, lon: number, lat: number, sha256: string): void => {
    const source = map.getSource('avatars') as maplibregl.GeoJSONSource | undefined;
    if (!source) return;
    const iconId = `avatar-${name}`;
    if (!map.hasImage(iconId)) {
      const icon = bakeLabelIcon(name, 'avatar');
      if (!icon) return;
      map.addImage(iconId, icon.data, { pixelRatio: icon.pixelRatio });
    }
    // One marker per character: a re-placement moves it. The hash rides in
    // the feature so map tooling can resolve the blob.
    avatarFeatures = avatarFeatures.filter((feature) => feature.properties.name !== name);
    avatarFeatures.push({
      type: 'Feature',
      properties: { icon: iconId, name, sha256 } as LabelFeature['properties'],
      geometry: { type: 'Point', coordinates: [lon, lat] },
    });
    source.setData({ type: 'FeatureCollection', features: avatarFeatures });
  };

  maplibregl.addProtocol(PROTOCOL, (params, abortController) =>
    loadRoleTile(params.url, abortController),
  );

  const map = new maplibregl.Map({
    container,
    center: [...region.center],
    zoom: region.zoom,
    minZoom: region.minZoom,
    // The viewport cannot leave the configured region.
    maxBounds: viewBoundsTuple(region),
    renderWorldCopies: false,
    attributionControl: false,
    style: {
      version: 8,
      sources: {
        basemap: {
          type: 'raster',
          tiles: [`${PROTOCOL}://tile/{z}/{x}/{y}`],
          tileSize: 256,
          minzoom: 0,
          maxzoom: 19,
        },
        imagery: {
          type: 'raster',
          tiles: [`${PROTOCOL}://imagery/{z}/{x}/{y}`],
          tileSize: 256,
          minzoom: 0,
          maxzoom: 19,
        },
      },
      layers: [
        { id: 'basemap', type: 'raster', source: 'basemap' },
        { id: 'imagery', type: 'raster', source: 'imagery' },
      ],
    },
  });

  const adapter = new TerraDrawMapLibreGLAdapter<MapLibreMap>({ map });
  const draw = new TerraDraw({
    adapter,
    modes: [
      new TerraDrawRectangleMode({
        drawInteraction: 'click-drag',
        keyEvents: { cancel: 'Escape', finish: null },
        styles: {
          fillColor: '#F7931A',
          fillOpacity: 0.12,
          outlineColor: '#F7931A',
          outlineOpacity: 1,
          outlineWidth: 2,
        },
      }),
      new TerraDrawSelectMode({
        flags: {
          select: {
            feature: {
              draggable: true,
              coordinates: {
                draggable: true,
                resizable: 'opposite',
                midpoints: false,
                deletable: false,
              },
            },
          },
        },
        styles: {
          selectedPointColor: '#F7931A',
          selectedPointWidth: 8,
          selectedPointOpacity: 1,
          selectedPointOutlineColor: '#000000',
          selectedPointOutlineWidth: 1,
          selectedPointOutlineOpacity: 1,
          selectedMarkerUrl: MARKER_DATA_URL,
          selectedMarkerHeight: 8,
          selectedMarkerWidth: 8,
          selectedPolygonColor: '#F7931A',
          selectedPolygonFillOpacity: 0.12,
          selectedPolygonOutlineColor: '#F7931A',
          selectedPolygonOutlineOpacity: 1,
          selectedPolygonOutlineWidth: 2,
          selectionPointColor: '#F7931A',
          selectionPointWidth: 8,
          selectionPointOpacity: 1,
          selectionPointOutlineColor: '#000000',
          selectionPointOutlineWidth: 1,
          selectionPointOutlineOpacity: 1,
          midPointColor: '#F7931A',
          midPointOutlineColor: '#000000',
          midPointOpacity: 0,
          midPointWidth: 8,
          midPointOutlineWidth: 1,
          midPointOutlineOpacity: 0,
        },
      }),
    ],
  });

  const currentFeature = (): PolygonFeature | undefined =>
    draw.getSnapshot()[0] as PolygonFeature | undefined;

  draw.on('finish', (id, context) => {
    const feature = draw.getSnapshotFeature(id) as PolygonFeature | undefined;
    if (!feature) return;
    try {
      const bbox = bboxFromFeature(feature);
      if (context.mode === 'rectangle' && context.action === 'draw') {
        // A fresh rectangle replaces the previous selection: two boxes on the
        // map would leave ambiguous which one the request describes.
        const stale = (draw.getSnapshot() as PolygonFeature[])
          .map((other) => other.id)
          .filter((otherId): otherId is string | number =>
            otherId !== undefined && otherId !== id,
          );
        if (stale.length > 0) draw.removeFeatures(stale);
        draw.setMode('select');
        draw.selectFeature(id);
        editingNotified = false;
        callbacks.onDrawComplete(bbox);
      } else if (context.mode === 'select') {
        callbacks.onEditComplete(bbox);
        editingNotified = false;
      }
    } catch (error) {
      callbacks.onMapError?.(error);
    }
  });

  draw.on('change', (ids, type) => {
    if (
      !editingNotified &&
      draw.getMode() === 'select' &&
      ids.length > 0 &&
      type !== 'delete'
    ) {
      editingNotified = true;
      callbacks.onEditStart();
    }
  });

  map.on('error', (event) => callbacks.onMapError?.(event.error));

  // Truthful source status: a role only counts as live once the shell has
  // actually returned tile bytes for it. Capability-denied runs never fire this.
  const announcedRoles = new Set<SourceRole>();
  map.on('sourcedata', (event) => {
    const role = event.sourceId === 'imagery' ? 'imagery' : event.sourceId === 'basemap' ? 'basemap' : null;
    if (!role || announcedRoles.has(role)) return;
    if (event.tile?.state !== 'loaded') return;
    announcedRoles.add(role);
    callbacks.onSourceActive?.(role);
  });

  const resize = (): void => {
    if (!destroyed) map.resize();
  };
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(container);
  window.addEventListener('resize', resize, { passive: true });
  // `load` is the reliable signal: it fires once the style is parsed and the
  // first render completes. An earlier attempt to key off `styledata` +
  // `isStyleLoaded()` broke drawing outright — `styledata` fires before the
  // style is ready and then never again, so `draw.start()` never ran.
  map.once('load', () => {
    if (destroyed) return;

    // Coverage is advisory, so a broken survey must never stop the map coming up.
    const survey = coverageFor(region.id);
    if (survey) {
      try {
        coverage = addCoverageOverlay(map, survey);
      } catch (error) {
        callbacks.onMapError?.(error);
      }
    }

    // Orientation dots: only cities inside the region's view bounds, each
    // baked into an icon and anchored by its coordinates.
    const cityFeatures: LabelFeature[] = [];
    for (const city of cities as { name: string; lon: number; lat: number }[]) {
      if (
        city.lon < region.viewBounds.west ||
        city.lon > region.viewBounds.east ||
        city.lat < region.viewBounds.south ||
        city.lat > region.viewBounds.north
      ) {
        continue;
      }
      const iconId = `city-${city.name}`;
      if (!map.hasImage(iconId)) {
        const icon = bakeLabelIcon(city.name, 'city');
        if (!icon) continue;
        map.addImage(iconId, icon.data, { pixelRatio: icon.pixelRatio });
      }
      cityFeatures.push({
        type: 'Feature',
        properties: { icon: iconId, name: city.name },
        geometry: { type: 'Point', coordinates: [city.lon, city.lat] },
      });
    }
    map.addSource('cities', {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: cityFeatures },
    });
    map.addLayer(labelLayer('cities'));
    map.addSource('avatars', {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
    });
    map.addLayer(labelLayer('avatars'));
    map.addSource('notes', {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
    });
    map.addLayer(labelLayer('notes'));

    // Placed avatars: every marker is a blob anyone can fetch by hash.
    void fetchPlacements()
      .then((placements) => {
        if (destroyed) return;
        for (const placement of placements) {
          avatarMarker(placement.name, placement.lon, placement.lat, placement.sha256);
        }
      })
      .catch(() => undefined);

    map.on('click', (event) => {
      if (!placing) return;
      placing = false;
      map.getCanvas().style.cursor = '';
      callbacks.onPlacePick?.(event.lngLat.lng, event.lngLat.lat);
    });

    draw.start();
    drawReady = true;
    draw.setMode(pendingMode);
    if (pendingSelection) {
      const queuedSelection = pendingSelection;
      pendingSelection = null;
      applySelection(queuedSelection);
    }
    resize();
  });

  const applySelection = (bbox: BBox4326): void => {
    draw.clear();
    const validation = draw.addFeatures([rectangleFeature(bbox) as never]);
    if (validation.some((result) => !result.valid)) {
      callbacks.onMapError?.(new Error('Terra Draw rejected the coordinate selection.'));
      return;
    }
    const feature = currentFeature();
    if (feature?.id !== undefined) {
      draw.setMode('select');
      draw.selectFeature(feature.id);
    }
    editingNotified = false;
  };

  return {
    toggleCoverage: () => {
      if (!coverage) return false;
      const next = !coverage.isVisible();
      coverage.setVisible(next);
      return next;
    },
    coverageSummary: () => coverage?.summary ?? null,
    armDrawing: () => {
      if (destroyed) return;
      editingNotified = false;
      pendingMode = 'rectangle';
      if (drawReady) draw.setMode('rectangle');
    },
    stopDrawing: () => {
      if (destroyed) return;
      pendingMode = 'select';
      if (drawReady) draw.setMode('select');
      editingNotified = false;
    },
    armPlacing: () => {
      if (destroyed) return;
      placing = true;
      map.getCanvas().style.cursor = 'crosshair';
    },
    addAvatarMarker: (name, lon, lat, sha256) => {
      if (destroyed) return;
      avatarMarker(name, lon, lat, sha256);
    },
    addNoteMarker: (id, text, lon, lat) => {
      if (destroyed) return;
      noteMarker(id, text, lon, lat);
    },
    setSelection: (bbox) => {
      if (destroyed) return;
      if (!drawReady) {
        pendingSelection = bbox;
        return;
      }
      applySelection(bbox);
    },
    clearSelection: () => {
      if (destroyed) return;
      pendingSelection = null;
      if (!drawReady) return;
      draw.clear();
      draw.setMode('select');
      editingNotified = false;
    },
    destroy: () => {
      if (destroyed) return;
      destroyed = true;
      resizeObserver.disconnect();
      window.removeEventListener('resize', resize);
      coverage?.destroy();
      coverage = null;
      avatarFeatures = [];
      try {
        if (drawReady) draw.stop();
      } finally {
        map.remove();
        if (protocolRegistered) {
          maplibregl.removeProtocol(PROTOCOL);
          protocolRegistered = false;
        }
      }
    },
  };
}

export function mapAttribution(): string {
  return composeAttribution({ basemap: true, imagery: true });
}
