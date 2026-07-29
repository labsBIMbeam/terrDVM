import { describe, expect, it } from 'vitest';

import {
  createInitialJobFlowState,
  jobFlowReducer,
  type JobFlowState,
} from '../../src/job/job-flow';
import { buildTerrainMesh } from '../../src/terrain/mesh';
import { COPY } from '../../src/ui/copy';
import type { BBox4326 } from '../../src/bbox/validate';

const BBOX: BBox4326 = [-17.05, 32.7, -16.95, 32.78];
const AREA_KM2 = 83.2;

const MESH = buildTerrainMesh(
  { heights: new Float32Array([0, 1, 2, 3]), gridN: 2, minM: 0, maxM: 3 },
  BBOX,
);

function openReady(): JobFlowState {
  return jobFlowReducer(createInitialJobFlowState(), {
    type: 'OPEN',
    bbox: BBOX,
    areaKm2: AREA_KM2,
  });
}

function generating(): JobFlowState {
  return jobFlowReducer(openReady(), { type: 'START_GENERATING' });
}

describe('job flow state machine', () => {
  it('starts closed', () => {
    expect(createInitialJobFlowState()).toEqual({ kind: 'CLOSED' });
  });

  it('opens to READY carrying the selection', () => {
    const state = openReady();
    expect(state.kind).toBe('READY');
    if (state.kind !== 'READY') throw new Error('expected READY');
    expect(state.bbox).toEqual(BBOX);
    expect(state.areaKm2).toBe(AREA_KM2);
  });

  it('advances READY → GENERATING → PREVIEW, skipping any payment stage', () => {
    const inFlight = generating();
    expect(inFlight.kind).toBe('GENERATING');

    const previewing = jobFlowReducer(inFlight, { type: 'TERRAIN_READY', mesh: MESH });
    expect(previewing.kind).toBe('PREVIEW');
    if (previewing.kind !== 'PREVIEW') throw new Error('expected PREVIEW');
    expect(previewing.mesh).toBe(MESH);
    expect(previewing.bbox).toEqual(BBOX);
  });

  it('records progress only while generating', () => {
    const progress = { phase: 'fetching', loaded: 2, total: 6 } as const;
    const withProgress = jobFlowReducer(generating(), { type: 'PROGRESS', progress });
    expect(withProgress.kind).toBe('GENERATING');
    if (withProgress.kind !== 'GENERATING') throw new Error('expected GENERATING');
    expect(withProgress.progress).toEqual(progress);

    const ready = openReady();
    expect(jobFlowReducer(ready, { type: 'PROGRESS', progress })).toBe(ready);
  });

  it('fails into FAILED and recovers through RETRY', () => {
    const failed = jobFlowReducer(generating(), { type: 'FAIL', message: 'DEM unavailable' });
    expect(failed.kind).toBe('FAILED');
    if (failed.kind !== 'FAILED') throw new Error('expected FAILED');
    expect(failed.message).toBe('DEM unavailable');

    const retried = jobFlowReducer(failed, { type: 'RETRY' });
    expect(retried.kind).toBe('READY');
  });

  it('CLOSE returns to CLOSED from any open stage', () => {
    expect(jobFlowReducer(openReady(), { type: 'CLOSE' })).toEqual({ kind: 'CLOSED' });
    expect(jobFlowReducer(generating(), { type: 'CLOSE' })).toEqual({ kind: 'CLOSED' });
  });

  it('fails closed on out-of-order transitions', () => {
    const closed = createInitialJobFlowState();
    expect(jobFlowReducer(closed, { type: 'START_GENERATING' })).toBe(closed);

    // A mesh cannot land unless generation is actually in flight.
    const ready = openReady();
    expect(jobFlowReducer(ready, { type: 'TERRAIN_READY', mesh: MESH })).toBe(ready);
    expect(jobFlowReducer(closed, { type: 'TERRAIN_READY', mesh: MESH })).toBe(closed);

    // Generation cannot be re-entered once a preview exists.
    const previewing = jobFlowReducer(generating(), { type: 'TERRAIN_READY', mesh: MESH });
    expect(jobFlowReducer(previewing, { type: 'START_GENERATING' })).toBe(previewing);
    expect(jobFlowReducer(previewing, { type: 'FAIL', message: 'late' })).toBe(previewing);

    // RETRY only applies to a failure.
    expect(jobFlowReducer(ready, { type: 'RETRY' })).toBe(ready);
  });

  it('rejects an OPEN carrying a non-finite area', () => {
    const closed = createInitialJobFlowState();
    expect(jobFlowReducer(closed, { type: 'OPEN', bbox: BBOX, areaKm2: Number.NaN })).toBe(closed);
    expect(jobFlowReducer(closed, { type: 'OPEN', bbox: BBOX, areaKm2: 0 })).toBe(closed);
  });
});

describe('job flow copy contract', () => {
  it('names the demo stages without promising a payment', () => {
    expect(COPY.jobFlow.startButton).toBe('Start generating');
    expect(COPY.jobFlow.readyTitle).toBe('Generate terrain');
    expect(COPY.jobFlow.generatingTitle).toBe('Preparing your terrain job…');
    expect(COPY.jobFlow.previewTitle).toBe('Terrain preview');
    expect(COPY.jobFlow.demoNote).toBe(
      'Demo build: payment is skipped and no artifact is delivered. The mesh below is generated live from public elevation data.',
    );
  });
});
