import { COPY } from './copy';

export function renderApp(root: HTMLDivElement): void {
  root.innerHTML = `
    <a class="skip-link" href="#request-panel">${COPY.boot.skipToRequestPanel}</a>
    <header class="app-header" aria-label="${COPY.boot.toolbarLabel}">
      <h1 class="app-title">${COPY.boot.appTitle}</h1>
    </header>
    <div class="workbench">
      <main class="map-region" aria-label="${COPY.boot.mapRegionLabel}">
        <section class="empty-state" aria-labelledby="empty-state-title">
          <h2 class="empty-state-title" id="empty-state-title">${COPY.emptyState.heading}</h2>
          <p>${COPY.emptyState.body}</p>
        </section>
        <section class="source-status" aria-labelledby="source-status-title">
          <h2 class="status-title" id="source-status-title">${COPY.sourceUnavailable.heading}</h2>
          <p>${COPY.sourceUnavailable.body}</p>
        </section>
      </main>
      <aside class="request-panel" id="request-panel" aria-labelledby="request-panel-title" tabindex="-1">
        <h2 class="panel-title" id="request-panel-title">${COPY.requestPanel.title}</h2>
        <dl class="request-list">
          <div class="request-row">
            <dt class="request-label">${COPY.requestPanel.bboxLabel}</dt>
            <dd class="request-value">${COPY.requestPanel.emptyBbox}</dd>
          </div>
          <div class="request-row">
            <dt class="request-label">${COPY.requestPanel.crsLabel}</dt>
            <dd class="request-value">${COPY.requestPanel.crsValue}</dd>
          </div>
          <div class="request-row">
            <dt class="request-label">${COPY.requestPanel.resolutionLabel}</dt>
            <dd class="request-value fixed-default">${COPY.fixedDefaults.resolution}</dd>
          </div>
          <div class="request-row">
            <dt class="request-label">${COPY.requestPanel.outputLabel}</dt>
            <dd class="request-value fixed-default">${COPY.fixedDefaults.output}</dd>
          </div>
          <div class="request-row">
            <dt class="request-label">${COPY.requestPanel.sourceLabel}</dt>
            <dd class="request-value">${COPY.requestPanel.sourceUnavailable}</dd>
          </div>
        </dl>
        <p class="helper-caption">${COPY.fixedDefaults.helperCaption}</p>
      </aside>
    </div>
  `;
}
