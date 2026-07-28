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

const AXES = ['west', 'south', 'east', 'north'] as const;
type Axis = (typeof AXES)[number];


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


function sourcePreview(): RequestPreviewDTO['source'] {
  return { name: '', suffix: 'unavailable' };
}

function coordinateLabels(): Record<Axis, string> {
  return { west: 'West (°)', south: 'South (°)', east: 'East (°)', north: 'North (°)' };
}

export function renderApp(root: HTMLDivElement): void {
  root.innerHTML = `
    <a class="skip-link" href="#request-panel">${COPY.boot.skipToRequestPanel}</a>
    <header class="app-header" aria-label="${COPY.boot.toolbarLabel}">
      <h1 class="app-title">${COPY.boot.appTitle}</h1>
      <div class="toolbar" role="toolbar" aria-label="${COPY.boot.toolbarLabel}">
        <button class="button button-primary" id="draw-button" type="button">${COPY.buttons.drawBoundingBox}</button>
        <button class="button" id="stop-drawing-button" type="button" hidden>${COPY.buttons.stopDrawing}</button>
        <button class="button" id="coordinates-button" type="button" aria-expanded="false" aria-controls="coordinates-panel">${COPY.buttons.enterCoordinates}</button>
        <button class="button button-danger" id="clear-button" type="button">${COPY.buttons.clearSelection}</button>
      </div>
    </header>
    <div class="workbench">
      <main class="map-region" aria-label="${COPY.boot.mapRegionLabel}">
        <div class="map-shell">
          <div class="map-canvas" id="map-canvas" tabindex="0" role="application" aria-label="${COPY.boot.mapRegionLabel}"></div>
          <div class="map-attribution" aria-label="Map attribution">${mapAttribution()}</div>
        </div>
        <section class="empty-state" id="empty-state" aria-labelledby="empty-state-title">
          <h2 class="empty-state-title" id="empty-state-title">${COPY.emptyState.heading}</h2>
          <p>${COPY.emptyState.body}</p>
        </section>
        <p class="selection-helper" id="selection-helper">${COPY.helpers.drawPointer}</p>
        <section class="source-status" aria-labelledby="source-status-title">
          <h2 class="status-title" id="source-status-title">${COPY.sourceUnavailable.heading}</h2>
          <p>${COPY.sourceUnavailable.body}</p>
        </section>
        <div class="status-alert" id="status-alert" role="alert" hidden></div>
        <div class="live-announcement" id="live-announcement" aria-live="polite"></div>
        <div class="undo-toast" id="undo-toast" role="status" hidden>
          <span>${COPY.toast.selectionCleared}</span>
          <button class="button" id="restore-button" type="button">${COPY.buttons.restoreSelection}</button>
        </div>
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
        <section class="request-gate" id="request-gate" aria-labelledby="request-gate-title" hidden tabindex="-1">
          <h3 class="section-title" id="request-gate-title">${COPY.requestGate.title}</h3>
          <p>${COPY.requestGate.body}</p>
          <p class="payment-note">${COPY.requestGate.paymentNote}</p>
          <button class="button button-wide" id="invoice-button" type="button" disabled>${COPY.requestGate.invoiceButton}</button>
          <button class="button button-wide" id="close-request-gate" type="button">${COPY.buttons.closeRequestGate}</button>
        </section>
      </aside>
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
  const restoreButton = root.querySelector<HTMLButtonElement>('#restore-button');
  const toast = root.querySelector<HTMLElement>('#undo-toast');
  const requestAction = root.querySelector<HTMLElement>('#request-action');
  const continueRequestButton = root.querySelector<HTMLButtonElement>('#continue-request-button');
  const requestGate = root.querySelector<HTMLElement>('#request-gate');
  const closeRequestGate = root.querySelector<HTMLButtonElement>('#close-request-gate');

  if (!mapCanvas || !stateAlert || !announcement || !emptyState || !helper || !areaReadout ||
      !dtoBBox || !dtoArea || !coordinatesPanel || !coordinatesButton || !form || !drawButton ||
      !stopDrawingButton || !clearButton || !restoreButton || !toast || !requestAction ||
      !continueRequestButton || !requestGate || !closeRequestGate) {
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

  const previewSource = sourcePreview();

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
    if (state.kind !== 'SELECTED_VALID') requestGate.hidden = true;
    stopDrawingButton.hidden = state.kind !== 'DRAWING';
    drawButton.hidden = state.kind === 'DRAWING';
    helper.textContent = state.kind === 'DRAWING'
      ? COPY.helpers.drawPointer
      : bbox && !isCleared
        ? COPY.helpers.editSelection
        : COPY.helpers.drawPointer;
    areaReadout.innerHTML = area === null
      ? '<span class="area-value">—</span> <span>km²</span>'
      : `<span class="area-value">${area.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}</span> <span>km²</span>`;

    if (state.kind === 'SELECTED_VALID') {
      const preview = buildRequestPreview(state.bbox, state.areaKm2, { kind: 'none', name: previewSource.name });
      dtoBBox.textContent = preview.bbox.map((coordinate) => coordinate.display).join(', ');
      dtoArea.textContent = `${preview.areaKm2.display} km²`;
      const source = root.querySelector<HTMLElement>('[data-dto="source"]');
      if (source) source.textContent = COPY.requestPanel.sourceUnavailable;
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
    state = selectionReducer(state, { type: 'APPLY_COORDINATES', bbox: result.bbox });
    mapView.setSelection(result.bbox);
    alert('');
    updateView();
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
  continueRequestButton.addEventListener('click', () => {
    requestGate.hidden = false;
    requestGate.focus();
    announce(COPY.requestGate.title);
  });
  closeRequestGate.addEventListener('click', () => {
    requestGate.hidden = true;
    continueRequestButton.focus();
  });

  try {
    mapView = createMapView(mapCanvas, {
      onDrawComplete: (bbox) => {
        state = selectionReducer(state, { type: 'DRAW_COMPLETE', bbox });
        alert('');
        updateView();
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
    });
  } catch (error) {
    mapView = {
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
