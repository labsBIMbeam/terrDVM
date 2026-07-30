import {
  MAX_AREA_KM2,
  OUTPUT_MIME,
  RES_M,
  TIMEOUT_S,
} from '../config/defaults';
import type { BBoxErrorCode } from '../bbox/validate';

type CopyValue = number | string;

type AreaLimitCopyParams = {
  areaKm2: CopyValue;
  maxAreaKm2?: CopyValue;
};

type SourceAttributionCopyParams = {
  sourceAttribution: string;
  licenseId: string;
};

export type SourceRowSuffix =
  | 'live'
  | 'test fixture'
  | 'local fallback'
  | 'unavailable';

const finiteDecimalDegrees =
  'Coordinates must be finite decimal degrees. Check each field for empty values or stray characters.';

function areaLimitCopy({
  areaKm2,
  maxAreaKm2 = MAX_AREA_KM2,
}: AreaLimitCopyParams): string {
  return `Selected area is ${areaKm2} km², over the ${maxAreaKm2} km² limit for this service. Draw a smaller rectangle or lower the coordinates' span.`;
}

function sourceRow(sourceName: string, suffix: SourceRowSuffix): string {
  const source = sourceName.length > 0 ? `${sourceName} ` : '';
  return `Source: ${source}— ${suffix}`;
}

export const COPY = {
  boot: {
    skipToRequestPanel: 'Skip to request panel',
    toolbarLabel: 'Toolbar',
    appTitle: 'terrDVM',
    mapRegionLabel: 'Map region',
    startKicker: 'terrain data vending machine',
    startEnter: 'Click to enter',
  },
  buttons: {
    drawBoundingBox: 'Draw bounding box',
    stopDrawing: 'Stop drawing',
    enterCoordinates: 'Enter coordinates',
    applyCoordinates: 'Apply coordinates',
    clearSelection: 'Clear selection',
    showCoverage: 'Imagery coverage',
    restoreSelection: 'Restore selection',
    retryPreview: 'Retry preview',
    continueToRequest: 'Continue to request',
    closeRequestGate: 'Back to selection',
  },
  emptyState: {
    heading: 'No area selected',
    body: 'Draw a rectangle on the map or enter coordinates to define the terrain area for this request.',
  },
  helpers: {
    idle: 'Choose “Draw bounding box” or “Enter coordinates” to select an area. Drag pans the map.',
    drawPointer:
      'Click and drag on the map to draw the rectangle. Press Escape or choose Stop drawing to exit.',
    drawTouch: 'Touch and drag on the map to draw the rectangle.',
    editSelection:
      'Drag a corner handle to resize or drag inside the rectangle to move it. Area and request preview update when you release.',
  },
  toast: {
    selectionCleared: 'Selection cleared.',
  },
  selectionReady: (areaKm2: CopyValue): string =>
    `Selection ready. ${areaKm2} km² — the request preview below reflects this selection.`,
  sourceAttribution: ({
    sourceAttribution,
    licenseId,
  }: SourceAttributionCopyParams): string =>
    `Basemap © OpenStreetMap contributors · Imagery © ${sourceAttribution} — ${licenseId}`,
  fixedDefaults: {
    resolution: `Resolution: ${RES_M} m/px — fixed for v1`,
    output: `Output: ${OUTPUT_MIME} — fixed for v1`,
    helperCaption:
      'These values are set by the service and cannot be changed in this version.',
  },
  validation: {
    MALFORMED: finiteDecimalDegrees,
    NON_FINITE: finiteDecimalDegrees,
    RANGE:
      'Longitude must be between −180 and 180, latitude between −90 and 90.',
    ORDER: 'West must be less than east, and south must be less than north.',
    ANTIMERIDIAN_AMBIGUOUS:
      'Selections crossing the ±180° line are not supported in this version. Draw a rectangle that stays on one side of the antimeridian.',
    AREA_LIMIT: areaLimitCopy,
  },
  preview: {
    loading: 'Loading preview for the selected area…',
    denied:
      'Imagery access was denied by the shell. Your selection and request preview remain valid. Grant the resource capability in the shell, then choose Retry preview.',
    timeout: (timeoutS: CopyValue = TIMEOUT_S): string =>
      `The imagery source did not respond within ${timeoutS} seconds. Your selection is unchanged. Choose Retry preview to try again.`,
    failed:
      'The imagery preview could not be loaded. Your selection and request preview remain valid. Choose Retry preview to try again.',
    offline:
      'You appear to be offline. Map tiles and imagery may be missing or stale; selection tools and the request preview still work.',
    fallbackTransportLabel:
      'Preview served through the local authenticated fallback, not the shell resource path.',
  },
  sourceUnavailable: {
    heading: 'Source unavailable',
    body: 'No trusted imagery source is active. Bounding-box selection and the request preview work normally; the orthophoto preview stays off until a source is approved.',
  },
  fixture: {
    badge: 'TEST FIXTURE',
    body: 'This image is a bundled test fixture, not live orthophoto imagery of the selected area.',
  },
  requestPanel: {
    title: 'Request preview',
    bboxLabel: 'Bounding box (W, S, E, N — EPSG:4326)',
    emptyBbox: '—, —, —, —',
    crsLabel: 'CRS',
    crsValue: 'EPSG:4326',
    resolutionLabel: 'Resolution',
    outputLabel: 'Output',
    sourceLabel: 'Source',
    sourceRow,
    sourceUnavailable: sourceRow('', 'unavailable'),
  },
  requestGate: {
    title: 'Request ready',
    body: 'Your terrain selection is valid. Review the fixed request values before creating an invoice.',
    paymentNote: 'Invoice: 21 sats, flat — lnurl-wallet is the reference. The demo build takes no payment.',
    invoiceButton: 'Create invoice — next step',
  },
  globe: {
    button: 'Globe',
    title: 'TERR//DVM · GLOBAL EVENT CONSOLE',
    searchPlaceholder: 'locate: wien, funchal, bruneck…',
    booting: '> scanning relays for terrdvm events…',
    empty: '> no events on the wire — place an avatar to light the map',
    locate: (name: string, lat: number, lon: number): string =>
      `> locate ${name} @ ${lat.toFixed(3)},${lon.toFixed(3)}`,
    notFound: (query: string): string => `> not found: ${query}`,
  },
  coverageLegend: {
    covered: (n: CopyValue): string => `${n} cells with 0.25 m/px imagery`,
    gap: (n: CopyValue): string => `${n} land cells with none`,
    none: 'No coverage survey for this region.',
  },
  coverage: {
    outside: (regionName: CopyValue): string =>
      `This service currently covers ${regionName}. Draw inside the region or enter coordinates within it.`,
    activeHeading: (regionName: CopyValue): string => `${regionName} — live imagery`,
    activeBody: 'Orthophoto imagery is live. The map is locked to the configured region.',
  },
  jobFlow: {
    readyTitle: 'Generate terrain',
    readyBody:
      'Review the request below, then start generating. The 21-sat invoice is static in this demo build.',
    startButton: 'Pay 21 sats · Start generating',
    demoRun: (place: string): string => `Demo: ${place}`,
    scoreCaption: 'data score for this selection',
    cancelButton: 'Cancel',
    generatingTitle: 'Preparing your terrain job…',
    generatingBody: 'Fetching elevation tiles and building the mesh for the selected area.',
    previewTitle: 'Terrain preview',
    demoNote:
      'Demo build: payment is skipped and no artifact is delivered. The mesh below is generated live from public elevation data.',
    viewerHint: 'Drag to orbit · scroll to zoom',
    failedTitle: 'Terrain generation failed',
    retryButton: 'Try again',
    closeButton: 'Close',
    areaLabel: 'Area',
    regionLabel: 'Region',
    elevationLabel: 'Elevation',
    trianglesLabel: 'Triangles',
    buildingsLabel: 'Buildings',
    roadsLabel: 'Roads',
    extentLabel: 'Ground extent',
    noBuildings: 'none in view',
    progress: (loaded: CopyValue, total: CopyValue): string =>
      `Elevation tiles ${loaded} of ${total}`,
    progressFeatures: 'Fetching buildings, roads and land cover…',
    progressOrtho: 'Baking the orthophoto — the first run for an area takes a while…',
    progressMount: 'Building the 3D scene…',
    demAttribution: 'Elevation: Mapzen Terrain Tiles via AWS Open Data',
    orthoLabel: 'Orthophoto',
    orthoUnavailable: 'unavailable — elevation shading',
    viewerButton: 'Open viewer',
    viewerCloseButton: 'Close viewer',
    isometricLabel: 'Isometric view',
    pixelLookLabel: 'Pixel look',
    walkLabel: 'Walk (WASD · click to look)',
    avatarLabel: 'Avatar',
    avatarNone: 'No avatar (first person)',
    avatarBuiltin: 'Blocky (built-in)',
    avatarFailed: (name: string): string => `${name}: model format unsupported`,
    crabButton: 'Spawn crab',
    crabRemoveButton: 'Remove crab',
    placeButton: 'Place avatar',
    soundButton: 'Sound',
    placeHereButton: 'Place avatar here',
    placeHereHint: 'Walk somewhere first — your standing spot becomes the placement.',
    placeHint: 'Click the map to choose where the avatar stands.',
    placeTitle: 'Publish placement',
    placeMessageLabel: 'Say where you are',
    placeMessagePlaceholder: 'e.g. On the ridge above Funchal harbour',
    placePublish: 'Sign & publish',
    placePublished: (relays: number): string =>
      `Published to ${relays} relay${relays === 1 ? '' : 's'} ✓`,
    exportMapButton: 'Export map (PNG)',
    layersLabel: 'Layers',
    landcoverLabel: 'Land cover',
    waterwaysLabel: 'Waterways',
    layerMissing: (label: string): string => `${label} — none in view`,
    layerFailed: (label: string): string => `${label} — source did not answer`,
    sourceFailed: 'source did not answer',
    availabilityTitle: 'Data available for this selection',
    availChecking: 'checking…',
    availOffline: 'unknown — collection server offline',
    availNone: 'none in view',
    availWays: (count: number): string => `${count.toLocaleString('en-US')} ways`,
    availTerrain: (zoom: number, mPerPx: number): string =>
      `Mapzen DEM z${zoom} · ~${mPerPx.toFixed(0)} m/px`,
    availOrtho: (name: string, mPerPx: number): string => `${name} · ~${mPerPx} m/px`,
    orthoLine: (name: string, mPerPx: number): string => `${name} · ${mPerPx} m/px`,
    orthoCapped: '(capped — hover for why)',
    buildingsMeasuredNote:
      'Vienna Baukörpermodell: only parts with measured heights (O_KOTE − T_KOTE, ' +
      'clamped 1.5–220 m) are built — parts without a survey height are skipped.',
    imageryAttribution: (attribution: string): string => `Imagery: ${attribution}`,
  },
} as const;

export function errorCopyFor(
  code: Exclude<BBoxErrorCode, 'AREA_LIMIT'>,
): string;
export function errorCopyFor(
  code: 'AREA_LIMIT',
  params: AreaLimitCopyParams,
): string;
export function errorCopyFor(
  code: BBoxErrorCode,
  params?: AreaLimitCopyParams,
): string {
  if (code === 'AREA_LIMIT') {
    if (!params) {
      throw new TypeError('AREA_LIMIT copy requires areaKm2.');
    }
    return COPY.validation.AREA_LIMIT(params);
  }

  return COPY.validation[code];
}
