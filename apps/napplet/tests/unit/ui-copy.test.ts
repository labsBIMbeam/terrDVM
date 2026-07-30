import { describe, expect, it } from 'vitest';

import { MAX_AREA_KM2, OUTPUT_MIME, RES_M, TIMEOUT_S } from '../../src/config/defaults';
import { COPY, errorCopyFor } from '../../src/ui/copy';

describe('Phase 1 UI copy contract', () => {
  it('ui_copy_matches_contract_for_every_map04_error', () => {
    expect(errorCopyFor('MALFORMED')).toBe(
      'Coordinates must be finite decimal degrees. Check each field for empty values or stray characters.',
    );
    expect(errorCopyFor('NON_FINITE')).toBe(
      'Coordinates must be finite decimal degrees. Check each field for empty values or stray characters.',
    );
    expect(errorCopyFor('RANGE')).toBe(
      'Longitude must be between −180 and 180, latitude between −90 and 90.',
    );
    expect(errorCopyFor('ORDER')).toBe(
      'West must be less than east, and south must be less than north.',
    );
    expect(errorCopyFor('ANTIMERIDIAN_AMBIGUOUS')).toBe(
      'Selections crossing the ±180° line are not supported in this version. Draw a rectangle that stays on one side of the antimeridian.',
    );
    expect(
      errorCopyFor('AREA_LIMIT', {
        areaKm2: 125.5,
        maxAreaKm2: MAX_AREA_KM2,
      }),
    ).toBe(
      "Selected area is 125.5 km², over the 100 km² limit for this service. Draw a smaller rectangle or lower the coordinates' span.",
    );
  });

  it('ui_copy_matches_contract_for_buttons_and_states', () => {
    expect(COPY.buttons.drawBoundingBox).toBe('Draw bounding box');
    expect(COPY.buttons.stopDrawing).toBe('Stop drawing');
    expect(COPY.buttons.enterCoordinates).toBe('Enter coordinates');
    expect(COPY.buttons.applyCoordinates).toBe('Apply coordinates');
    expect(COPY.buttons.clearSelection).toBe('Clear selection');
    expect(COPY.buttons.restoreSelection).toBe('Restore selection');
    expect(COPY.buttons.retryPreview).toBe('Retry preview');

    expect(COPY.emptyState.heading).toBe('No area selected');
    expect(COPY.emptyState.body).toBe(
      'Draw a rectangle on the map or enter coordinates to define the terrain area for this request.',
    );
    expect(COPY.helpers.drawPointer).toBe(
      'Click and drag on the map to draw the rectangle. Press Escape or choose Stop drawing to exit.',
    );
    expect(COPY.helpers.drawTouch).toBe('Touch and drag on the map to draw the rectangle.');
    expect(COPY.helpers.editSelection).toBe(
      'Drag a corner handle to resize or drag inside the rectangle to move it. Area and request preview update when you release.',
    );
    expect(COPY.toast.selectionCleared).toBe('Selection cleared.');
    expect(COPY.selectionReady(12.5)).toBe(
      'Selection ready. 12.5 km² — the request preview below reflects this selection.',
    );
    expect(COPY.preview.loading).toBe('Loading preview for the selected area…');
    expect(
      COPY.sourceAttribution({
        sourceAttribution: 'Example Source',
        licenseId: 'CC-BY-4.0',
      }),
    ).toBe(
      'Basemap © OpenStreetMap contributors · Imagery © Example Source — CC-BY-4.0',
    );
    expect(COPY.fixedDefaults.resolution).toBe(
      `Resolution: ${RES_M} m/px — fixed for v1`,
    );
    expect(COPY.fixedDefaults.resolution).toBe('Resolution: 5 m/px — fixed for v1');
    expect(COPY.fixedDefaults.output).toBe(
      `Output: ${OUTPUT_MIME} — fixed for v1`,
    );
    expect(COPY.fixedDefaults.output).toBe(
      'Output: model/gltf-binary — fixed for v1',
    );
    expect(COPY.fixedDefaults.helperCaption).toBe(
      'These values are set by the service and cannot be changed in this version.',
    );
  });

  it('ui_copy_covers_transport_states', () => {
    expect(COPY.preview.denied).toBe(
      'Imagery access was denied by the shell. Your selection and request preview remain valid. Grant the resource capability in the shell, then choose Retry preview.',
    );
    expect(COPY.preview.timeout(TIMEOUT_S)).toBe(
      'The imagery source did not respond within 15 seconds. Your selection is unchanged. Choose Retry preview to try again.',
    );
    expect(COPY.preview.failed).toBe(
      'The imagery preview could not be loaded. Your selection and request preview remain valid. Choose Retry preview to try again.',
    );
    expect(COPY.sourceUnavailable.heading).toBe('Source unavailable');
    expect(COPY.sourceUnavailable.body).toBe(
      'No trusted imagery source is active. Bounding-box selection and the request preview work normally; the orthophoto preview stays off until a source is approved.',
    );
    expect(COPY.preview.offline).toBe(
      'You appear to be offline. Map tiles and imagery may be missing or stale; selection tools and the request preview still work.',
    );
    expect(COPY.fixture.badge).toBe('TEST FIXTURE');
    expect(COPY.fixture.body).toBe(
      'This image is a bundled test fixture, not live orthophoto imagery of the selected area.',
    );
    expect(COPY.preview.fallbackTransportLabel).toBe(
      'Preview served through the local authenticated fallback, not the shell resource path.',
    );

    expect(COPY.requestPanel.title).toBe('Request preview');
    expect(COPY.requestPanel.bboxLabel).toBe(
      'Bounding box (W, S, E, N — EPSG:4326)',
    );
    expect(COPY.requestPanel.sourceRow('Example Source', 'live')).toBe(
      'Source: Example Source — live',
    );
    expect(COPY.requestPanel.sourceRow('Example Source', 'test fixture')).toBe(
      'Source: Example Source — test fixture',
    );
    expect(COPY.requestPanel.sourceRow('Example Source', 'local fallback')).toBe(
      'Source: Example Source — local fallback',
    );
    expect(COPY.requestPanel.sourceRow('', 'unavailable')).toBe(
      'Source: — unavailable',
    );

    expect(COPY.boot.skipToRequestPanel).toBe('Skip to request panel');
    expect(COPY.boot.toolbarLabel).toBe('Toolbar');
    expect(COPY.boot.appTitle).toBe('terrDVM');
    expect(COPY.boot.mapRegionLabel).toBe('Map region');
    expect(COPY.requestPanel.emptyBbox).toBe('—, —, —, —');
    expect(COPY.requestPanel.crsLabel).toBe('CRS');
    expect(COPY.requestPanel.crsValue).toBe('EPSG:4326');
    expect(COPY.requestPanel.resolutionLabel).toBe('Resolution');
    expect(COPY.requestPanel.outputLabel).toBe('Output');
    expect(COPY.requestPanel.sourceLabel).toBe('Source');
  });
});
