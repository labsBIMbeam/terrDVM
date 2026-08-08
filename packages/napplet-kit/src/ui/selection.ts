import { geodesicAreaKm2, validateBBox } from '@terrcvm/terrain-engine/bbox/area';
import type { BBox4326, BBoxErrorCode } from '@terrcvm/terrain-engine/bbox/validate';
import { MAX_AREA_KM2 } from '@terrcvm/terrain-engine/config/defaults';
import { errorCopyFor } from './copy';

export const UNDO_WINDOW_MS = 10_000;

type EmptyState = {
  kind: 'EMPTY';
  bbox: null;
};

type DrawingState = {
  kind: 'DRAWING';
  bbox: BBox4326 | null;
  previous: SelectableState;
};

type SelectedValidState = {
  kind: 'SELECTED_VALID';
  bbox: BBox4326;
  areaKm2: number;
};

type SelectedInvalidState = {
  kind: 'SELECTED_INVALID';
  bbox: BBox4326;
  errorCode: BBoxErrorCode;
  error: string;
};

type EditingState = {
  kind: 'EDITING';
  bbox: BBox4326;
  previous: SelectedValidState | SelectedInvalidState;
};

type SelectableState = EmptyState | SelectedValidState | SelectedInvalidState;
type ClearableState = SelectableState | EditingState;

type ClearedUndoableState = {
  kind: 'CLEARED_UNDOABLE';
  previous: ClearableState;
  expiresAt: number;
};

export type SelectionState =
  | EmptyState
  | DrawingState
  | SelectedValidState
  | SelectedInvalidState
  | EditingState
  | ClearedUndoableState;

export type SelectionAction =
  | { type: 'DRAW_START' }
  | { type: 'DRAW_COMPLETE'; bbox: unknown }
  | { type: 'DRAW_CANCEL' }
  | { type: 'EDIT_START' }
  | { type: 'EDIT_COMPLETE'; bbox: unknown }
  | { type: 'APPLY_COORDINATES'; bbox: unknown }
  | { type: 'CLEAR'; now: number }
  | { type: 'RESTORE'; now: number }
  | { type: 'EXPIRE'; now: number };

export function createInitialSelectionState(): EmptyState {
  return { kind: 'EMPTY', bbox: null };
}

function copyForInvalidBBox(bbox: BBox4326, code: BBoxErrorCode): string {
  if (code === 'AREA_LIMIT') {
    return errorCopyFor('AREA_LIMIT', {
      areaKm2: geodesicAreaKm2(bbox),
      maxAreaKm2: MAX_AREA_KM2,
    });
  }
  return errorCopyFor(code);
}

function validatedState(input: unknown): SelectedValidState | SelectedInvalidState {
  const result = validateBBox(input);
  if (result.ok) {
    return { kind: 'SELECTED_VALID', bbox: result.bbox, areaKm2: result.areaKm2 };
  }

  const bbox = Array.isArray(input) && input.length === 4
    ? input as unknown as BBox4326
    : [Number.NaN, Number.NaN, Number.NaN, Number.NaN] as BBox4326;

  return {
    kind: 'SELECTED_INVALID',
    bbox,
    errorCode: result.code,
    error: copyForInvalidBBox(bbox, result.code),
  };
}

function isSelectable(state: SelectionState): state is SelectableState {
  return (
    state.kind === 'EMPTY' ||
    state.kind === 'SELECTED_VALID' ||
    state.kind === 'SELECTED_INVALID'
  );
}

function isClearable(state: SelectionState): state is ClearableState {
  return isSelectable(state) || state.kind === 'EDITING';
}

export function selectionReducer(
  state: SelectionState,
  action: SelectionAction,
): SelectionState {
  switch (action.type) {
    case 'DRAW_START': {
      if (isSelectable(state)) {
        return { kind: 'DRAWING', bbox: state.bbox, previous: state };
      }
      const previous = createInitialSelectionState();
      return { kind: 'DRAWING', bbox: previous.bbox, previous };
    }

    case 'DRAW_COMPLETE': {
      if (state.kind !== 'DRAWING') {
        return state;
      }
      return validatedState(action.bbox);
    }

    case 'DRAW_CANCEL': {
      return state.kind === 'DRAWING' ? state.previous : state;
    }

    case 'EDIT_START': {
      if (state.kind !== 'SELECTED_VALID' && state.kind !== 'SELECTED_INVALID') {
        return state;
      }
      return { kind: 'EDITING', bbox: state.bbox, previous: state };
    }

    case 'EDIT_COMPLETE': {
      return state.kind === 'EDITING' ? validatedState(action.bbox) : state;
    }

    case 'APPLY_COORDINATES': {
      const next = validatedState(action.bbox);
      return next.kind === 'SELECTED_VALID' ? next : state;
    }

    case 'CLEAR': {
      if (!isClearable(state) || state.kind === 'EMPTY') {
        return state;
      }
      return {
        kind: 'CLEARED_UNDOABLE',
        previous: state,
        expiresAt: action.now + UNDO_WINDOW_MS,
      };
    }

    case 'RESTORE': {
      if (state.kind !== 'CLEARED_UNDOABLE') {
        return state;
      }
      return action.now < state.expiresAt
        ? state.previous
        : createInitialSelectionState();
    }

    case 'EXPIRE': {
      if (state.kind !== 'CLEARED_UNDOABLE') {
        return state;
      }
      return action.now >= state.expiresAt
        ? createInitialSelectionState()
        : state;
    }
  }
}
