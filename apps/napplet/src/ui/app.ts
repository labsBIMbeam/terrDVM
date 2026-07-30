import { geodesicAreaKm2, validateBBox } from '../bbox/area';
import { buildRequestPreview, type RequestPreviewDTO } from '../bbox/request-preview';
import type { BBox4326 } from '../bbox/validate';
import { errorCopyFor, COPY } from './copy';
import {
  createInitialSelectionState,
  selectionReducer,
  type SelectionState,
} from './selection';
import { createMapView, mapAttribution, type MapView } from '../map/map-view';
import { OUTPUT_MIME, RES_M } from '../config/defaults';
import { getRegion, isWithinRegion, type Region } from '../config/regions';
import {
  createInitialJobFlowState,
  jobFlowReducer,
  type JobFlowState,
} from '../job/job-flow';
import { fetchOrthoTexture, type OrthoMeta, type OrthoTexture } from '../job/ortho';
import { demResolution, runPreflight } from '../job/preflight';
import {
  fetchCharacterBytes,
  fetchCharacterManifest,
  type CharacterEntry,
} from '../job/collection';
import { normalizeCharacter, parseGlb } from '../viewer/glb';
import { generateTerrain, TERRAIN_EXAGGERATION } from '../terrain/generate';
import type { TerrainMesh } from '../terrain/mesh';
import { extrudeFootprints, type BuildingMesh } from '../buildings/extrude';
import { fetchFeatures } from '../features/source-osm';
import { buildLandcoverMesh, type LandcoverMesh } from '../features/landcover';
import { buildRibbonMesh, buildRoadMesh, type RoadMesh } from '../features/ribbon';
import { WATERWAY_WIDTH_M } from '../features/types';
import { createTerrainViewer, type TerrainViewer } from './preview3d';

const AXES = ['west', 'south', 'east', 'north'] as const;
type Axis = (typeof AXES)[number];

/** Human-facing name for the approved imagery role in the source policy. */
const IMAGERY_SOURCE_NAME = 'Esri World Imagery';

/**
 * Nearest-vertex lookup into the generated heightfield, so a footprint can be
 * placed on the terrain surface rather than at datum zero.
 */
function sampleTerrain(mesh: TerrainMesh): (x: number, z: number) => number {
  const { gridN, widthM, depthM } = mesh.stats;
  const stepX = widthM / (gridN - 1);
  const stepZ = depthM / (gridN - 1);
  return (x, z) => {
    const col = Math.min(gridN - 1, Math.max(0, Math.round((x + widthM / 2) / stepX)));
    const row = Math.min(gridN - 1, Math.max(0, Math.round((z + depthM / 2) / stepZ)));
    return mesh.positions[(row * gridN + col) * 3 + 1];
  };
}

export type RenderAppOptions = {
  /** Region id; falls back to the default region when unknown. */
  region?: string;
};


function stateBBox(state: SelectionState): BBox4326 | null {
  if (state.kind === 'SELECTED_VALID' || state.kind === 'SELECTED_INVALID' || state.kind === 'EDITING') {
    return state.bbox;
  }
  if (state.kind === 'DRAWING') {
    return state.bbox;
  }
  if (state.kind === 'CLEARED_UNDOABLE') {
    const previous = state.previous;
    return previous.kind === 'EMPTY' ? null : previous.bbox;
  }
  return null;
}

function previousBBox(state: SelectionState): BBox4326 | null {
  if (state.kind !== 'CLEARED_UNDOABLE') return null;
  const previous = state.previous;
  return previous.kind === 'EMPTY' ? null : previous.bbox;
}


function coordinateLabels(): Record<Axis, string> {
  return { west: 'West (°)', south: 'South (°)', east: 'East (°)', north: 'North (°)' };
}

export function renderApp(root: HTMLDivElement, options: RenderAppOptions = {}): void {
  const region: Region = getRegion(options.region);
  root.innerHTML = `
    <a class="skip-link" href="#request-panel">${COPY.boot.skipToRequestPanel}</a>
    <header class="app-header" aria-label="${COPY.boot.toolbarLabel}">
      <div class="brand">
        <span class="brand-mark" aria-hidden="true"></span>
        <h1 class="app-title">${COPY.boot.appTitle}</h1>
      </div>
      <div class="toolbar" role="toolbar" aria-label="${COPY.boot.toolbarLabel}">
        <button class="button button-primary" id="draw-button" type="button">${COPY.buttons.drawBoundingBox}</button>
        <button class="button" id="stop-drawing-button" type="button" hidden>${COPY.buttons.stopDrawing}</button>
        <button class="button" id="coordinates-button" type="button" aria-expanded="false" aria-controls="coordinates-panel">${COPY.buttons.enterCoordinates}</button>
        <button class="button" id="coverage-button" type="button" aria-pressed="false">${COPY.buttons.showCoverage}</button>
        <button class="button button-danger" id="clear-button" type="button">${COPY.buttons.clearSelection}</button>
      </div>
    </header>
    <div class="workbench">
      <main class="map-region" aria-label="${COPY.boot.mapRegionLabel}">
        <div class="map-shell">
          <div class="map-canvas" id="map-canvas" tabindex="0" role="application" aria-label="${COPY.boot.mapRegionLabel}"></div>
          <section class="source-status" id="source-status" aria-labelledby="source-status-title">
            <h2 class="status-title" id="source-status-title">${COPY.sourceUnavailable.heading}</h2>
            <p>${COPY.sourceUnavailable.body}</p>
          </section>
          <section class="empty-state" id="empty-state" aria-labelledby="empty-state-title">
            <h2 class="empty-state-title" id="empty-state-title">${COPY.emptyState.heading}</h2>
            <p>${COPY.emptyState.body}</p>
          </section>
          <div class="status-alert" id="status-alert" role="alert" hidden></div>
          <div class="undo-toast" id="undo-toast" role="status" hidden>
            <span>${COPY.toast.selectionCleared}</span>
            <button class="button" id="restore-button" type="button">${COPY.buttons.restoreSelection}</button>
          </div>
          <div class="map-attribution" aria-label="Map attribution">${mapAttribution()}</div>
        </div>
        <p class="selection-helper" id="selection-helper">${COPY.helpers.idle}</p>
        <div class="live-announcement" id="live-announcement" aria-live="polite"></div>
      </main>
      <aside class="request-panel" id="request-panel" aria-labelledby="request-panel-title" tabindex="-1">
        <h2 class="panel-title" id="request-panel-title">${COPY.requestPanel.title}</h2>
        <section class="selection-summary" aria-labelledby="selection-summary-title">
          <h3 class="section-title" id="selection-summary-title">Selection</h3>
          <p class="area-readout" id="area-readout"><span class="area-value">—</span> <span>km²</span></p>
        </section>
        <section class="coordinates-panel" id="coordinates-panel" aria-labelledby="coordinates-title" hidden>
          <h3 class="section-title" id="coordinates-title">Coordinates</h3>
          <form id="coordinates-form" novalidate>
            <div class="coordinate-grid">
              ${AXES.map((axis) => `
                <div class="coordinate-field">
                  <label for="coordinate-${axis}">${coordinateLabels()[axis]}</label>
                  <input id="coordinate-${axis}" name="${axis}" inputmode="decimal" autocomplete="off" spellcheck="false" />
                </div>
              `).join('')}
            </div>
            <button class="button button-primary" type="submit">${COPY.buttons.applyCoordinates}</button>
          </form>
        </section>
        <section class="request-preview" aria-labelledby="dto-title">
          <h3 class="section-title" id="dto-title">${COPY.requestPanel.title}</h3>
          <dl class="request-list" id="request-dto">
            <div class="request-row"><dt class="request-label">${COPY.requestPanel.bboxLabel}</dt><dd class="request-value" data-dto="bbox">${COPY.requestPanel.emptyBbox}</dd></div>
            <div class="request-row"><dt class="request-label">${COPY.requestPanel.crsLabel}</dt><dd class="request-value" data-dto="crs">${COPY.requestPanel.crsValue}</dd></div>
            <div class="request-row"><dt class="request-label">Area</dt><dd class="request-value" data-dto="area">—</dd></div>
            <div class="request-row"><dt class="request-label">${COPY.requestPanel.resolutionLabel}</dt><dd class="request-value fixed-default">${COPY.fixedDefaults.resolution}</dd></div>
            <div class="request-row"><dt class="request-label">${COPY.requestPanel.outputLabel}</dt><dd class="request-value fixed-default">${COPY.fixedDefaults.output}</dd></div>
            <div class="request-row"><dt class="request-label">${COPY.requestPanel.sourceLabel}</dt><dd class="request-value" data-dto="source">${COPY.requestPanel.sourceUnavailable}</dd></div>
          </dl>
          <p class="helper-caption">${COPY.fixedDefaults.helperCaption}</p>
        </section>
        <section class="request-action" id="request-action" aria-labelledby="request-action-title" hidden>
          <h3 class="section-title" id="request-action-title">Next step</h3>
          <p class="helper-caption">The selection is valid and ready for request review.</p>
          <button class="button button-primary button-wide" id="continue-request-button" type="button">${COPY.buttons.continueToRequest}</button>
        </section>
      </aside>
    </div>
    <dialog class="job-modal" id="job-modal" aria-label="${COPY.jobFlow.readyTitle}">
      <section class="job-stage" id="job-stage-ready" hidden>
        <h2 class="job-title">${COPY.jobFlow.readyTitle}</h2>
        <p class="job-body">${COPY.jobFlow.readyBody}</p>
        <dl class="job-facts">
          <div class="job-fact"><dt>${COPY.jobFlow.regionLabel}</dt><dd>${region.name}</dd></div>
          <div class="job-fact"><dt>${COPY.jobFlow.areaLabel}</dt><dd id="job-area">—</dd></div>
          <div class="job-fact"><dt>${COPY.requestPanel.resolutionLabel}</dt><dd>${RES_M} m/px</dd></div>
          <div class="job-fact"><dt>${COPY.requestPanel.outputLabel}</dt><dd>${OUTPUT_MIME}</dd></div>
        </dl>
        <h3 class="job-field-label">${COPY.jobFlow.availabilityTitle}</h3>
        <dl class="job-facts">
          <div class="job-fact"><dt>Terrain</dt><dd id="job-avail-terrain">—</dd></div>
          <div class="job-fact"><dt>${COPY.jobFlow.orthoLabel}</dt><dd id="job-avail-ortho">—</dd></div>
          <div class="job-fact"><dt>Streets</dt><dd id="job-avail-streets">—</dd></div>
          <div class="job-fact"><dt>Waterways</dt><dd id="job-avail-water">—</dd></div>
        </dl>
        <div class="job-actions">
          <button class="button button-primary button-wide" id="job-start" type="button">${COPY.jobFlow.startButton}</button>
          <button class="button button-wide" id="job-cancel" type="button">${COPY.jobFlow.cancelButton}</button>
        </div>
      </section>
      <section class="job-stage job-stage-centered" id="job-stage-generating" hidden>
        <div class="job-spinner" aria-hidden="true"></div>
        <h2 class="job-title">${COPY.jobFlow.generatingTitle}</h2>
        <p class="job-body">${COPY.jobFlow.generatingBody}</p>
        <div class="job-progress-track" role="progressbar" aria-labelledby="job-progress">
          <div class="job-progress-fill" id="job-progress-fill"></div>
        </div>
        <p class="job-field-label" id="job-progress"></p>
      </section>
      <section class="job-stage" id="job-stage-preview" hidden>
        <h2 class="job-title">${COPY.jobFlow.previewTitle}</h2>
        <div class="job-viewer">
          <canvas class="job-canvas" id="job-canvas"></canvas>
        </div>
        <p class="job-field-label">${COPY.jobFlow.viewerHint}</p>
        <dl class="job-facts">
          <div class="job-fact"><dt>${COPY.jobFlow.elevationLabel}</dt><dd id="job-elevation">—</dd></div>
          <div class="job-fact"><dt>${COPY.jobFlow.extentLabel}</dt><dd id="job-extent">—</dd></div>
          <div class="job-fact"><dt>${COPY.jobFlow.trianglesLabel}</dt><dd id="job-triangles">—</dd></div>
          <div class="job-fact"><dt>${COPY.jobFlow.buildingsLabel}</dt><dd id="job-buildings">—</dd></div>
          <div class="job-fact"><dt>${COPY.jobFlow.roadsLabel}</dt><dd id="job-roads">—</dd></div>
          <div class="job-fact"><dt>${COPY.jobFlow.orthoLabel}</dt><dd id="job-ortho">—</dd></div>
        </dl>
        <p class="job-body">${COPY.jobFlow.demoNote}</p>
        <p class="job-field-label">${COPY.jobFlow.demAttribution}</p>
        <p class="job-field-label" id="job-imagery-attribution" hidden></p>
        <div class="job-actions">
          <button class="button button-primary button-wide" id="job-open-viewer" type="button">${COPY.jobFlow.viewerButton}</button>
          <button class="button button-wide" id="job-close" type="button">${COPY.jobFlow.closeButton}</button>
        </div>
      </section>
      <section class="job-stage" id="job-stage-failed" hidden>
        <h2 class="job-title">${COPY.jobFlow.failedTitle}</h2>
        <p class="job-warning" id="job-error">—</p>
        <div class="job-actions">
          <button class="button button-primary button-wide" id="job-retry" type="button">${COPY.jobFlow.retryButton}</button>
          <button class="button button-wide" id="job-close-failed" type="button">${COPY.jobFlow.closeButton}</button>
        </div>
      </section>
    </dialog>
    <dialog class="viewer-modal" id="viewer-modal" aria-label="${COPY.jobFlow.previewTitle}">
      <canvas class="viewer-canvas" id="viewer-canvas"></canvas>
      <fieldset class="viewer-layers" id="viewer-layers">
        <legend>${COPY.jobFlow.layersLabel}</legend>
        <label><input type="checkbox" id="viewer-layer-ortho" checked /><span id="viewer-layer-ortho-label">${COPY.jobFlow.orthoLabel}</span></label>
        <label><input type="checkbox" id="viewer-layer-buildings" checked /><span id="viewer-layer-buildings-label">${COPY.jobFlow.buildingsLabel}</span></label>
        <label><input type="checkbox" id="viewer-layer-roads" checked /><span id="viewer-layer-roads-label">${COPY.jobFlow.roadsLabel}</span></label>
        <label><input type="checkbox" id="viewer-layer-landcover" checked /><span id="viewer-layer-landcover-label">${COPY.jobFlow.landcoverLabel}</span></label>
        <label><input type="checkbox" id="viewer-layer-waterways" checked /><span id="viewer-layer-waterways-label">${COPY.jobFlow.waterwaysLabel}</span></label>
        <label><input type="checkbox" id="viewer-isometric" /><span>${COPY.jobFlow.isometricLabel}</span></label>
        <label><input type="checkbox" id="viewer-pixel" /><span>${COPY.jobFlow.pixelLookLabel}</span></label>
        <label><input type="checkbox" id="viewer-walk" /><span>${COPY.jobFlow.walkLabel}</span></label>
        <label class="viewer-avatar-row"><span>${COPY.jobFlow.avatarLabel}</span>
          <select id="viewer-avatar">
            <option value="">${COPY.jobFlow.avatarNone}</option>
            <option value="builtin">${COPY.jobFlow.avatarBuiltin}</option>
          </select>
        </label>
        <button class="button" id="viewer-export" type="button">${COPY.jobFlow.exportMapButton}</button>
      </fieldset>
      <button class="button viewer-modal-close" id="viewer-close" type="button">${COPY.jobFlow.viewerCloseButton}</button>
    </dialog>
  `;

  const mapCanvas = root.querySelector<HTMLDivElement>('#map-canvas');
  const stateAlert = root.querySelector<HTMLDivElement>('#status-alert');
  const announcement = root.querySelector<HTMLDivElement>('#live-announcement');
  const emptyState = root.querySelector<HTMLElement>('#empty-state');
  const helper = root.querySelector<HTMLElement>('#selection-helper');
  const areaReadout = root.querySelector<HTMLElement>('#area-readout');
  const dtoBBox = root.querySelector<HTMLElement>('[data-dto="bbox"]');
  const dtoArea = root.querySelector<HTMLElement>('[data-dto="area"]');
  const coordinatesPanel = root.querySelector<HTMLElement>('#coordinates-panel');
  const coordinatesButton = root.querySelector<HTMLButtonElement>('#coordinates-button');
  const form = root.querySelector<HTMLFormElement>('#coordinates-form');
  const drawButton = root.querySelector<HTMLButtonElement>('#draw-button');
  const stopDrawingButton = root.querySelector<HTMLButtonElement>('#stop-drawing-button');
  const clearButton = root.querySelector<HTMLButtonElement>('#clear-button');
  const coverageButton = root.querySelector<HTMLButtonElement>('#coverage-button');
  const restoreButton = root.querySelector<HTMLButtonElement>('#restore-button');
  const toast = root.querySelector<HTMLElement>('#undo-toast');
  const requestAction = root.querySelector<HTMLElement>('#request-action');
  const continueRequestButton = root.querySelector<HTMLButtonElement>('#continue-request-button');
  const sourceStatus = root.querySelector<HTMLElement>('#source-status');
  const jobModal = root.querySelector<HTMLDialogElement>('#job-modal');
  const jobStages = {
    READY: root.querySelector<HTMLElement>('#job-stage-ready'),
    GENERATING: root.querySelector<HTMLElement>('#job-stage-generating'),
    PREVIEW: root.querySelector<HTMLElement>('#job-stage-preview'),
    FAILED: root.querySelector<HTMLElement>('#job-stage-failed'),
  };
  const jobArea = root.querySelector<HTMLElement>('#job-area');
  const jobAvailTerrain = root.querySelector<HTMLElement>('#job-avail-terrain');
  const jobAvailOrtho = root.querySelector<HTMLElement>('#job-avail-ortho');
  const jobAvailStreets = root.querySelector<HTMLElement>('#job-avail-streets');
  const jobAvailWater = root.querySelector<HTMLElement>('#job-avail-water');
  const jobProgress = root.querySelector<HTMLElement>('#job-progress');
  const jobProgressFill = root.querySelector<HTMLElement>('#job-progress-fill');
  const jobCanvas = root.querySelector<HTMLCanvasElement>('#job-canvas');
  const jobElevation = root.querySelector<HTMLElement>('#job-elevation');
  const jobExtent = root.querySelector<HTMLElement>('#job-extent');
  const jobTriangles = root.querySelector<HTMLElement>('#job-triangles');
  const jobBuildings = root.querySelector<HTMLElement>('#job-buildings');
  const jobRoads = root.querySelector<HTMLElement>('#job-roads');
  const jobOrtho = root.querySelector<HTMLElement>('#job-ortho');
  const jobImageryAttribution = root.querySelector<HTMLElement>('#job-imagery-attribution');
  const jobError = root.querySelector<HTMLElement>('#job-error');
  const jobStart = root.querySelector<HTMLButtonElement>('#job-start');
  const jobCancel = root.querySelector<HTMLButtonElement>('#job-cancel');
  const jobClose = root.querySelector<HTMLButtonElement>('#job-close');
  const jobOpenViewer = root.querySelector<HTMLButtonElement>('#job-open-viewer');
  const viewerModal = root.querySelector<HTMLDialogElement>('#viewer-modal');
  const viewerCanvas = root.querySelector<HTMLCanvasElement>('#viewer-canvas');
  const viewerClose = root.querySelector<HTMLButtonElement>('#viewer-close');
  const viewerLayerOrtho = root.querySelector<HTMLInputElement>('#viewer-layer-ortho');
  const viewerLayerBuildings = root.querySelector<HTMLInputElement>('#viewer-layer-buildings');
  const viewerLayerRoads = root.querySelector<HTMLInputElement>('#viewer-layer-roads');
  const viewerLayerOrthoLabel = root.querySelector<HTMLElement>('#viewer-layer-ortho-label');
  const viewerLayerBuildingsLabel = root.querySelector<HTMLElement>('#viewer-layer-buildings-label');
  const viewerLayerRoadsLabel = root.querySelector<HTMLElement>('#viewer-layer-roads-label');
  const viewerLayerLandcover = root.querySelector<HTMLInputElement>('#viewer-layer-landcover');
  const viewerLayerLandcoverLabel = root.querySelector<HTMLElement>('#viewer-layer-landcover-label');
  const viewerLayerWaterways = root.querySelector<HTMLInputElement>('#viewer-layer-waterways');
  const viewerLayerWaterwaysLabel = root.querySelector<HTMLElement>('#viewer-layer-waterways-label');
  const viewerIsometric = root.querySelector<HTMLInputElement>('#viewer-isometric');
  const viewerPixel = root.querySelector<HTMLInputElement>('#viewer-pixel');
  const viewerWalk = root.querySelector<HTMLInputElement>('#viewer-walk');
  const viewerAvatar = root.querySelector<HTMLSelectElement>('#viewer-avatar');
  const viewerExport = root.querySelector<HTMLButtonElement>('#viewer-export');
  const jobCloseFailed = root.querySelector<HTMLButtonElement>('#job-close-failed');
  const jobRetry = root.querySelector<HTMLButtonElement>('#job-retry');

  if (!mapCanvas || !stateAlert || !announcement || !emptyState || !helper || !areaReadout ||
      !dtoBBox || !dtoArea || !coordinatesPanel || !coordinatesButton || !form || !drawButton ||
      !stopDrawingButton || !clearButton || !coverageButton || !restoreButton || !toast || !requestAction ||
      !continueRequestButton || !sourceStatus || !jobModal ||
      !jobStages.READY || !jobStages.GENERATING || !jobStages.PREVIEW || !jobStages.FAILED ||
      !jobArea || !jobAvailTerrain || !jobAvailOrtho || !jobAvailStreets || !jobAvailWater ||
      !jobProgress || !jobProgressFill || !jobCanvas || !jobElevation || !jobExtent || !jobTriangles ||
      !jobBuildings || !jobRoads || !jobOrtho || !jobImageryAttribution ||
      !jobError || !jobStart || !jobCancel || !jobClose || !jobCloseFailed || !jobRetry ||
      !jobOpenViewer || !viewerModal || !viewerCanvas || !viewerClose ||
      !viewerLayerOrtho || !viewerLayerBuildings || !viewerLayerRoads ||
      !viewerLayerOrthoLabel || !viewerLayerBuildingsLabel || !viewerLayerRoadsLabel ||
      !viewerLayerLandcover || !viewerLayerLandcoverLabel ||
      !viewerLayerWaterways || !viewerLayerWaterwaysLabel ||
      !viewerIsometric || !viewerPixel || !viewerWalk || !viewerAvatar || !viewerExport) {
    throw new Error('Incomplete terrDVM UI scaffold.');
  }

  let state: SelectionState = createInitialSelectionState();
  let toastTimer: ReturnType<typeof setTimeout> | undefined;
  let toastDeadline = 0;
  let toastRemaining = 0;
  let toastPaused = false;
  let mapView: MapView;

  const field = (axis: Axis): HTMLInputElement => {
    const input = root.querySelector<HTMLInputElement>(`#coordinate-${axis}`);
    if (!input) throw new Error(`Missing ${axis} coordinate field.`);
    return input;
  };

  const announce = (text: string): void => {
    announcement.textContent = text;
  };

  const alert = (text: string): void => {
    stateAlert.textContent = text;
    stateAlert.hidden = text.length === 0;
  };

  const syncFields = (bbox: BBox4326 | null): void => {
    if (!bbox) return;
    AXES.forEach((axis, index) => {
      field(axis).value = bbox[index].toFixed(6);
    });
  };

  // Starts unavailable and only flips once a tile has actually arrived, so a
  // capability-denied shell never sees a "live" claim.
  let previewSource: RequestPreviewDTO['source'] = { name: '', suffix: 'unavailable' };
  let jobState: JobFlowState = createInitialJobFlowState();
  let terrainAbort: AbortController | undefined;
  let viewer: TerrainViewer | undefined;
  let buildingCount = 0;
  let roadCount = 0;
  let featuresFailed = false;
  let orthoMeta: OrthoMeta | null = null;
  // The generated scene, kept for the fullscreen viewer to remount.
  let lastScene: {
    mesh: TerrainMesh;
    buildings?: BuildingMesh;
    roads?: RoadMesh;
    landcover?: LandcoverMesh;
    waterways?: RoadMesh;
    ortho?: TexImageSource;
    featuresFailed: boolean;
  } | null = null;
  let fullViewer: TerrainViewer | undefined;

  const destroyViewer = (): void => {
    viewer?.destroy();
    viewer = undefined;
  };

  const closeFullViewer = (): void => {
    fullViewer?.destroy();
    fullViewer = undefined;
    if (viewerModal.open) viewerModal.close();
  };

  const renderJobFlow = (): void => {
    (Object.keys(jobStages) as (keyof typeof jobStages)[]).forEach((stage) => {
      const section = jobStages[stage];
      if (section) section.hidden = jobState.kind !== stage;
    });

    if (jobState.kind === 'CLOSED') {
      if (jobModal.open) jobModal.close();
      return;
    }

    if (jobState.kind === 'READY') {
      jobArea.textContent = `${jobState.areaKm2.toLocaleString('en-US', {
        minimumFractionDigits: 1,
        maximumFractionDigits: 1,
      })} km²`;
    }

    // GENERATING progress is driven directly by setGenProgress: the pipeline
    // has more phases (features, ortho bake, mount) than the reducer knows.

    if (jobState.kind === 'PREVIEW') {
      const { stats } = jobState.mesh;
      jobElevation.textContent = `${Math.round(stats.minElevationM)}–${Math.round(stats.maxElevationM)} m`;
      jobExtent.textContent = `${(stats.widthM / 1000).toFixed(1)} × ${(stats.depthM / 1000).toFixed(1)} km`;
      jobTriangles.textContent = stats.triangles.toLocaleString('en-US');
      // "Zero features" and "the source did not answer" are different facts;
      // conflating them turns an outage into a claim about the area.
      const absentLabel = featuresFailed ? COPY.jobFlow.sourceFailed : COPY.jobFlow.noBuildings;
      jobBuildings.textContent = buildingCount > 0
        ? buildingCount.toLocaleString('en-US')
        : absentLabel;
      jobRoads.textContent = roadCount > 0 ? roadCount.toLocaleString('en-US') : absentLabel;
      jobOrtho.textContent = orthoMeta
        ? COPY.jobFlow.orthoLine(orthoMeta.source.name, orthoMeta.mPerPx)
        : COPY.jobFlow.orthoUnavailable;
      // Attribution is a licence obligation wherever imagery is shown, so the
      // line appears exactly when a texture is draped.
      jobImageryAttribution.hidden = orthoMeta === null;
      jobImageryAttribution.textContent = orthoMeta
        ? COPY.jobFlow.imageryAttribution(orthoMeta.source.attribution)
        : '';
    }

    if (jobState.kind === 'FAILED') {
      jobError.textContent = jobState.message;
    }

    if (!jobModal.open) jobModal.showModal();
  };

  const dispatchJob = (action: Parameters<typeof jobFlowReducer>[1]): void => {
    const next = jobFlowReducer(jobState, action);
    if (next === jobState) return;
    jobState = next;
    renderJobFlow();
  };

  const closeJobFlow = (): void => {
    terrainAbort?.abort();
    terrainAbort = undefined;
    preflightAbort?.abort();
    preflightAbort = undefined;
    closeFullViewer();
    destroyViewer();
    dispatchJob({ type: 'CLOSE' });
  };

  // One bar across the whole pipeline. The ortho bake has no incremental
  // signal, so its span creeps on a slow CSS transition instead of freezing.
  const setGenProgress = (fraction: number, label: string, creep = false): void => {
    jobProgressFill.style.transition = creep ? 'width 20s ease-out' : 'width 0.3s ease';
    jobProgressFill.style.width = `${Math.round(fraction * 100)}%`;
    jobProgress.textContent = label;
  };

  const runTerrainJob = (bbox: BBox4326): void => {
    terrainAbort?.abort();
    const controller = new AbortController();
    terrainAbort = controller;
    setGenProgress(0.03, '');

    // The orthophoto bake runs beside the terrain fetch. Like buildings it is
    // an enhancement, never a gate: without a collection server the preview
    // ships with the elevation ramp and says so.
    const orthoPromise: Promise<OrthoTexture | null> = fetchOrthoTexture(region.id, bbox, {
      signal: controller.signal,
    }).catch(() => null);

    generateTerrain(bbox, {
      signal: controller.signal,
      onProgress: (progress) => {
        if (controller.signal.aborted) return;
        setGenProgress(
          0.05 + 0.4 * (progress.total > 0 ? progress.loaded / progress.total : 0),
          COPY.jobFlow.progress(progress.loaded, progress.total),
        );
      },
    })
      .then(async (mesh) => {
        if (controller.signal.aborted) return;
        setGenProgress(0.5, COPY.jobFlow.progressFeatures);

        // Buildings are an enhancement, never a gate: if the footprint source
        // is slow, blocked or empty, the terrain still ships.
        let buildings: BuildingMesh | undefined;
        let roads: RoadMesh | undefined;
        let landcover: LandcoverMesh | undefined;
        let waterways: RoadMesh | undefined;
        let featuresOk = true;
        try {
          const features = await fetchFeatures(bbox, { signal: controller.signal });
          const ground = sampleTerrain(mesh);
          if (features.buildings.length > 0) {
            // The ground sample comes from the exaggerated terrain, so building
            // heights must take the same vertical scale or they sit squashed
            // against the relief.
            buildings = extrudeFootprints(
              features.buildings.map((f) => ({
                ...f,
                heightM: f.heightM * TERRAIN_EXAGGERATION,
              })),
              bbox,
              ground,
            );
          }
          if (features.roads.length > 0) {
            roads = buildRoadMesh(features.roads, bbox, ground, TERRAIN_EXAGGERATION);
          }
          if (features.landuse.length > 0) {
            landcover = buildLandcoverMesh(features.landuse, bbox, ground, TERRAIN_EXAGGERATION);
            if (landcover.classes.length === 0) landcover = undefined;
          }
          if (features.waterways.length > 0) {
            // Below the road lift so bridges keep winning at crossings.
            waterways = buildRibbonMesh(
              features.waterways.map((w) => ({ line: w.line, widthM: WATERWAY_WIDTH_M[w.waterwayClass] })),
              bbox,
              ground,
              TERRAIN_EXAGGERATION,
              0.8,
            );
            if (waterways.indices.length === 0) waterways = undefined;
          }
        } catch {
          buildings = undefined;
          roads = undefined;
          landcover = undefined;
          waterways = undefined;
          featuresOk = false;
        }
        if (!controller.signal.aborted) setGenProgress(0.95, COPY.jobFlow.progressOrtho, true);
        const ortho = await orthoPromise;
        if (controller.signal.aborted) return;
        setGenProgress(1, COPY.jobFlow.progressMount);

        // Reveal the preview stage first so the canvas has layout, then mount
        // synchronously — deferring to rAF would never run while the page is
        // backgrounded or not compositing.
        dispatchJob({ type: 'TERRAIN_READY', mesh });
        buildingCount = buildings?.stats.footprints ?? 0;
        roadCount = roads?.stats.roads ?? 0;
        featuresFailed = !featuresOk;
        orthoMeta = ortho?.meta ?? null;
        lastScene = {
          mesh,
          buildings,
          roads,
          landcover,
          waterways,
          ortho: ortho?.bitmap,
          featuresFailed: !featuresOk,
        };
        renderJobFlow();
        destroyViewer();
        try {
          viewer = createTerrainViewer(jobCanvas, mesh, {
            buildings,
            roads,
            landcover,
            waterways,
            ortho: ortho?.bitmap,
          });
        } catch (error) {
          announce(error instanceof Error ? error.message : 'The 3D preview is unavailable.');
        }
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        dispatchJob({
          type: 'FAIL',
          message: error instanceof Error ? error.message : 'Terrain generation failed.',
        });
      });
  };

  const updateView = (): void => {
    const bbox = stateBBox(state);
    const isCleared = state.kind === 'CLEARED_UNDOABLE';
    const area = state.kind === 'SELECTED_VALID'
      ? state.areaKm2
      : state.kind === 'SELECTED_INVALID' || state.kind === 'EDITING'
        ? geodesicAreaKm2(state.bbox)
        : null;

    root.dataset.selectionState = state.kind;
    root.dataset.selectionCount = bbox && !isCleared ? '1' : '0';
    emptyState.hidden = Boolean(bbox && !isCleared);
    requestAction.hidden = state.kind !== 'SELECTED_VALID';
    if (state.kind !== 'SELECTED_VALID' && jobState.kind !== 'CLOSED') closeJobFlow();
    stopDrawingButton.hidden = state.kind !== 'DRAWING';
    drawButton.hidden = state.kind === 'DRAWING';
    helper.textContent = state.kind === 'DRAWING'
      ? COPY.helpers.drawPointer
      : bbox && !isCleared
        ? COPY.helpers.editSelection
        : COPY.helpers.idle;
    areaReadout.innerHTML = area === null
      ? '<span class="area-value">—</span> <span>km²</span>'
      : `<span class="area-value">${area.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}</span> <span>km²</span>`;

    const sourceCell = root.querySelector<HTMLElement>('[data-dto="source"]');
    if (sourceCell) {
      sourceCell.textContent = COPY.requestPanel.sourceRow(
        previewSource.name,
        previewSource.suffix,
      );
    }

    if (state.kind === 'SELECTED_VALID') {
      const preview = buildRequestPreview(state.bbox, state.areaKm2, {
        kind: previewSource.suffix === 'live' ? 'live' : 'none',
        name: previewSource.name,
      });
      dtoBBox.textContent = preview.bbox.map((coordinate) => coordinate.display).join(', ');
      dtoArea.textContent = `${preview.areaKm2.display} km²`;
      syncFields(state.bbox);
      announce(`Bounding box set. West ${preview.bbox[0].display}, south ${preview.bbox[1].display}, east ${preview.bbox[2].display}, north ${preview.bbox[3].display}. Area ${preview.areaKm2.display} square kilometers.`);
    } else if (state.kind === 'SELECTED_INVALID') {
      syncFields(state.bbox);
      alert(state.error);
    } else if (state.kind === 'EMPTY') {
      dtoBBox.textContent = COPY.requestPanel.emptyBbox;
      dtoArea.textContent = '—';
    }
  };

  const scheduleToastExpiry = (): void => {
    if (toastPaused || toastRemaining <= 0) return;
    toastDeadline = Date.now() + toastRemaining;
    toastTimer = setTimeout(() => {
      state = selectionReducer(state, { type: 'EXPIRE', now: Date.now() });
      toast.hidden = true;
      mapView.clearSelection();
      toastRemaining = 0;
      updateView();
      announce('Selection cleared.');
    }, toastRemaining);
  };

  const showToast = (): void => {
    toast.hidden = false;
    toastRemaining = 10_000;
    scheduleToastExpiry();
  };

  const pauseToast = (): void => {
    if (toast.hidden || toastPaused) return;
    toastPaused = true;
    if (toastTimer) clearTimeout(toastTimer);
    toastRemaining = Math.max(0, toastDeadline - Date.now());
  };

  const resumeToast = (): void => {
    if (toast.hidden || !toastPaused) return;
    toastPaused = false;
    scheduleToastExpiry();
  };

  toast.addEventListener('mouseenter', pauseToast);
  toast.addEventListener('mouseleave', resumeToast);
  toast.addEventListener('focusin', pauseToast);
  toast.addEventListener('focusout', resumeToast);
  drawButton.addEventListener('click', () => {
    state = selectionReducer(state, { type: 'DRAW_START' });
    mapView.armDrawing();
    alert('');
    updateView();
  });
  stopDrawingButton.addEventListener('click', () => {
    state = selectionReducer(state, { type: 'DRAW_CANCEL' });
    mapView.stopDrawing();
    updateView();
  });
  mapCanvas.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && state.kind === 'DRAWING') {
      state = selectionReducer(state, { type: 'DRAW_CANCEL' });
      mapView.stopDrawing();
      updateView();
    }
  });
  coordinatesButton.addEventListener('click', () => {
    const expanded = coordinatesButton.getAttribute('aria-expanded') === 'true';
    coordinatesButton.setAttribute('aria-expanded', String(!expanded));
    coordinatesPanel.hidden = expanded;
    if (!expanded) field('west').focus();
  });
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const raw = AXES.map((axis) => {
      const value = field(axis).value.trim();
      return value.length === 0 ? Number.NaN : Number(value);
    });
    const result = validateBBox(raw);
    if (!result.ok) {
      const message = result.code === 'AREA_LIMIT'
        ? errorCopyFor('AREA_LIMIT', { areaKm2: geodesicAreaKm2(raw as unknown as BBox4326) })
        : errorCopyFor(result.code);
      alert(message);
      announce(message);
      return;
    }
    if (!isWithinRegion(region, result.bbox)) {
      alert(COPY.coverage.outside(region.name));
      announce(COPY.coverage.outside(region.name));
      return;
    }
    state = selectionReducer(state, { type: 'APPLY_COORDINATES', bbox: result.bbox });
    mapView.setSelection(result.bbox);
    alert('');
    updateView();
    openJobFlow();
  });
  coverageButton.addEventListener('click', () => {
    const visible = mapView.toggleCoverage();
    coverageButton.setAttribute('aria-pressed', String(visible));
    const summary = mapView.coverageSummary();
    if (!summary) {
      announce(COPY.coverageLegend.none);
    } else if (visible) {
      announce(
        `${COPY.coverageLegend.covered(summary.covered)}, ` +
          `${COPY.coverageLegend.gap(summary.gap)}.`,
      );
    }
  });
  clearButton.addEventListener('click', () => {
    const next = selectionReducer(state, { type: 'CLEAR', now: Date.now() });
    if (next !== state) {
      state = next;
      mapView.clearSelection();
      showToast();
      announce(COPY.toast.selectionCleared);
      updateView();
    }
  });
  restoreButton.addEventListener('click', () => {
    const restoredBBox = previousBBox(state);
    const next = selectionReducer(state, { type: 'RESTORE', now: Date.now() });
    if (next !== state) {
      state = next;
      if (restoredBBox) mapView.setSelection(restoredBBox);
      toast.hidden = true;
      toastRemaining = 0;
      if (toastTimer) clearTimeout(toastTimer);
      announce('Selection restored.');
      updateView();
    }
  });
  let preflightAbort: AbortController | undefined;

  // Answer "what data exists here?" before the user commits to generating.
  // Every row fails closed to a named state rather than an optimistic guess.
  const showPreflight = (bbox: BBox4326): void => {
    preflightAbort?.abort();
    const controller = new AbortController();
    preflightAbort = controller;

    const { zoom, mPerPx } = demResolution(bbox);
    jobAvailTerrain.textContent = COPY.jobFlow.availTerrain(zoom, mPerPx);
    jobAvailOrtho.textContent = COPY.jobFlow.availChecking;
    jobAvailStreets.textContent = COPY.jobFlow.availChecking;
    jobAvailWater.textContent = COPY.jobFlow.availChecking;

    runPreflight(region.id, bbox, { signal: controller.signal }).then((report) => {
      if (controller.signal.aborted) return;
      jobAvailOrtho.textContent = report.ortho
        ? COPY.jobFlow.availOrtho(report.ortho.sourceName, report.ortho.mPerPx)
        : COPY.jobFlow.availOffline;
      jobAvailOrtho.title = report.ortho?.notes.join('; ') ?? '';
      jobAvailStreets.textContent = report.streets === null
        ? COPY.jobFlow.availOffline
        : report.streets === 0
          ? COPY.jobFlow.availNone
          : COPY.jobFlow.availWays(report.streets);
      jobAvailWater.textContent = report.waterways === null
        ? COPY.jobFlow.availOffline
        : report.waterways === 0
          ? COPY.jobFlow.availNone
          : COPY.jobFlow.availWays(report.waterways);
    });
  };

  const openJobFlow = (): void => {
    if (state.kind !== 'SELECTED_VALID') return;
    dispatchJob({ type: 'OPEN', bbox: state.bbox, areaKm2: state.areaKm2 });
    showPreflight(state.bbox);
    announce(COPY.jobFlow.readyTitle);
  };

  continueRequestButton.addEventListener('click', openJobFlow);
  jobCancel.addEventListener('click', closeJobFlow);
  jobClose.addEventListener('click', closeJobFlow);
  jobCloseFailed.addEventListener('click', closeJobFlow);

  // A missing layer stays listed but disabled: "no buildings arrived" is
  // information the user should see, not an absence to guess about.
  const syncViewerLayerControls = (): void => {
    const layers = [
      [viewerLayerOrtho, viewerLayerOrthoLabel, COPY.jobFlow.orthoLabel, Boolean(lastScene?.ortho)],
      [
        viewerLayerBuildings,
        viewerLayerBuildingsLabel,
        COPY.jobFlow.buildingsLabel,
        Boolean(lastScene?.buildings),
      ],
      [viewerLayerRoads, viewerLayerRoadsLabel, COPY.jobFlow.roadsLabel, Boolean(lastScene?.roads)],
      [
        viewerLayerLandcover,
        viewerLayerLandcoverLabel,
        COPY.jobFlow.landcoverLabel,
        Boolean(lastScene?.landcover),
      ],
      [
        viewerLayerWaterways,
        viewerLayerWaterwaysLabel,
        COPY.jobFlow.waterwaysLabel,
        Boolean(lastScene?.waterways),
      ],
    ] as const;
    for (const [input, label, name, available] of layers) {
      input.disabled = !available;
      input.checked = available;
      label.textContent = available ? name : COPY.jobFlow.layerMissing(name);
    }
  };

  jobOpenViewer.addEventListener('click', () => {
    if (!lastScene || viewerModal.open) return;
    viewerModal.showModal();
    syncViewerLayerControls();
    viewerIsometric.checked = false;
    viewerPixel.checked = false;
    viewerWalk.checked = false;
    viewerAvatar.value = '';
    try {
      fullViewer = createTerrainViewer(viewerCanvas, lastScene.mesh, {
        buildings: lastScene.buildings,
        roads: lastScene.roads,
        landcover: lastScene.landcover,
        waterways: lastScene.waterways,
        ortho: lastScene.ortho,
        autoRotate: false,
        intro: true,
      });
      void populateAvatarChoices();
    } catch (error) {
      closeFullViewer();
      announce(error instanceof Error ? error.message : 'The 3D preview is unavailable.');
    }
  });

  // Named avatars the collection server holds; fetched once per session.
  let avatarManifest: CharacterEntry[] | null = null;
  const populateAvatarChoices = async (): Promise<void> => {
    if (avatarManifest === null) {
      avatarManifest = await fetchCharacterManifest().catch(() => []);
    }
    for (const entry of avatarManifest) {
      if (viewerAvatar.querySelector(`option[value="${entry.sha256}"]`)) continue;
      const option = document.createElement('option');
      option.value = entry.sha256;
      option.textContent = entry.name;
      viewerAvatar.append(option);
    }
  };

  viewerAvatar.addEventListener('change', () => {
    const choice = viewerAvatar.value;
    if (!choice) {
      fullViewer?.setCharacter(null);
      return;
    }
    const label = viewerAvatar.selectedOptions[0]?.textContent ?? choice;
    void fetchCharacterBytes(choice === 'builtin' ? undefined : choice)
      .then((bytes) => {
        fullViewer?.setCharacter(normalizeCharacter(parseGlb(bytes)));
      })
      .catch(() => {
        // Draco-compressed or missing models fail closed with a name.
        announce(COPY.jobFlow.avatarFailed(label));
        viewerAvatar.value = '';
        fullViewer?.setCharacter(null);
      });
  });
  viewerLayerOrtho.addEventListener('change', () => {
    fullViewer?.setLayerVisible('ortho', viewerLayerOrtho.checked);
  });
  viewerLayerBuildings.addEventListener('change', () => {
    fullViewer?.setLayerVisible('buildings', viewerLayerBuildings.checked);
  });
  viewerLayerRoads.addEventListener('change', () => {
    fullViewer?.setLayerVisible('roads', viewerLayerRoads.checked);
  });
  viewerLayerLandcover.addEventListener('change', () => {
    fullViewer?.setLayerVisible('landcover', viewerLayerLandcover.checked);
  });
  viewerLayerWaterways.addEventListener('change', () => {
    fullViewer?.setLayerVisible('waterways', viewerLayerWaterways.checked);
  });
  viewerIsometric.addEventListener('change', () => {
    fullViewer?.setProjection(viewerIsometric.checked ? 'isometric' : 'perspective');
    // The game look is the point of the isometric mode, so it comes along by
    // default — and stays a separate switch for anyone who wants clean lines.
    if (viewerIsometric.checked && !viewerPixel.checked) {
      viewerPixel.checked = true;
      fullViewer?.setPixelLook(true);
    }
  });
  viewerPixel.addEventListener('change', () => {
    fullViewer?.setPixelLook(viewerPixel.checked);
  });
  viewerWalk.addEventListener('change', () => {
    fullViewer?.setWalkMode(viewerWalk.checked);
  });
  viewerExport.addEventListener('click', () => {
    void fullViewer?.exportImage().then((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = 'terrdvm-map.png';
      anchor.click();
      URL.revokeObjectURL(url);
    });
  });
  viewerClose.addEventListener('click', () => viewerModal.close());
  // Covers Escape as well: the native close event is the single teardown path.
  viewerModal.addEventListener('close', () => {
    fullViewer?.destroy();
    fullViewer = undefined;
  });
  // Escape (native dialog close) must reset the gate, not leave it mid-flight.
  jobModal.addEventListener('close', () => {
    if (jobState.kind !== 'CLOSED') closeJobFlow();
    continueRequestButton.focus();
  });

  const startTerrainJob = (): void => {
    if (jobState.kind !== 'READY') return;
    const { bbox } = jobState;
    dispatchJob({ type: 'START_GENERATING' });
    announce(COPY.jobFlow.generatingTitle);
    runTerrainJob(bbox);
  };

  jobStart.addEventListener('click', startTerrainJob);
  jobRetry.addEventListener('click', () => {
    dispatchJob({ type: 'RETRY' });
    startTerrainJob();
  });

  try {
    mapView = createMapView(mapCanvas, {
      onDrawComplete: (bbox) => {
        state = selectionReducer(state, { type: 'DRAW_COMPLETE', bbox });
        alert('');
        updateView();
        openJobFlow();
      },
      onEditStart: () => {
        state = selectionReducer(state, { type: 'EDIT_START' });
        updateView();
      },
      onEditComplete: (bbox) => {
        state = selectionReducer(state, { type: 'EDIT_COMPLETE', bbox });
        updateView();
      },
      onMapError: () => {
        // Tile capability failures are intentionally non-fatal. The source status
        // remains truthful while the selection and coordinate path stay usable.
        announce(COPY.sourceUnavailable.body);
      },
      onSourceActive: (role) => {
        if (role !== 'imagery') return;
        previewSource = { name: IMAGERY_SOURCE_NAME, suffix: 'live' };
        sourceStatus.querySelector('.status-title')!.textContent = COPY.coverage.activeHeading(region.name);
        sourceStatus.querySelector('p')!.textContent = COPY.coverage.activeBody;
        sourceStatus.dataset.state = 'live';
        updateView();
      },
    }, region);
  } catch (error) {
    mapView = {
      toggleCoverage: () => false,
      coverageSummary: () => null,
      armDrawing: () => undefined,
      stopDrawing: () => undefined,
      setSelection: () => undefined,
      clearSelection: () => undefined,
      destroy: () => undefined,
    };
    announce(error instanceof Error ? error.message : COPY.sourceUnavailable.body);
  }

  updateView();
}
