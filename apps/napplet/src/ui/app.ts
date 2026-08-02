import { geodesicAreaKm2, validateBBox } from '@terrcvm/terrain-engine/bbox/area';
import { buildRequestPreview, type RequestPreviewDTO } from '@terrcvm/terrain-engine/bbox/request-preview';
import type { BBox4326 } from '@terrcvm/terrain-engine/bbox/validate';
import { errorCopyFor, COPY } from './copy';
import {
  createInitialSelectionState,
  selectionReducer,
  type SelectionState,
} from './selection';
import { createMapView, mapAttribution, type MapView } from '../map/map-view';
import { OUTPUT_MIME, RES_M } from '@terrcvm/terrain-engine/config/defaults';
import { getRegion, isWithinRegion, type Region } from '@terrcvm/terrain-engine/config/regions';
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
  fetchPlacements,
  type CharacterEntry,
} from '../job/collection';
import { projector } from '@terrcvm/terrain-engine/buildings/extrude';
import { COLLECTION_SERVICE } from '../job/collection';
import {
  buildCalendarEvent,
  buildPlacementEvent,
  buildPresenceEvent,
  signAndPublish,
} from '../nostr/publish';
import { fetchGeoNotes, fetchGlobalPresences, fetchPresences } from '../nostr/presence';
import { createMatrixGlobe, type MatrixGlobe } from './globe';
import {
  INTRO_MAX_MS,
  hasEnteredThisSession,
  markEnteredThisSession,
  playIntro,
  prefersReducedMotion,
} from './intro';
import cities from '@terrcvm/terrain-engine/config/cities.json';
import { normalizeCharacter, normalizeCharacterFrames, parseGlb } from '@terrcvm/terrain-engine/viewer/glb';
import { sound } from './sound';
import { generateTerrain, TERRAIN_EXAGGERATION } from '../terrain/generate';
import type { TerrainMesh } from '@terrcvm/terrain-engine/terrain/mesh';
import { extrudeFootprints, type BuildingMesh, type Footprint } from '@terrcvm/terrain-engine/buildings/extrude';
import { createGroundSampler, type GroundSampler } from '@terrcvm/terrain-engine/buildings/ground';
import { WIEN_BUILDINGS_ATTRIBUTION, fetchWienBuildings } from '../buildings/source-wien';
import { fetchFeatures } from '../features/source-osm';
import { buildLandcoverMesh, type LandcoverMesh } from '@terrcvm/terrain-engine/features/landcover';
import { buildRibbonMesh, buildRoadMesh, type RoadMesh } from '@terrcvm/terrain-engine/features/ribbon';
import { WATERWAY_WIDTH_M } from '@terrcvm/terrain-engine/features/types';
import { createTerrainViewer, type TerrainViewer, type ViewerModel } from '@terrcvm/terrain-engine/render/preview3d';

const AXES = ['west', 'south', 'east', 'north'] as const;
type Axis = (typeof AXES)[number];

/** Human-facing name for the approved imagery role in the source policy. */
const IMAGERY_SOURCE_NAME = 'Esri World Imagery';

/** Avatars stand as 21 m giants, visible clear across a selection. */
const GIANT_HEIGHT_M = 21;

/** Parse a GLB, normalise it to height, and decode its painted skin. */
async function toViewerModel(bytes: ArrayBuffer, heightM: number): Promise<ViewerModel> {
  const mesh = normalizeCharacter(parseGlb(bytes), heightM);
  const texture = mesh.texture
    ? await createImageBitmap(
        new Blob([mesh.texture.bytes], { type: mesh.texture.mimeType }),
      ).catch(() => null)
    : null;
  return { ...mesh, texture };
}

/**
 * Nearest-vertex lookup into the generated heightfield, so a footprint can be
 * placed on the terrain surface rather than at datum zero.
 *
 * The surface model is not guessed here. `generateTerrain` walks a fallback
 * chain and does not yet report which source actually answered, so asking the
 * registry for the *preferred* source would claim bare earth on a run that
 * quietly demoted to Terrarium — a fabricated provenance, which is worse than
 * none. Until the terrain layer returns the source it used, this reports
 * `'unknown'`, which the engine treats exactly as harshly as a DSM: geometry
 * still renders, and it renders labelled.
 */
function sampleTerrain(mesh: TerrainMesh): GroundSampler {
  const { gridN, widthM, depthM } = mesh.stats;
  const stepX = widthM / (gridN - 1);
  const stepZ = depthM / (gridN - 1);
  return createGroundSampler({
    sample: (x, z) => {
      const col = Math.min(gridN - 1, Math.max(0, Math.round((x + widthM / 2) / stepX)));
      const row = Math.min(gridN - 1, Math.max(0, Math.round((z + depthM / 2) / stepZ)));
      return mesh.positions[(row * gridN + col) * 3 + 1];
    },
    model: 'unknown',
    sourceId: 'unreported',
    onNonBareEarth: 'render-indicative',
  });
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
        <button class="button" id="demo-button" type="button" hidden></button>
        <button class="button" id="stop-drawing-button" type="button" hidden>${COPY.buttons.stopDrawing}</button>
        <button class="button" id="coordinates-button" type="button" aria-expanded="false" aria-controls="coordinates-panel">${COPY.buttons.enterCoordinates}</button>
        <button class="button" id="coverage-button" type="button" aria-pressed="false">${COPY.buttons.showCoverage}</button>
        <button class="button" id="place-avatar-button" type="button">${COPY.jobFlow.placeButton}</button>
        <button class="button" id="sound-button" type="button" aria-pressed="true">${COPY.jobFlow.soundButton}</button>
        <button class="button" id="globe-button" type="button">${COPY.globe.button}</button>
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
        <div class="job-score" id="job-score">
          <span class="job-score-dot" id="job-score-dot" aria-hidden="true"></span>
          <span class="job-score-value" id="job-score-value">—</span>
          <span class="job-score-caption">${COPY.jobFlow.scoreCaption}</span>
        </div>
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
        <p class="job-field-label" id="job-buildings-attribution" hidden></p>
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
    <dialog class="job-modal" id="place-modal" aria-label="${COPY.jobFlow.placeTitle}">
      <section class="job-stage">
        <h2 class="job-title">${COPY.jobFlow.placeTitle}</h2>
        <label class="viewer-avatar-row"><span>${COPY.jobFlow.avatarLabel}</span>
          <select id="place-character"></select>
        </label>
        <dl class="job-facts">
          <div class="job-fact"><dt>Position</dt><dd id="place-position">—</dd></div>
        </dl>
        <label class="viewer-avatar-row"><span>${COPY.jobFlow.placeMessageLabel}</span>
          <input id="place-message" type="text" maxlength="140"
            placeholder="${COPY.jobFlow.placeMessagePlaceholder}" />
        </label>
        <label class="viewer-avatar-row"><span>${COPY.jobFlow.placeVenueLabel}</span>
          <input id="place-venue" type="text" maxlength="120"
            placeholder="${COPY.jobFlow.placeVenuePlaceholder}" />
        </label>
        <label class="viewer-avatar-row"><span>${COPY.jobFlow.placeWhenLabel}</span>
          <input id="place-when" type="datetime-local" step="300" />
        </label>
        <label class="viewer-avatar-row"><span>Heading °</span>
          <input id="place-heading" type="number" value="0" min="0" max="359" step="5" />
        </label>
        <p class="job-field-label" id="place-status"></p>
        <div class="job-actions">
          <button class="button button-primary button-wide" id="place-publish" type="button">${COPY.jobFlow.placePublish}</button>
          <button class="button button-wide" id="place-cancel" type="button">${COPY.jobFlow.cancelButton}</button>
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
        <button class="button" id="viewer-crab" type="button">${COPY.jobFlow.crabButton}</button>
        <button class="button" id="viewer-place-here" type="button">${COPY.jobFlow.placeHereButton}</button>
      </fieldset>
      <button class="button viewer-modal-close" id="viewer-close" type="button">${COPY.jobFlow.viewerCloseButton}</button>
    </dialog>
    <div class="globe-console" id="globe-console" hidden>
      <header class="globe-head">
        <span class="globe-title">${COPY.globe.title}</span>
        <button class="button globe-close" id="globe-close" type="button">${COPY.globe.enter}</button>
      </header>
      <div class="globe-body">
        <canvas class="globe-canvas" id="globe-canvas"></canvas>
        <aside class="globe-side">
          <form id="globe-search-form">
            <input class="globe-search" id="globe-search" type="search"
              placeholder="${COPY.globe.searchPlaceholder}" autocomplete="off" spellcheck="false" />
          </form>
          <p class="globe-hint">${COPY.globe.continentsHint}</p>
          <div class="globe-continents" id="globe-continents">
            ${['europe', 'africa', 'asia', 'north-america', 'south-america', 'oceania']
              .map((id) => `<button class="button" type="button" data-region="${id}">
                ${id.replace('-', ' ').toUpperCase()}</button>`)
              .join('')}
          </div>
          <pre class="globe-log" id="globe-log">${COPY.globe.booting}</pre>
        </aside>
      </div>
    </div>
    <div class="start-screen" id="start-screen">
      <!-- The intro stage: empty until ui/intro.ts draws into it, and emptied
           again when the intro ends. See playIntro's contract. -->
      <div class="start-stage" id="start-stage" aria-hidden="true"></div>
      <p class="start-kicker">${COPY.boot.startKicker}</p>
      <h1 class="start-title">${COPY.boot.appTitle}</h1>
      <div class="start-actions">
        <button class="button button-primary start-enter" id="start-sound-on" type="button" autofocus>
          ${COPY.boot.startWithSound}
        </button>
        <button class="button start-enter" id="start-sound-off" type="button">
          ${COPY.boot.startNoSound}
        </button>
        <button class="button start-skip" id="start-skip" type="button">
          ${COPY.boot.startSkip}
        </button>
      </div>
      <span class="start-crab" aria-hidden="true">🦀</span>
    </div>
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
  const demoButton = root.querySelector<HTMLButtonElement>('#demo-button');
  const jobScoreDot = root.querySelector<HTMLElement>('#job-score-dot');
  const jobScoreValue = root.querySelector<HTMLElement>('#job-score-value');
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
  const jobBuildingsAttribution = root.querySelector<HTMLElement>('#job-buildings-attribution');
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
  const viewerCrab = root.querySelector<HTMLButtonElement>('#viewer-crab');
  const viewerPlaceHere = root.querySelector<HTMLButtonElement>('#viewer-place-here');
  const placeButton = root.querySelector<HTMLButtonElement>('#place-avatar-button');
  const soundButton = root.querySelector<HTMLButtonElement>('#sound-button');
  const startScreen = root.querySelector<HTMLDivElement>('#start-screen');
  const startStage = root.querySelector<HTMLDivElement>('#start-stage');
  const startSoundOn = root.querySelector<HTMLButtonElement>('#start-sound-on');
  const startSoundOff = root.querySelector<HTMLButtonElement>('#start-sound-off');
  const startSkip = root.querySelector<HTMLButtonElement>('#start-skip');
  const globeButton = root.querySelector<HTMLButtonElement>('#globe-button');
  const globeConsole = root.querySelector<HTMLDivElement>('#globe-console');
  const globeCanvas = root.querySelector<HTMLCanvasElement>('#globe-canvas');
  const globeClose = root.querySelector<HTMLButtonElement>('#globe-close');
  const globeSearchForm = root.querySelector<HTMLFormElement>('#globe-search-form');
  const globeSearch = root.querySelector<HTMLInputElement>('#globe-search');
  const globeLog = root.querySelector<HTMLPreElement>('#globe-log');
  const placeModal = root.querySelector<HTMLDialogElement>('#place-modal');
  const placeCharacter = root.querySelector<HTMLSelectElement>('#place-character');
  const placePosition = root.querySelector<HTMLElement>('#place-position');
  const placeMessage = root.querySelector<HTMLInputElement>('#place-message');
  const placeVenue = root.querySelector<HTMLInputElement>('#place-venue');
  const placeWhen = root.querySelector<HTMLInputElement>('#place-when');
  const placeHeading = root.querySelector<HTMLInputElement>('#place-heading');
  const placeStatus = root.querySelector<HTMLElement>('#place-status');
  const placePublish = root.querySelector<HTMLButtonElement>('#place-publish');
  const placeCancel = root.querySelector<HTMLButtonElement>('#place-cancel');
  const jobCloseFailed = root.querySelector<HTMLButtonElement>('#job-close-failed');
  const jobRetry = root.querySelector<HTMLButtonElement>('#job-retry');

  if (!mapCanvas || !stateAlert || !announcement || !emptyState || !helper || !areaReadout ||
      !dtoBBox || !dtoArea || !coordinatesPanel || !coordinatesButton || !form || !drawButton ||
      !stopDrawingButton || !clearButton || !coverageButton || !restoreButton || !toast || !requestAction ||
      !continueRequestButton || !sourceStatus || !jobModal ||
      !jobStages.READY || !jobStages.GENERATING || !jobStages.PREVIEW || !jobStages.FAILED ||
      !jobArea || !demoButton || !jobScoreDot || !jobScoreValue || !startStage ||
      !jobAvailTerrain || !jobAvailOrtho || !jobAvailStreets || !jobAvailWater ||
      !jobProgress || !jobProgressFill || !jobCanvas || !jobElevation || !jobExtent || !jobTriangles ||
      !jobBuildings || !jobRoads || !jobOrtho || !jobImageryAttribution ||
      !jobBuildingsAttribution ||
      !jobError || !jobStart || !jobCancel || !jobClose || !jobCloseFailed || !jobRetry ||
      !jobOpenViewer || !viewerModal || !viewerCanvas || !viewerClose ||
      !viewerLayerOrtho || !viewerLayerBuildings || !viewerLayerRoads ||
      !viewerLayerOrthoLabel || !viewerLayerBuildingsLabel || !viewerLayerRoadsLabel ||
      !viewerLayerLandcover || !viewerLayerLandcoverLabel ||
      !viewerLayerWaterways || !viewerLayerWaterwaysLabel ||
      !viewerIsometric || !viewerPixel || !viewerWalk || !viewerAvatar || !viewerExport ||
      !viewerCrab || !viewerPlaceHere || !placeButton || !soundButton ||
      !startScreen || !startSoundOn || !startSoundOff || !startSkip ||
      !globeButton || !globeConsole || !globeCanvas || !globeClose ||
      !globeSearchForm || !globeSearch || !globeLog || !placeModal ||
      !placeCharacter ||
      !placePosition || !placeMessage || !placeVenue || !placeWhen ||
      !placeHeading || !placeStatus || !placePublish || !placeCancel) {
    throw new Error('Incomplete terrCVM UI scaffold.');
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
  let buildingsAttribution: string | null = null;
  /** Non-null whenever the geometry is not standing on bare earth. */
  let surfaceNotice: string | null = null;
  let orthoMeta: OrthoMeta | null = null;
  // The generated scene, kept for the fullscreen viewer to remount.
  let lastScene: {
    bbox: BBox4326;
    mesh: TerrainMesh;
    buildings?: BuildingMesh;
    roads?: RoadMesh;
    landcover?: LandcoverMesh;
    waterways?: RoadMesh;
    ortho?: TexImageSource;
    npcs?: { mesh: ViewerModel; x: number; z: number; theta: number }[];
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
      // Bake warnings (tile budgets, size clamps) explain WHY a delivery is
      // coarser than the neighbour's — the number alone reads as a defect.
      jobOrtho.textContent = orthoMeta
        ? COPY.jobFlow.orthoLine(orthoMeta.source.name, orthoMeta.mPerPx) +
          (orthoMeta.warnings.length > 0 ? ` ${COPY.jobFlow.orthoCapped}` : '')
        : COPY.jobFlow.orthoUnavailable;
      jobOrtho.title = orthoMeta?.warnings.join('; ') ?? '';
      // The Vienna model measures most parts, not all — say so instead of
      // letting three different counts circulate.
      jobBuildings.title = buildingsAttribution ? COPY.jobFlow.buildingsMeasuredNote : '';
      // Attribution is a licence obligation wherever imagery is shown, so the
      // line appears exactly when a texture is draped.
      jobImageryAttribution.hidden = orthoMeta === null;
      jobImageryAttribution.textContent = orthoMeta
        ? COPY.jobFlow.imageryAttribution(orthoMeta.source.attribution)
        : '';
      // Provenance of the geometry, which includes the surface it stands on:
      // on anything but a bare-earth DTM the buildings are extruded from roof
      // height and the roads drape there too, so the notice ships with the
      // count rather than being available to whoever thinks to look. The
      // sentence comes from the engine on purpose — the measurement lives with
      // the code that knows it, and one copy cannot drift from another.
      const provenance = [buildingsAttribution, surfaceNotice].filter(
        (line): line is string => line !== null,
      );
      jobBuildingsAttribution.hidden = provenance.length === 0;
      jobBuildingsAttribution.textContent = provenance.join(' ');
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

    // Vienna's measured building-body model beats OSM storey guesses; any
    // failure falls back to the OSM footprints from the feature fetch.
    const wienPromise =
      region.id === 'vienna'
        ? fetchWienBuildings(bbox, { signal: controller.signal }).catch(() => null)
        : Promise.resolve(null);

    generateTerrain(bbox, {
      // Without this the elevation chain short-circuits to Terrarium — the
      // 30 m radar DSM — and every national LiDAR DTM is unreachable. The
      // registry, its licences and the transcode path all exist; omitting
      // `region` here is what made them dead code in the shipping app.
      region: region.id,
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
        let osmBuildings: Footprint[] = [];
        let featuresOk = true;
        const ground = sampleTerrain(mesh);
        surfaceNotice = ground.surface.notice;
        try {
          const features = await fetchFeatures(bbox, { signal: controller.signal });
          osmBuildings = features.buildings;
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
          roads = undefined;
          landcover = undefined;
          waterways = undefined;
          featuresOk = false;
        }

        // Vienna's measured building bodies stand on their own: an Overpass
        // outage must not cost the better source, and vice versa.
        const wienFootprints = await wienPromise;
        const fromWien = Boolean(wienFootprints && wienFootprints.length > 0);
        buildingsAttribution = fromWien ? WIEN_BUILDINGS_ATTRIBUTION : null;
        const footprints = fromWien ? wienFootprints! : osmBuildings;
        if (footprints.length > 0) {
          // The ground sample comes from the exaggerated terrain, so building
          // heights must take the same vertical scale or they sit squashed
          // against the relief.
          buildings = extrudeFootprints(
            footprints.map((f) => ({ ...f, heightM: f.heightM * TERRAIN_EXAGGERATION })),
            bbox,
            ground,
          );
        }
        if (!controller.signal.aborted) setGenProgress(0.95, COPY.jobFlow.progressOrtho, true);
        const ortho = await orthoPromise;
        if (controller.signal.aborted) return;
        setGenProgress(1, COPY.jobFlow.progressMount);

        // Geo-anchored avatars inside this selection: fetch each model by
        // its content hash and stand it at its placed position — the same
        // two requests any other app or napplet would make.
        let npcs: NonNullable<NonNullable<typeof lastScene>['npcs']> = [];
        try {
          const placements = await fetchPlacements(bbox, controller.signal);
          // Live presence from the relays joins the locally mirrored
          // placements — other users appear in the scene, newest spot wins.
          const presences = await fetchPresences(bbox).catch(() => []);
          for (const presence of presences) {
            const existing = placements.findIndex((p) => p.name === presence.name);
            const record = {
              name: presence.name,
              sha256: presence.sha256,
              lon: presence.lon,
              lat: presence.lat,
              heading: 180,
            };
            if (existing >= 0) placements[existing] = record;
            else placements.push(record);
          }
          const project = projector(bbox);
          npcs = (
            await Promise.all(
              placements.map(async (placement) => {
                try {
                  const meshData = await toViewerModel(
                    await fetchCharacterBytes(placement.sha256, controller.signal),
                    GIANT_HEIGHT_M,
                  );
                  const local = project(placement.lon, placement.lat);
                  return {
                    mesh: meshData,
                    x: local.x,
                    z: local.z,
                    theta: Math.PI - (placement.heading * Math.PI) / 180,
                  };
                } catch {
                  return null;
                }
              }),
            )
          ).filter((npc): npc is NonNullable<typeof npc> => npc !== null);
        } catch {
          npcs = [];
        }
        if (controller.signal.aborted) return;

        // Reveal the preview stage first so the canvas has layout, then mount
        // synchronously — deferring to rAF would never run while the page is
        // backgrounded or not compositing.
        dispatchJob({ type: 'TERRAIN_READY', mesh });
        sound.chime();
        // A golden breath around the fresh scene.
        jobCanvas.classList.add('terrain-ready-flash');
        setTimeout(() => jobCanvas.classList.remove('terrain-ready-flash'), 1400);
        buildingCount = buildings?.stats.footprints ?? 0;
        roadCount = roads?.stats.roads ?? 0;
        featuresFailed = !featuresOk;
        orthoMeta = ortho?.meta ?? null;
        lastScene = {
          bbox,
          mesh,
          buildings,
          roads,
          landcover,
          waterways,
          ortho: ortho?.bitmap,
          npcs,
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
            audio: { step: () => sound.step(), stomp: () => sound.stomp() },
          });
          if (npcs.length > 0) viewer.setNpcs(npcs);
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
    jobScoreValue.textContent = '…';
    jobScoreDot.className = 'job-score-dot';

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

      // One number to rule the panel: everything below is the breakdown.
      let score = 15; // Mapzen terrain answers everywhere
      if (report.ortho) {
        const resolution = report.ortho.mPerPx;
        score += resolution <= 0.3 ? 40 : resolution <= 1 ? 32 : resolution <= 2.5 ? 22 : 12;
      }
      if (report.streets) {
        score += report.streets >= 1000 ? 30 : report.streets >= 100 ? 22 : 12;
      }
      if (report.waterways) score += report.waterways >= 100 ? 15 : 8;
      score = Math.min(100, score);
      const grade = score >= 75 ? 'green' : score >= 45 ? 'amber' : 'red';
      jobScoreValue.textContent = `${score}/100`;
      jobScoreDot.className = `job-score-dot job-score-dot--${grade}`;
    });
  };

  const openJobFlow = (): void => {
    if (state.kind !== 'SELECTED_VALID') return;
    dispatchJob({ type: 'OPEN', bbox: state.bbox, areaKm2: state.areaKm2 });
    showPreflight(state.bbox);
    announce(COPY.jobFlow.readyTitle);
  };

  // The curated places: prewarmed selections that double as GPS-pinned
  // buttons on the globe and as the region's demo shortcut.
  type Curated = {
    key: string; name: string; region: string;
    lon: number; lat: number; bbox: BBox4326;
  };
  const CURATED: Curated[] = [
    { key: 'ring', name: 'Wien Ring', region: 'vienna',
      lon: 16.37, lat: 48.205, bbox: [16.355, 48.195, 16.385, 48.215] },
    { key: 'schoenbrunn', name: 'Schönbrunn', region: 'vienna',
      lon: 16.31, lat: 48.184, bbox: [16.3, 48.178, 16.32, 48.19] },
    { key: 'funchal', name: 'Funchal', region: 'madeira',
      lon: -16.91, lat: 32.65, bbox: [-16.92, 32.64, -16.9, 32.66] },
    { key: 'bruneck', name: 'Bruneck', region: 'south-tyrol',
      lon: 11.94, lat: 46.796, bbox: [11.925, 46.788, 11.955, 46.805] },
    { key: 'innichen', name: 'Innichen', region: 'south-tyrol',
      lon: 12.28, lat: 46.735, bbox: [12.265, 46.725, 12.295, 46.745] },
  ];
  const runCurated = (entry: Curated): void => {
    state = selectionReducer(state, { type: 'APPLY_COORDINATES', bbox: entry.bbox });
    alert('');
    updateView();
    mapView.setSelection(entry.bbox);
    openJobFlow();
    startTerrainJob();
  };
  const demoSelection = CURATED.find((entry) => entry.region === region.id);
  if (demoSelection) {
    demoButton.hidden = false;
    demoButton.textContent = COPY.jobFlow.demoRun(demoSelection.name);
    demoButton.addEventListener('click', () => runCurated(demoSelection));
  }

  // The global event console: dot-earth, live events, a locate field.
  let globe: MatrixGlobe | undefined;
  const GLOBE_PLACES: { name: string; lon: number; lat: number }[] = [
    ...(cities as { name: string; lon: number; lat: number }[]),
    { name: 'Wien Ring', lon: 16.37, lat: 48.205 },
    { name: 'Funchal', lon: -16.91, lat: 32.65 },
    { name: 'Bruneck', lon: 11.94, lat: 46.796 },
    { name: 'Innichen', lon: 12.28, lat: 46.735 },
  ];
  const logLine = (line: string): void => {
    globeLog.textContent = `${globeLog.textContent}\n${line}`.split('\n').slice(-18).join('\n');
  };
  const openGlobe = (): void => {
    globeConsole.hidden = false;
    globe ??= createMatrixGlobe(globeCanvas, {
      // GPS-pinned buttons: a click flies in, then enters the place — in
      // this region directly, otherwise via a region switch that carries
      // the target in the hash.
      onPin: (pin) => {
        const entry = CURATED.find((candidate) => candidate.name === pin.name);
        if (!entry) return;
        sound.tick();
        globe?.flyTo(entry.lon, entry.lat);
        logLine(COPY.globe.locate(entry.name, entry.lat, entry.lon));
        setTimeout(() => {
          if (entry.region === region.id) {
            globeConsole.hidden = true;
            runCurated(entry);
          } else {
            window.location.assign(`?region=${entry.region}#go=${entry.key}`);
          }
        }, 1500);
      },
    });
    globe.setPins(CURATED.map(({ name, lon, lat }) => ({ name, lon, lat })));
    globeLog.textContent = COPY.globe.booting;
    void Promise.all([
      fetchPlacements().catch(() => []),
      fetchGlobalPresences().catch(() => []),
    ]).then(([placements, presences]) => {
      if (globeConsole.hidden) return;
      const events = [
        ...placements.map((p) => ({
          name: p.name, lon: p.lon, lat: p.lat, kind: 'placement' as const,
        })),
        ...presences.map((p) => ({
          name: p.name, lon: p.lon, lat: p.lat,
          kind: 'presence' as const, message: p.message,
        })),
      ];
      globe?.setEvents(events);
      globeLog.textContent = events.length
        ? events
            .map((event) =>
              `> ${event.kind === 'presence' ? 'STATUS' : 'MODEL '} ${event.name}` +
              ` @ ${event.lat.toFixed(3)},${event.lon.toFixed(3)}` +
              ('message' in event && event.message ? ` — ${event.message}` : ''))
            .join('\n')
        : COPY.globe.empty;
    });
    globeSearch.focus();
  };
  globeButton.addEventListener('click', openGlobe);
  globeClose.addEventListener('click', () => {
    globeConsole.hidden = true;
  });
  // Continent buttons: map-only regions where placing nostr events is the
  // whole point — presence anywhere, generation stays with the curated
  // regions.
  root.querySelector('#globe-continents')?.addEventListener('click', (event) => {
    const target = (event.target as HTMLElement | null)?.closest<HTMLButtonElement>(
      'button[data-region]',
    );
    if (!target) return;
    window.location.assign(`?region=${target.dataset.region}`);
  });
  globeSearchForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const query = globeSearch.value.trim().toLowerCase();
    if (!query) return;
    const hit = GLOBE_PLACES.find((place) => place.name.toLowerCase().includes(query));
    if (hit) {
      globe?.flyTo(hit.lon, hit.lat);
      logLine(COPY.globe.locate(hit.name, hit.lat, hit.lon));
      sound.tick();
    } else {
      logLine(COPY.globe.notFound(globeSearch.value.trim()));
    }
  });

  // Everyone whose presence status stands in this region appears on the map.
  void fetchPresences([
    region.viewBounds.west,
    region.viewBounds.south,
    region.viewBounds.east,
    region.viewBounds.north,
  ])
    .then((presences) => {
      for (const presence of presences) {
        mapView.addAvatarMarker(presence.name, presence.lon, presence.lat, presence.sha256);
      }
    })
    .catch(() => undefined);

  // Fresh geo-tagged notes from the wider network land on the map too —
  // the wire is alive, not just our own events.
  void fetchGeoNotes([
    region.viewBounds.west,
    region.viewBounds.south,
    region.viewBounds.east,
    region.viewBounds.north,
  ])
    .then((notes) => {
      for (const note of notes.slice(0, 40)) {
        mapView.addNoteMarker(note.id, note.content, note.lon, note.lat);
      }
    })
    .catch(() => undefined);

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
    crabActive = false;
    viewerCrab.textContent = COPY.jobFlow.crabButton;
    try {
      fullViewer = createTerrainViewer(viewerCanvas, lastScene.mesh, {
        buildings: lastScene.buildings,
        roads: lastScene.roads,
        landcover: lastScene.landcover,
        waterways: lastScene.waterways,
        ortho: lastScene.ortho,
        autoRotate: false,
        intro: true,
        audio: {
          step: () => sound.step(),
          stomp: () => sound.stomp(),
          lift: (value) => sound.setAmbientLift(value),
        },
      });
      if (lastScene.npcs && lastScene.npcs.length > 0) fullViewer.setNpcs(lastScene.npcs);
      void populateAvatarChoices();
      // The reveal has a voice: wind bed under the scene, airflow over the
      // spiral descent.
      sound.startAmbient();
      sound.whoosh();
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
      .then(async (bytes) => {
        fullViewer?.setCharacter(await toViewerModel(bytes, GIANT_HEIGHT_M));
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
      anchor.download = 'terrcvm-map.png';
      anchor.click();
      URL.revokeObjectURL(url);
    });
  });
  // The crab: secrab from the blossom store, normalised to 42 m, stomping
  // across the selection. The button toggles it.
  let crabActive = false;
  viewerCrab.addEventListener('click', () => {
    if (crabActive) {
      fullViewer?.setKaiju(null);
      crabActive = false;
      viewerCrab.textContent = COPY.jobFlow.crabButton;
      return;
    }
    const entry = avatarManifest?.find((candidate) => candidate.name === 'secrab');
    if (!entry) {
      announce(COPY.jobFlow.avatarFailed('secrab'));
      return;
    }
    // The stomp cycle is a set of frame blobs; identical frames share a hash,
    // so each unique blob is fetched exactly once.
    const frameShas = entry.frames && entry.frames.length > 0 ? entry.frames : [entry.sha256];
    const uniqueShas = [...new Set(frameShas)];
    void Promise.all(uniqueShas.map((sha) => fetchCharacterBytes(sha)))
      .then(async (buffers) => {
        // Normalise the unique meshes exactly once — duplicated frames share
        // objects, and a second pass would rescale them. 63 m: half again
        // over the old kaiju, three times the giants.
        const uniqueMeshes = normalizeCharacterFrames(
          buffers.map((buffer) => parseGlb(buffer)),
          63,
        );
        // Every frame deforms the same painted body; decode the skin once.
        const skin = uniqueMeshes.find((m) => m.texture)?.texture ?? null;
        const skinBitmap = skin
          ? await createImageBitmap(
              new Blob([skin.bytes], { type: skin.mimeType }),
            ).catch(() => null)
          : null;
        const bySha = new Map(uniqueShas.map((sha, i) => [sha, uniqueMeshes[i]]));
        fullViewer?.setKaiju(
          frameShas.map((sha) => ({ ...bySha.get(sha)!, texture: skinBitmap })),
        );
        crabActive = true;
        viewerCrab.textContent = COPY.jobFlow.crabRemoveButton;
        // The crab is an event: flash, shake, sub-bass — and it announces
        // itself.
        sound.boom();
        sound.roar();
        viewerModal.classList.add('crab-arrival');
        setTimeout(() => viewerModal.classList.remove('crab-arrival'), 900);
      })
      .catch(() => announce(COPY.jobFlow.avatarFailed('secrab')));
  });

  // Place-avatar flow: map click → unsigned event from the server → NIP-07
  // signature → relays → local sync. The app never sees a key.
  let pendingPlace: { lon: number; lat: number } | null = null;
  placeButton.addEventListener('click', () => {
    mapView.armPlacing();
    announce(COPY.jobFlow.placeHint);
  });

  // Every button clicks softly; the toggle silences the whole layer.
  root.addEventListener('click', (event) => {
    if ((event.target as HTMLElement | null)?.closest('button')) sound.tick();
  });

  // The start screen: one deliberate click opens the app — and that same
  // gesture is what unlocks the AudioContext, so the chime lands with it.
  // ui/sound.ts synthesises every sound instead of loading files, so this
  // gesture outlived the intro film and still has to happen: without it the
  // browser keeps the audio context suspended and the session stays silent.
  //
  // The ceremony belongs to the session's FIRST entry only. Region hops
  // (continent buttons, globe pins) reload the page — the session flag keeps
  // the start screen from replaying on them, and in a sandboxed shell without
  // storage it degrades to always-intro. Flag and seam live together in
  // ui/intro.ts.

  // A pin click from another region carries its target in the hash and
  // goes straight to generation.
  const resolveGoTarget = (): Curated | undefined => {
    const goKey = window.location.hash.replace('#go=', '');
    const target = CURATED.find(
      (entry) => entry.key === goKey && entry.region === region.id,
    );
    if (target) {
      history.replaceState(null, '', window.location.pathname + window.location.search);
    }
    return target;
  };

  const enterApp = (): void => {
    if (startScreen.classList.contains('is-leaving')) return;
    markEnteredThisSession();
    sound.chime();
    startScreen.classList.add('is-leaving');
    root.querySelector('.app-header')?.classList.add('is-arriving');
    root.querySelector('.map-region')?.classList.add('is-arriving');
    setTimeout(() => startScreen.remove(), 800);
    const goTarget = resolveGoTarget();
    if (goTarget) runCurated(goTarget);
    else openGlobe();
  };

  // The header toggle mirrors whatever the start screen decided.
  const syncSoundButton = (): void => {
    soundButton.setAttribute('aria-pressed', String(!sound.isMuted()));
    soundButton.classList.toggle('is-muted', sound.isMuted());
  };

  // The gate: picking a sound option is the user gesture browsers require
  // before audio, and it also decides whether the synthesised layer speaks at
  // all. Then the intro plays once and the app opens behind it.
  const introAbort = new AbortController();
  let entering = false;
  const beginEntry = (audible: boolean, withIntro: boolean): void => {
    if (entering) return;
    entering = true;
    sound.setMuted(!audible);
    syncSoundButton();
    if (!withIntro) {
      introAbort.abort();
      enterApp();
      return;
    }
    // While the intro runs it owns the screen; the menu steps aside.
    startScreen.classList.add('is-intro');
    let ceiling = 0;
    let opened = false;
    const open = (): void => {
      if (opened) return;
      opened = true;
      window.clearTimeout(ceiling);
      // Aborting on the way out too: it retires the skip listeners below and
      // tells a still-running intro to stop drawing.
      introAbort.abort();
      startStage.replaceChildren();
      enterApp();
    };
    // Belt and braces on the duration budget: a stalled or misbehaving intro
    // must never be able to hold the app shut past its ceiling.
    ceiling = window.setTimeout(() => {
      introAbort.abort();
      open();
    }, INTRO_MAX_MS);
    void playIntro({
      host: startStage,
      signal: introAbort.signal,
      muted: !audible,
      reducedMotion: prefersReducedMotion(),
    }).then(open, open);
  };

  // Any click, Escape, Enter or Space during the intro skips ahead. playIntro
  // hears about it through the abort signal and is expected to stop drawing
  // and resolve; the ceiling above covers it if it does not. Both listeners
  // are bound to the same signal, so they retire with the intro.
  const skipIntro = (): void => {
    if (entering) introAbort.abort();
  };
  startScreen.addEventListener('click', skipIntro, { signal: introAbort.signal });
  window.addEventListener(
    'keydown',
    (event) => {
      if (event.key === 'Escape' || event.key === 'Enter' || event.key === ' ') skipIntro();
    },
    { signal: introAbort.signal },
  );

  startSoundOn.addEventListener('click', (event) => {
    event.stopPropagation();
    beginEntry(true, true);
  });
  startSoundOff.addEventListener('click', (event) => {
    event.stopPropagation();
    beginEntry(false, true);
  });
  startSkip.addEventListener('click', (event) => {
    event.stopPropagation();
    // Skipping still counts as the gesture — the sound layer stays on and the
    // AudioContext unlocks; only the intro is declined.
    beginEntry(true, false);
  });
  soundButton.addEventListener('click', () => {
    sound.setMuted(!sound.isMuted());
    syncSoundButton();
    // Muting kills the wind bed; unmuting inside the viewer brings it back.
    if (!sound.isMuted() && viewerModal.open) sound.startAmbient();
  });
  const openPlaceModal = async (lon: number, lat: number): Promise<void> => {
    pendingPlace = { lon, lat };
    placePosition.textContent = `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
    placeMessage.value = '';
    placeVenue.value = '';
    // Meetups default to the next half hour, in local wall-clock time.
    const soon = new Date(Date.now() + 30 * 60 * 1000);
    soon.setMinutes(soon.getMinutes() - (soon.getMinutes() % 30), 0, 0);
    const pad = (value: number): string => String(value).padStart(2, '0');
    placeWhen.value =
      `${soon.getFullYear()}-${pad(soon.getMonth() + 1)}-${pad(soon.getDate())}` +
      `T${pad(soon.getHours())}:${pad(soon.getMinutes())}`;
    placeStatus.textContent = '';
    if (avatarManifest === null) {
      avatarManifest = await fetchCharacterManifest().catch(() => []);
    }
    placeCharacter.innerHTML = '';
    for (const entry of avatarManifest) {
      const option = document.createElement('option');
      option.value = entry.name;
      option.textContent = entry.name;
      placeCharacter.append(option);
    }
    placeModal.showModal();
  };
  placeCancel.addEventListener('click', () => placeModal.close());
  placePublish.addEventListener('click', () => {
    const spot = pendingPlace;
    const name = placeCharacter.value;
    if (!spot || !name) return;
    const heading = Number(placeHeading.value) || 0;
    const message = placeMessage.value.trim();
    placeStatus.textContent = '…';
    placePublish.disabled = true;
    void buildPlacementEvent(name, spot.lon, spot.lat, heading, message)
      .then((event) => signAndPublish(event))
      .then(async ({ accepted }) => {
        // Presence rides along: kind 30315 is replaceable, so this status
        // simply supersedes wherever the user stood before.
        await buildPresenceEvent(name, spot.lon, spot.lat, message)
          .then((event) => signAndPublish(event))
          .catch(() => undefined);
        // A named venue upgrades the message to a NIP-52 meetup with a
        // start time; the description is the map message itself.
        const venue = placeVenue.value.trim();
        const startsAt = Math.floor(new Date(placeWhen.value).getTime() / 1000);
        if (venue && Number.isFinite(startsAt) && startsAt > 0) {
          await buildCalendarEvent(venue, spot.lon, spot.lat, startsAt, message)
            .then((event) => signAndPublish(event))
            .then(() => {
              const when = new Date(startsAt * 1000);
              const label = `📅 ${venue} ${String(when.getHours()).padStart(2, '0')}:` +
                `${String(when.getMinutes()).padStart(2, '0')}`;
              mapView.addNoteMarker(`meetup:${startsAt}:${venue}`, label, spot.lon, spot.lat);
            })
            .catch(() => undefined);
        }
        const entry = avatarManifest?.find((candidate) => candidate.name === name);
        if (entry) {
          // Local sync is dev convenience; the signed event is the truth.
          await fetch(`${COLLECTION_SERVICE.baseUrl}/placements`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              name,
              sha256: entry.sha256,
              lon: spot.lon,
              lat: spot.lat,
              heading,
              ...(message ? { message } : {}),
            }),
          }).catch(() => undefined);
          mapView.addAvatarMarker(name, spot.lon, spot.lat, entry.sha256);
          // Placed from inside the world: the giant appears on the spot,
          // no regeneration needed.
          const scene = lastScene;
          if (fullViewer && scene) {
            const [west, south, east, north] = scene.bbox;
            if (west <= spot.lon && spot.lon <= east && south <= spot.lat && spot.lat <= north) {
              try {
                const model = await toViewerModel(
                  await fetchCharacterBytes(entry.sha256),
                  GIANT_HEIGHT_M,
                );
                const local = projector(scene.bbox)(spot.lon, spot.lat);
                scene.npcs = [
                  ...(scene.npcs ?? []),
                  {
                    mesh: model,
                    x: local.x,
                    z: local.z,
                    theta: Math.PI - (heading * Math.PI) / 180,
                  },
                ];
                fullViewer.setNpcs(scene.npcs);
              } catch {
                // The next generation run will pick the placement up anyway.
              }
            }
          }
        }
        placeStatus.textContent = COPY.jobFlow.placePublished(accepted.length);
        setTimeout(() => placeModal.close(), 1600);
      })
      .catch((error: unknown) => {
        placeStatus.textContent =
          error instanceof Error ? error.message : 'Publishing failed.';
      })
      .finally(() => {
        placePublish.disabled = false;
      });
  });

  // Place from inside the world: your standing spot becomes the placement.
  viewerPlaceHere.addEventListener('click', () => {
    const scene = lastScene;
    const spot = fullViewer?.getWalkPosition();
    if (!scene || !spot) {
      announce(COPY.jobFlow.placeHereHint);
      return;
    }
    const [west, south, east, north] = scene.bbox;
    const { widthM, depthM } = scene.mesh.stats;
    const lon = west + ((spot.x + widthM / 2) / widthM) * (east - west);
    const lat = north - ((spot.z + depthM / 2) / depthM) * (north - south);
    void openPlaceModal(lon, lat);
  });

  viewerClose.addEventListener('click', () => viewerModal.close());
  // Covers Escape as well: the native close event is the single teardown path.
  viewerModal.addEventListener('close', () => {
    sound.stopAmbient();
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
      onPlacePick: (lon, lat) => {
        void openPlaceModal(lon, lat);
      },
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
      armPlacing: () => undefined,
      addAvatarMarker: () => undefined,
      addNoteMarker: () => undefined,
      setSelection: () => undefined,
      clearSelection: () => undefined,
      destroy: () => undefined,
    };
    announce(error instanceof Error ? error.message : COPY.sourceUnavailable.body);
  }

  // Region hops skip the ceremony: no intro replay, no gate — straight to the
  // pin's generation or the map the user navigated to.
  if (hasEnteredThisSession() && startScreen.isConnected) {
    entering = true;
    introAbort.abort();
    startScreen.remove();
    const goTarget = resolveGoTarget();
    if (goTarget) runCurated(goTarget);
  }

  updateView();
}
