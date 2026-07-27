import { OUTPUT_MIME, RES_M } from '../config/defaults';

const EMPTY_STATE_BODY =
  'Draw a rectangle on the map or enter coordinates to define the terrain area for this request.';
const SOURCE_UNAVAILABLE_BODY =
  'No trusted imagery source is active. Bounding-box selection and the request preview work normally; the orthophoto preview stays off until a source is approved.';
const DEFAULTS_CAPTION =
  'These values are set by the service and cannot be changed in this version.';

export function renderApp(root: HTMLDivElement): void {
  root.innerHTML = `
    <a class="skip-link" href="#request-panel">Skip to request panel</a>
    <header class="app-header" aria-label="Toolbar">
      <h1 class="app-title">terrDVM</h1>
    </header>
    <div class="workbench">
      <main class="map-region" aria-label="Map region placeholder">
        <section class="empty-state" aria-labelledby="empty-state-title">
          <h2 class="empty-state-title" id="empty-state-title">No area selected</h2>
          <p>${EMPTY_STATE_BODY}</p>
        </section>
        <section class="source-status" aria-labelledby="source-status-title">
          <h2 class="status-title" id="source-status-title">Source unavailable</h2>
          <p>${SOURCE_UNAVAILABLE_BODY}</p>
        </section>
      </main>
      <aside class="request-panel" id="request-panel" aria-labelledby="request-panel-title" tabindex="-1">
        <h2 class="panel-title" id="request-panel-title">Request preview</h2>
        <dl class="request-list">
          <div class="request-row">
            <dt class="request-label">Bounding box (W, S, E, N — EPSG:4326)</dt>
            <dd class="request-value">—, —, —, —</dd>
          </div>
          <div class="request-row">
            <dt class="request-label">CRS</dt>
            <dd class="request-value">EPSG:4326</dd>
          </div>
          <div class="request-row">
            <dt class="request-label">Resolution</dt>
            <dd class="request-value fixed-default">Resolution: ${RES_M} m/px — fixed for v1</dd>
          </div>
          <div class="request-row">
            <dt class="request-label">Output</dt>
            <dd class="request-value fixed-default">Output: ${OUTPUT_MIME} — fixed for v1</dd>
          </div>
          <div class="request-row">
            <dt class="request-label">Source</dt>
            <dd class="request-value">Source: — unavailable</dd>
          </div>
        </dl>
        <p class="helper-caption">${DEFAULTS_CAPTION}</p>
      </aside>
    </div>
  `;
}
