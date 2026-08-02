import type { TerrainProgress } from '../terrain/generate';
import type { TerrainMesh } from '@terrcvm/terrain-engine/terrain/mesh';
import type { BBox4326 } from '@terrcvm/terrain-engine/bbox/validate';

/**
 * Demo job gate: selection → terrain generation → 3D preview.
 *
 * The payment stage is deliberately skipped for this demo; see `./invoice.ts`
 * for the unwired placeholder that the payment phase will use.
 */
export type JobFlowState =
  | { kind: 'CLOSED' }
  | { kind: 'READY'; bbox: BBox4326; areaKm2: number }
  | { kind: 'GENERATING'; bbox: BBox4326; areaKm2: number; progress: TerrainProgress | null }
  | { kind: 'PREVIEW'; bbox: BBox4326; areaKm2: number; mesh: TerrainMesh }
  | { kind: 'FAILED'; bbox: BBox4326; areaKm2: number; message: string };

export type JobFlowAction =
  | { type: 'OPEN'; bbox: BBox4326; areaKm2: number }
  | { type: 'START_GENERATING' }
  | { type: 'PROGRESS'; progress: TerrainProgress }
  | { type: 'TERRAIN_READY'; mesh: TerrainMesh }
  | { type: 'FAIL'; message: string }
  | { type: 'RETRY' }
  | { type: 'CLOSE' };

export function createInitialJobFlowState(): JobFlowState {
  return { kind: 'CLOSED' };
}

/**
 * Every transition is explicit and fails closed: an action that does not belong
 * to the current stage returns the state unchanged.
 */
export function jobFlowReducer(state: JobFlowState, action: JobFlowAction): JobFlowState {
  switch (action.type) {
    case 'OPEN': {
      if (!Number.isFinite(action.areaKm2) || action.areaKm2 <= 0) return state;
      return { kind: 'READY', bbox: action.bbox, areaKm2: action.areaKm2 };
    }

    case 'START_GENERATING': {
      if (state.kind !== 'READY') return state;
      return { kind: 'GENERATING', bbox: state.bbox, areaKm2: state.areaKm2, progress: null };
    }

    case 'PROGRESS': {
      if (state.kind !== 'GENERATING') return state;
      return { ...state, progress: action.progress };
    }

    case 'TERRAIN_READY': {
      if (state.kind !== 'GENERATING') return state;
      return {
        kind: 'PREVIEW',
        bbox: state.bbox,
        areaKm2: state.areaKm2,
        mesh: action.mesh,
      };
    }

    case 'FAIL': {
      if (state.kind !== 'GENERATING') return state;
      return {
        kind: 'FAILED',
        bbox: state.bbox,
        areaKm2: state.areaKm2,
        message: action.message,
      };
    }

    case 'RETRY': {
      if (state.kind !== 'FAILED') return state;
      return { kind: 'READY', bbox: state.bbox, areaKm2: state.areaKm2 };
    }

    case 'CLOSE': {
      return state.kind === 'CLOSED' ? state : { kind: 'CLOSED' };
    }
  }
}
