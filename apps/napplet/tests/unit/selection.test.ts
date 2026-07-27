import { errorCopyFor } from '../../src/ui/copy';
import {
  createInitialSelectionState,
  selectionReducer,
  type SelectionState,
} from '../../src/ui/selection';

const validBBox = [-17.2, 32.6, -17.1, 32.7] as const;
const replacementBBox = [-17.3, 32.5, -17.15, 32.65] as const;
const invalidBBox = [-17.2, 32.7, -17.1, 32.6] as const;

function transition(
  state: SelectionState,
  action: Parameters<typeof selectionReducer>[1],
): SelectionState {
  return selectionReducer(state, action);
}

describe('selection state machine', () => {
  it('arms drawing, completes a valid rectangle, and exits drawing on Escape', () => {
    const empty = createInitialSelectionState();
    const drawing = transition(empty, { type: 'DRAW_START' });

    expect(drawing.kind).toBe('DRAWING');
    expect(transition(drawing, { type: 'DRAW_CANCEL' })).toEqual(empty);

    const selected = transition(drawing, {
      type: 'DRAW_COMPLETE',
      bbox: validBBox,
    });
    expect(selected.kind).toBe('SELECTED_VALID');
    expect(selected.bbox).toEqual(validBBox);
  });

  it('replaces the existing rectangle only when a second draw completes', () => {
    const selected = transition(
      transition(createInitialSelectionState(), { type: 'DRAW_START' }),
      { type: 'DRAW_COMPLETE', bbox: validBBox },
    );
    const drawing = transition(selected, { type: 'DRAW_START' });

    expect(drawing.kind).toBe('DRAWING');
    expect(drawing.bbox).toEqual(validBBox);

    const replaced = transition(drawing, {
      type: 'DRAW_COMPLETE',
      bbox: replacementBBox,
    });
    expect(replaced.kind).toBe('SELECTED_VALID');
    expect(replaced.bbox).toEqual(replacementBBox);
  });

  it('revalidates an edited rectangle to valid or invalid with the first error code', () => {
    const selected = transition(
      transition(createInitialSelectionState(), { type: 'DRAW_START' }),
      { type: 'DRAW_COMPLETE', bbox: validBBox },
    );
    const editing = transition(selected, { type: 'EDIT_START' });
    expect(editing.kind).toBe('EDITING');

    const invalid = transition(editing, {
      type: 'EDIT_COMPLETE',
      bbox: invalidBBox,
    });
    expect(invalid).toMatchObject({
      kind: 'SELECTED_INVALID',
      bbox: invalidBBox,
      errorCode: 'ORDER',
      error: errorCopyFor('ORDER'),
    });

    const valid = transition(invalid, {
      type: 'EDIT_COMPLETE',
      bbox: validBBox,
    });
    expect(valid).toMatchObject({ kind: 'SELECTED_VALID', bbox: validBBox });
  });

  it('applies coordinates atomically and leaves state unchanged on invalid input', () => {
    const selected = transition(
      transition(createInitialSelectionState(), { type: 'DRAW_START' }),
      { type: 'DRAW_COMPLETE', bbox: validBBox },
    );

    const afterInvalidApply = transition(selected, {
      type: 'APPLY_COORDINATES',
      bbox: invalidBBox,
    });

    expect(afterInvalidApply).toBe(selected);
  });

  it('clears to an undoable state, restores within ten seconds, and expires to empty', () => {
    const selected = transition(
      transition(createInitialSelectionState(), { type: 'DRAW_START' }),
      { type: 'DRAW_COMPLETE', bbox: validBBox },
    );
    const cleared = transition(selected, { type: 'CLEAR', now: 1_000 });

    expect(cleared).toMatchObject({
      kind: 'CLEARED_UNDOABLE',
      previous: selected,
      expiresAt: 11_000,
    });
    expect(
      transition(cleared, { type: 'RESTORE', now: 10_999 }),
    ).toBe(selected);
    expect(
      transition(cleared, { type: 'EXPIRE', now: 11_000 }),
    ).toEqual(createInitialSelectionState());
  });
});
