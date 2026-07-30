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
  basemapTileUrl,
  composeAttribution,
  validateSourceRequest,
} from './source';
import type { BBox4326 } from '../bbox/validate';

const PROTOCOL = 'terrdvm';
const TILE_PATH = /^\/tile\/(\d+)\/(\d+)\/(\d+)\/?$/;
const TILE_DEADLINE_MS = 15_000;
const MAX_TILE_BYTES = 1_000_000;
const MADEIRA_CENTER: [number, number] = [-16.9, 32.75];
const MADEIRA_ZOOM = 11;
const MARKER_DATA_URL =
  'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="8" height="8" viewBox="0 0 8 8"%3E%3Ccircle cx="4" cy="4" r="3" fill="%2358B8E8" stroke="%230C1014" stroke-width="1"/%3E%3C/svg%3E';

type MapViewCallbacks = {
  onDrawComplete: (bbox: BBox4326) => void;
  onEditStart: () => void;
  onEditComplete: (bbox: BBox4326) => void;
  onMapError?: (error: unknown) => void;
};

export type MapView = {
  armDrawing: () => void;
  stopDrawing: () => void;
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

function parseTileUrl(rawUrl: string): { z: number; x: number; y: number } {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch (error) {
    throw new Error('Map tile URL is not a valid custom-protocol URL.', { cause: error });
  }

  if (
    parsed.protocol !== `${PROTOCOL}:` ||
    (parsed.hostname !== '' && parsed.hostname !== 'tile') ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error('Map tile URL uses an unapproved protocol or query string.');
  }

  const pathname = parsed.hostname === 'tile' ? `/tile${parsed.pathname}` : parsed.pathname;
  const match = pathname.match(TILE_PATH);
  if (!match) {
    throw new Error('Map tile URL does not match the approved tile path.');
  }

  const [z, x, y] = match.slice(1).map(Number);
  if (![z, x, y].every((value) => Number.isSafeInteger(value) && value >= 0)) {
    throw new Error('Map tile coordinates are outside the safe integer range.');
  }
  return { z, x, y };
}

async function loadBasemapTile(
  rawUrl: string,
  abortController: AbortController,
): Promise<{ data: ArrayBuffer }> {
  const { z, x, y } = parseTileUrl(rawUrl);
  const url = basemapTileUrl(z, x, y);
  const contractValidation = validateSourceRequest('basemap', {
    url,
    layer: 'OpenStreetMap Standard',
    format: 'image/png',
  });
  if (!contractValidation.ok) {
    throw new Error(`Basemap tile failed source-policy validation: ${contractValidation.message}`);
  }
  assertApprovedSourceRequest('basemap', {
    url,
    layer: 'OpenStreetMap Standard',
    format: 'image/png',
  });

  const blob = await loadApprovedBytes(url, {
    deadlineMs: TILE_DEADLINE_MS,
    isAllowed: (candidate) =>
      validateSourceRequest('basemap', {
        url: candidate,
        layer: 'OpenStreetMap Standard',
        format: 'image/png',
      }).ok,
    signal: abortController.signal,
  });
  if (blob.size > MAX_TILE_BYTES) {
    throw new Error('Basemap tile exceeded the approved response-size bound.');
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
    id: 'terrdvm-selection',
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
): MapView {
  let protocolRegistered = true;
  let destroyed = false;
  let drawReady = false;
  let pendingMode: 'select' | 'rectangle' = 'select';
  let pendingSelection: BBox4326 | null = null;
  let editingNotified = false;

  maplibregl.addProtocol(PROTOCOL, (params, abortController) =>
    loadBasemapTile(params.url, abortController),
  );

  const map = new maplibregl.Map({
    container,
    center: MADEIRA_CENTER,
    zoom: MADEIRA_ZOOM,
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
      },
      layers: [{
        id: 'basemap',
        type: 'raster',
        source: 'basemap',
      }],
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
          fillColor: '#58B8E8',
          fillOpacity: 0.12,
          outlineColor: '#58B8E8',
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
          selectedPointColor: '#58B8E8',
          selectedPointWidth: 8,
          selectedPointOpacity: 1,
          selectedPointOutlineColor: '#0C1014',
          selectedPointOutlineWidth: 1,
          selectedPointOutlineOpacity: 1,
          selectedMarkerUrl: MARKER_DATA_URL,
          selectedMarkerHeight: 8,
          selectedMarkerWidth: 8,
          selectedPolygonColor: '#58B8E8',
          selectedPolygonFillOpacity: 0.12,
          selectedPolygonOutlineColor: '#58B8E8',
          selectedPolygonOutlineOpacity: 1,
          selectedPolygonOutlineWidth: 2,
          selectionPointColor: '#58B8E8',
          selectionPointWidth: 8,
          selectionPointOpacity: 1,
          selectionPointOutlineColor: '#0C1014',
          selectionPointOutlineWidth: 1,
          selectionPointOutlineOpacity: 1,
          midPointColor: '#58B8E8',
          midPointOutlineColor: '#0C1014',
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

  const resize = (): void => {
    if (!destroyed) map.resize();
  };
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(container);
  window.addEventListener('resize', resize, { passive: true });
  map.once('load', () => {
    if (destroyed) return;
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
  return composeAttribution({ basemap: true, imagery: false });
}
