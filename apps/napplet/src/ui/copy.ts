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
    paymentNote: 'Payment is not connected in this demo. No invoice or terrain artifact is created here.',
    invoiceButton: 'Create invoice — next step',
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
      'Review the request below, then start generating. Payment is skipped in this demo build.',
    startButton: 'Start generating',
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
    demAttribution: 'Elevation: Mapzen Terrain Tiles via AWS Open Data',
    orthoLabel: 'Orthophoto',
    orthoUnavailable: 'unavailable — elevation shading',
    viewerButton: 'Open viewer',
    viewerCloseButton: 'Close viewer',
    orthoLine: (name: string, mPerPx: number): string => `${name} · ${mPerPx} m/px`,
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
