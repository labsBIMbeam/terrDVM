import {
  parseRangeTestCsv,
  splitLinkRecords,
  RangeTestFormatError,
  type RangeTestParse,
} from '../protocol/rangetest';
import { classifyWindow, type WindowReport } from '../protocol/window';
import {
  POLE_MARK_M,
  SITE_VISIT_SCHEMA,
  validateSiteVisit,
  type SiteVisit,
} from '../protocol/site-visit';

/**
 * The field-measurement napplet: one site visit, recorded honestly.
 *
 * Thin on purpose. It carries the FIELD-PROTOCOL.md §3.1 field sheet, the
 * §2.4 rangetest.csv de-shift ingest and the §3.3/§4.2 window
 * classification — everything of the measurement protocol that can exist
 * today. Fetching corpus tiles by hash to compare a measurement against the
 * terrain model needs the corpus loop, which does not exist yet; when it
 * does, it plugs in downstream of the record this app produces. No network,
 * no shell capabilities: the instrument reading enters as a file, the
 * record leaves as one.
 */

const FIELD_COPY = {
  title: 'terrCVM Field Measurement',
  kicker: 'raw observables only',
  sheetTitle: 'Site visit — field sheet (§3.1)',
  sheetNote:
    'Never on this form: excess loss, estimated range, distance, or any judgement about ' +
    'why something was or was not heard. Cause is a model determination.',
  csvTitle: 'Instrument reading — rangetest.csv (§2.4)',
  csvNote:
    'The firmware writes each row’s RSSI after the row terminator; the ingest shifts it ' +
    'back. Load the file exactly as retrieved from the node — never hand-edit it.',
  windowTitle: 'Window classification (§4.2)',
  windowNote:
    'PRR is derived at ingest, not in the field. A null is a submitted record: PRR = 0 is a ' +
    'positive datum.',
  exportTitle: 'Hand-in',
  exportNote:
    'The record is the form plus the classified window. Derived quantities are regenerated, ' +
    'never stored.',
} as const;

function fieldRow(id: string, label: string, control: string): string {
  return `
    <div class="field-row">
      <label for="${id}">${label}</label>
      ${control}
    </div>`;
}

function textInput(id: string, placeholder = '', type = 'text', value = ''): string {
  return `<input id="${id}" type="${type}" placeholder="${placeholder}" value="${value}"
    autocomplete="off" spellcheck="false" />`;
}

function selectInput(id: string, values: readonly string[]): string {
  return `<select id="${id}">${values
    .map((value) => `<option value="${value}">${value}</option>`)
    .join('')}</select>`;
}

export function renderApp(root: HTMLDivElement): void {
  root.innerHTML = `
    <header class="app-header" aria-label="Toolbar">
      <div class="brand">
        <span class="brand-mark" aria-hidden="true"></span>
        <h1 class="app-title">${FIELD_COPY.title}</h1>
      </div>
      <p class="field-kicker">${FIELD_COPY.kicker}</p>
    </header>
    <main class="field-main">
      <section class="field-section" aria-labelledby="sheet-title">
        <h2 class="section-title" id="sheet-title">${FIELD_COPY.sheetTitle}</h2>
        <p class="helper-caption">${FIELD_COPY.sheetNote}</p>
        <form id="sheet-form" novalidate>
          <div class="field-grid">
            ${fieldRow('site-id', 'site_id (pre-assigned)', textInput('site-id'))}
            ${fieldRow('operator-id', 'operator_id (pre-assigned)', textInput('operator-id'))}
            ${fieldRow('visit-date', 'date', textInput('visit-date', '', 'date'))}
            ${fieldRow('arrival-local', 'arrival_local', textInput('arrival-local', '', 'time'))}
            ${fieldRow('window-start', 'window_start_utc', textInput('window-start', '2026-08-02T09:00:00Z'))}
            ${fieldRow('window-end', 'window_end_utc', textInput('window-end', '2026-08-02T09:09:00Z'))}
            ${fieldRow('station-marks', 'station_marks', textInput('station-marks', '36', 'number'))}
            ${fieldRow('pole-mark', 'pole_mark (m)', textInput('pole-mark', '', 'number', POLE_MARK_M.toFixed(2)))}
            ${fieldRow('antenna-tilt', 'antenna_tilt (° worst)', textInput('antenna-tilt', '0', 'number', '0'))}
            ${fieldRow('pole-foot', 'pole_foot', selectInput('pole-foot', ['soil', 'rock', 'snow', 'other']))}
            ${fieldRow('node-serial', 'node_serial', textInput('node-serial'))}
            ${fieldRow('antenna-serial', 'antenna_serial', textInput('antenna-serial'))}
            ${fieldRow('config-hash', 'config_hash (from --info)', textInput('config-hash'))}
            ${fieldRow('gnss-lat', 'gnss_lat', textInput('gnss-lat', '', 'number'))}
            ${fieldRow('gnss-lon', 'gnss_lon', textInput('gnss-lon', '', 'number'))}
            ${fieldRow('gnss-acc', 'gnss_acc_m', textInput('gnss-acc', '', 'number'))}
            ${fieldRow('gnss-scatter', 'gnss_scatter_m', textInput('gnss-scatter', '', 'number'))}
            ${fieldRow('leaf-state', 'leaf_state', selectInput('leaf-state', ['in-leaf', 'bare', 'transitional']))}
            ${fieldRow('precip', 'precip', selectInput('precip', ['dry', 'wet-foliage', 'raining']))}
            ${fieldRow('wind', 'wind', selectInput('wind', ['calm', 'moderate', 'strong']))}
            ${fieldRow('photo-count', 'photos (6 expected)', textInput('photo-count', '6', 'number', '6'))}
          </div>
          <label class="field-row field-row-wide"><span>notes</span>
            <textarea id="visit-notes" rows="2" spellcheck="false"></textarea>
          </label>
          <div class="field-checks">
            <label><input type="checkbox" id="loopback-open" /> loopback_open: all 3 arrived</label>
            <label><input type="checkbox" id="loopback-close" /> loopback_close: all 3 arrived</label>
          </div>
        </form>
      </section>
      <section class="field-section" aria-labelledby="csv-title">
        <h2 class="section-title" id="csv-title">${FIELD_COPY.csvTitle}</h2>
        <p class="helper-caption">${FIELD_COPY.csvNote}</p>
        <input id="csv-file" type="file" accept=".csv,text/csv" />
        <p class="field-status" id="csv-status" role="status">no file loaded</p>
        <div class="field-tablewrap">
          <table class="field-table" id="csv-table" hidden>
            <thead>
              <tr><th>seq</th><th>from</th><th>time</th><th>rssi dBm</th><th>snr dB</th><th>hop</th></tr>
            </thead>
            <tbody id="csv-rows"></tbody>
          </table>
        </div>
        <p class="field-status" id="csv-excluded" hidden></p>
      </section>
      <section class="field-section" aria-labelledby="window-title">
        <h2 class="section-title" id="window-title">${FIELD_COPY.windowTitle}</h2>
        <p class="helper-caption">${FIELD_COPY.windowNote}</p>
        <div class="field-grid">
          ${fieldRow('beacon-a', 'beacon A node id (20 dBm)', textInput('beacon-a'))}
          ${fieldRow('beacon-b', 'beacon B node id (7 dBm)', textInput('beacon-b'))}
          ${fieldRow('expected-a-lo', 'expected seq A — lo', textInput('expected-a-lo', '', 'number'))}
          ${fieldRow('expected-a-hi', 'expected seq A — hi', textInput('expected-a-hi', '', 'number'))}
          ${fieldRow('expected-b-lo', 'expected seq B — lo', textInput('expected-b-lo', '', 'number'))}
          ${fieldRow('expected-b-hi', 'expected seq B — hi', textInput('expected-b-hi', '', 'number'))}
        </div>
        <button class="button button-primary" id="classify-button" type="button">Classify window</button>
        <div class="field-report" id="window-report" hidden>
          <p id="report-outcome" class="field-outcome"></p>
          <dl class="field-facts">
            <div><dt>PRR A</dt><dd id="report-prr-a">—</dd></div>
            <div><dt>PRR B</dt><dd id="report-prr-b">—</dd></div>
            <div><dt>bracket</dt><dd id="report-bracket">—</dd></div>
          </dl>
          <p class="helper-caption" id="report-note"></p>
        </div>
      </section>
      <section class="field-section" aria-labelledby="export-title">
        <h2 class="section-title" id="export-title">${FIELD_COPY.exportTitle}</h2>
        <p class="helper-caption">${FIELD_COPY.exportNote}</p>
        <button class="button button-primary" id="export-button" type="button">Validate &amp; export JSON</button>
        <p class="field-status" id="export-status" role="alert"></p>
      </section>
      <div class="live-announcement" id="live-announcement" aria-live="polite"></div>
    </main>
  `;

  const query = <T extends HTMLElement>(selector: string): T => {
    const element = root.querySelector<T>(selector);
    if (!element) throw new Error(`Incomplete terrCVM field UI scaffold: ${selector}`);
    return element;
  };

  const csvFile = query<HTMLInputElement>('#csv-file');
  const csvStatus = query<HTMLElement>('#csv-status');
  const csvTable = query<HTMLTableElement>('#csv-table');
  const csvRows = query<HTMLElement>('#csv-rows');
  const csvExcluded = query<HTMLElement>('#csv-excluded');
  const classifyButton = query<HTMLButtonElement>('#classify-button');
  const windowReportBox = query<HTMLElement>('#window-report');
  const reportOutcome = query<HTMLElement>('#report-outcome');
  const reportPrrA = query<HTMLElement>('#report-prr-a');
  const reportPrrB = query<HTMLElement>('#report-prr-b');
  const reportBracket = query<HTMLElement>('#report-bracket');
  const reportNote = query<HTMLElement>('#report-note');
  const exportButton = query<HTMLButtonElement>('#export-button');
  const exportStatus = query<HTMLElement>('#export-status');

  const text = (id: string): string => query<HTMLInputElement>(`#${id}`).value.trim();
  const num = (id: string): number => Number(query<HTMLInputElement>(`#${id}`).value.trim());
  const checked = (id: string): boolean => query<HTMLInputElement>(`#${id}`).checked;

  let parse: RangeTestParse | null = null;
  let report: WindowReport | null = null;

  const renderParse = (): void => {
    if (!parse) return;
    const { link, excluded } = splitLinkRecords(parse.records);
    csvTable.hidden = false;
    csvRows.innerHTML = link
      .map(
        (record) => `
          <tr>
            <td>${record.seq ?? '—'}</td>
            <td>${record.from}</td>
            <td>${record.rxTime}</td>
            <td>${record.rxRssiDbm ?? '—'}</td>
            <td>${record.rxSnrDb.toFixed(2)}</td>
            <td>${record.hopLimit}</td>
          </tr>`,
      )
      .join('');
    csvStatus.textContent =
      `${link.length} link packet${link.length === 1 ? '' : 's'}; ` +
      `${excluded.length} excluded; ${parse.rejections.length} malformed line` +
      `${parse.rejections.length === 1 ? '' : 's'}`;
    const findings = [
      ...excluded.map(({ record, reason }) => `line for seq ${record.seq ?? '?'}: ${reason}`),
      ...parse.rejections.map((rejection) => `line ${rejection.line}: ${rejection.reason}`),
    ];
    csvExcluded.hidden = findings.length === 0;
    csvExcluded.textContent = findings.join(' · ');
  };

  csvFile.addEventListener('change', () => {
    const file = csvFile.files?.[0];
    if (!file) return;
    void file.text().then((content) => {
      try {
        parse = parseRangeTestCsv(content);
        report = null;
        windowReportBox.hidden = true;
        renderParse();
      } catch (error) {
        parse = null;
        csvTable.hidden = true;
        csvExcluded.hidden = true;
        csvStatus.textContent =
          error instanceof RangeTestFormatError ? error.message : 'The file could not be read.';
      }
    });
  });

  classifyButton.addEventListener('click', () => {
    if (!parse) {
      csvStatus.textContent = 'Load a rangetest.csv first.';
      return;
    }
    try {
      report = classifyWindow({
        records: parse.records,
        beaconA: text('beacon-a'),
        beaconB: text('beacon-b'),
        expectedA: { lo: num('expected-a-lo'), hi: num('expected-a-hi') },
        expectedB: { lo: num('expected-b-lo'), hi: num('expected-b-hi') },
        loopbackOpen: checked('loopback-open'),
        loopbackClose: checked('loopback-close'),
      });
    } catch (error) {
      report = null;
      windowReportBox.hidden = true;
      csvStatus.textContent = error instanceof Error ? error.message : 'Classification failed.';
      return;
    }
    windowReportBox.hidden = false;
    reportOutcome.textContent = report.outcome.toUpperCase();
    reportOutcome.dataset.outcome = report.outcome;
    reportPrrA.textContent = `${report.a.received.length}/${report.a.expected} = ${report.a.prr.toFixed(2)}`;
    reportPrrB.textContent = `${report.b.received.length}/${report.b.expected} = ${report.b.prr.toFixed(2)}`;
    reportBracket.textContent = report.censorBracketDbm
      ? `${report.censorBracketDbm.lo ?? '−∞'} … ${report.censorBracketDbm.hi} dBm`
      : '—';
    reportNote.textContent = report.note;
  });

  exportButton.addEventListener('click', () => {
    const visit: SiteVisit = {
      siteId: text('site-id'),
      operatorId: text('operator-id'),
      date: text('visit-date'),
      arrivalLocal: text('arrival-local'),
      windowStartUtc: text('window-start'),
      windowEndUtc: text('window-end'),
      stationMarks: num('station-marks'),
      loopbackOpen: checked('loopback-open'),
      loopbackClose: checked('loopback-close'),
      poleMarkM: num('pole-mark'),
      antennaTiltDeg: num('antenna-tilt'),
      poleFoot: text('pole-foot') as SiteVisit['poleFoot'],
      nodeSerial: text('node-serial'),
      antennaSerial: text('antenna-serial'),
      configHash: text('config-hash'),
      gnssLat: num('gnss-lat'),
      gnssLon: num('gnss-lon'),
      gnssAccM: num('gnss-acc'),
      gnssScatterM: num('gnss-scatter'),
      leafState: text('leaf-state') as SiteVisit['leafState'],
      precip: text('precip') as SiteVisit['precip'],
      wind: text('wind') as SiteVisit['wind'],
      photoCount: num('photo-count'),
      notes: query<HTMLTextAreaElement>('#visit-notes').value,
    };
    const validation = validateSiteVisit(visit);
    if (!validation.ok) {
      exportStatus.textContent = validation.problems.join(' · ');
      return;
    }
    const record = {
      schema: SITE_VISIT_SCHEMA,
      visit,
      window: report,
      packets: parse?.records ?? [],
    };
    const blob = new Blob([`${JSON.stringify(record, null, 2)}\n`], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${visit.siteId || 'site'}-${visit.date || 'visit'}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    exportStatus.textContent = 'Record exported. Hand it in with the photos — nulls included.';
  });
}
