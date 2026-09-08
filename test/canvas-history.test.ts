import { act, renderHook } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import type { CanvasOperation } from '../src/contracts';
import type { MacroExecutionResult, MacroPlan } from '../src/macros/types';
import { useCanvasHistory } from '../src/web/use-canvas-history';
import type { CanvasDocument } from '../src/web/v2-types';

const canvas: CanvasDocument = {
  id: 'history',
  title: 'History',
  createdBy: 'user',
  createdAt: '',
  updatedAt: '',
  bounds: { mode: 'unlimited' },
  elements: [],
  revision: 1,
  documentVersion: 2
};
const forward: CanvasOperation[] = [{ op: 'deleteElement', elementId: 'one' }];
const inverse: CanvasOperation[] = [{ op: 'clear' }];

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((success, failure) => {
    resolve = success;
    reject = failure;
  });
  return { promise, resolve, reject };
}

function move(x: number): CanvasOperation[] {
  return [{ op: 'patchElementFrame', elementId: 'one', frame: { x } }];
}

function movingCanvas(revision = 1, x = 0): CanvasDocument {
  return {
    ...canvas,
    revision,
    elements: [{ id: 'one', type: 'fixture/card', schemaVersion: 1, x, y: 0, data: {} }]
  };
}

function savedMove(operations: readonly CanvasOperation[], revision: number): CanvasDocument {
  const operation = operations[0];
  if (operation?.op !== 'patchElementFrame' || typeof operation.frame.x !== 'number') {
    throw new Error('Expected one position change');
  }
  return movingCanvas(revision + 1, operation.frame.x);
}

const movePlan: MacroPlan = {
  planId: 'move-plan',
  canvasId: canvas.id,
  canvasRevision: 1,
  macroId: 'move',
  macroVersion: 1,
  anchor: { x: 0, y: 0 },
  inputDigest: 'input',
  planDigest: 'digest',
  createdAt: '',
  expiresAt: '',
  operations: [{ op: 'upsertElement', element: movingCanvas(2, 10).elements[0] }],
  previewElements: movingCanvas(2, 10).elements,
  outputs: {},
  effectSummary: { label: 'Move', operationCount: 1, generatedElementCount: 0, affectedElementIds: ['one'] }
};

const moved: MacroExecutionResult = {
  canvas: movingCanvas(2, 10),
  outputs: {},
  provenance: { macroId: 'move', macroVersion: 1, planId: movePlan.planId, inputDigest: 'input', planDigest: 'digest' },
  history: { label: 'Move', forward: movePlan.operations, inverse: move(0), affectedElementIds: ['one'] }
};

it('serializes overlapping undo and redo through persistence and history confirmation', async () => {
  const save = vi.fn(async (operations: readonly CanvasOperation[], revision: number) =>
    savedMove(operations, revision)
  );
  const initial = movingCanvas();
  const { result } = renderHook(() => useCanvasHistory({ canvas: initial, readOnly: false, onCanvasOperations: save }));
  await act(async () => {
    await result.current.commitHistory('Move 1', move(10), move(0), ['one']);
    await result.current.commitHistory('Move 2', move(20), move(10), ['one']);
  });
  for (const [direction, positions, firstRevision] of [
    ['undo', [10, 0], 3],
    ['redo', [10, 20], 5]
  ] as const) {
    const started = deferred<void>();
    const pending = deferred<CanvasDocument>();
    save.mockClear();
    save.mockImplementationOnce(() => {
      started.resolve();
      return pending.promise;
    });
    await act(async () => {
      const outcomes = Promise.allSettled([
        result.current[direction](),
        result.current[direction](),
        result.current[direction]()
      ]);
      await started.promise;
      expect(save).toHaveBeenCalledTimes(1);
      pending.resolve(movingCanvas(firstRevision + 1, positions[0]));
      expect(await outcomes).toEqual([
        { status: 'fulfilled', value: ['one'] },
        { status: 'fulfilled', value: ['one'] },
        { status: 'fulfilled', value: undefined }
      ]);
    });
    expect(save.mock.calls).toEqual([
      [move(positions[0]), firstRevision],
      [move(positions[1]), firstRevision + 1]
    ]);
    expect(result.current.getConfirmedDocument()).toEqual(movingCanvas(firstRevision + 2, positions[1]));
    expect(result.current.canUndo).toBe(direction === 'redo');
    expect(result.current.canRedo).toBe(direction === 'undo');
  }
});

it.each(['undo', 'redo'] as const)('preserves a failed %s entry for the next queued attempt', async (direction) => {
  const initial = movingCanvas();
  const save = vi.fn(async (operations: readonly CanvasOperation[], revision: number) =>
    savedMove(operations, revision)
  );
  const { result } = renderHook(() => useCanvasHistory({ canvas: initial, readOnly: false, onCanvasOperations: save }));
  await act(async () => {
    await result.current.commitHistory('Move', move(10), move(0), ['one']);
    if (direction === 'redo') await result.current.undo();
  });
  const revision = result.current.getConfirmedDocument().revision;
  const before = result.current.getConfirmedDocument();
  const failed = deferred<CanvasDocument>();
  const started = deferred<void>();
  const retry = deferred<CanvasDocument>();
  const retryStarted = deferred<void>();
  save.mockClear();
  save
    .mockImplementationOnce(() => {
      started.resolve();
      return failed.promise;
    })
    .mockImplementationOnce(() => {
      retryStarted.resolve();
      return retry.promise;
    });
  const error = new Error('save failed');
  await act(async () => {
    const outcomes = Promise.allSettled([result.current[direction](), result.current[direction]()]);
    await started.promise;
    failed.reject(error);
    await retryStarted.promise;
    expect(result.current.getConfirmedDocument()).toBe(before);
    expect(direction === 'undo' ? result.current.canUndo : result.current.canRedo).toBe(true);
    retry.resolve(savedMove(move(direction === 'undo' ? 0 : 10), revision));
    expect(await outcomes).toEqual([
      { status: 'rejected', reason: error },
      { status: 'fulfilled', value: ['one'] }
    ]);
  });
  expect(save.mock.calls).toEqual([
    [move(direction === 'undo' ? 0 : 10), revision],
    [move(direction === 'undo' ? 0 : 10), revision]
  ]);
  expect(result.current.canUndo).toBe(direction === 'redo');
  expect(result.current.canRedo).toBe(direction === 'undo');
});

it.each(['edit', 'macro'] as const)('undo waits for a pending %s to record its history', async (kind) => {
  const initial = movingCanvas();
  const started = deferred<void>();
  const finish = deferred<void>();
  const save = vi.fn(async (operations: readonly CanvasOperation[], revision: number) =>
    savedMove(operations, revision)
  );
  const execute = vi.fn(async () => {
    started.resolve();
    await finish.promise;
    return moved;
  });
  if (kind === 'edit')
    save.mockImplementationOnce(async (operations, revision) => {
      started.resolve();
      await finish.promise;
      return savedMove(operations, revision);
    });
  const { result } = renderHook(() =>
    useCanvasHistory({ canvas: initial, readOnly: false, onCanvasOperations: save, onMacroExecute: execute })
  );
  await act(async () => {
    const pending =
      kind === 'edit'
        ? result.current.commitHistory('Move', move(10), move(0), ['one'])
        : result.current.runMacro(movePlan);
    await started.promise;
    const undo = result.current.undo();
    finish.resolve();
    await pending;
    expect(await undo).toEqual(['one']);
  });
  expect(save).toHaveBeenLastCalledWith(move(0), 2);
  expect(result.current.getConfirmedDocument()).toEqual(movingCanvas(3, 0));
  expect(result.current.canUndo).toBe(false);
  expect(result.current.canRedo).toBe(true);
  if (kind === 'macro') expect(execute).toHaveBeenCalledWith(expect.objectContaining({ expectedRevision: 1 }));
});

it.each([
  'canvas switch',
  'read-only transition'
] as const)('guards pending and queued undo during a %s', async (change) => {
  const initial = movingCanvas();
  const save = vi.fn(async (operations: readonly CanvasOperation[], revision: number) =>
    savedMove(operations, revision)
  );
  const { result, rerender } = renderHook(
    ({ document, readOnly }) => useCanvasHistory({ canvas: document, readOnly, onCanvasOperations: save }),
    { initialProps: { document: initial, readOnly: false } }
  );
  await act(async () => {
    await result.current.commitHistory('Move 1', move(10), move(0), ['one']);
    await result.current.commitHistory('Move 2', move(20), move(10), ['one']);
  });
  const started = deferred<void>();
  const pending = deferred<CanvasDocument>();
  save.mockClear();
  save.mockImplementationOnce(() => {
    started.resolve();
    return pending.promise;
  });
  let outcomes!: Promise<PromiseSettledResult<string[] | undefined>[]>;
  await act(async () => {
    outcomes = Promise.allSettled([result.current.undo(), result.current.undo()]);
    await started.promise;
  });
  const next = change === 'canvas switch' ? { ...initial, id: 'next' } : initial;
  rerender({ document: next, readOnly: change === 'read-only transition' });
  await act(async () => {
    pending.resolve(movingCanvas(4, 10));
    expect((await outcomes).map((outcome) => outcome.status)).toEqual([
      change === 'canvas switch' ? 'rejected' : 'fulfilled',
      'rejected'
    ]);
  });
  expect(save).toHaveBeenCalledTimes(1);
  expect(result.current.getConfirmedDocument()).toEqual(change === 'canvas switch' ? next : movingCanvas(4, 10));
  expect(result.current.canUndo).toBe(false);
  expect(result.current.canRedo).toBe(false);
});

it('does not install a delayed macro or run its queued undo after a canvas switch', async () => {
  const initial = movingCanvas();
  const started = deferred<void>();
  const pending = deferred<MacroExecutionResult>();
  const execute = vi.fn(() => {
    started.resolve();
    return pending.promise;
  });
  const save = vi.fn();
  const { result, rerender } = renderHook(
    ({ document }) =>
      useCanvasHistory({ canvas: document, readOnly: false, onCanvasOperations: save, onMacroExecute: execute }),
    { initialProps: { document: initial } }
  );
  let outcomes!: Promise<PromiseSettledResult<unknown>[]>;
  await act(async () => {
    outcomes = Promise.allSettled([result.current.runMacro(movePlan), result.current.undo()]);
    await started.promise;
  });
  const next = { ...initial, id: 'next' };
  rerender({ document: next });
  await act(async () => {
    pending.resolve(moved);
    expect((await outcomes).map((outcome) => outcome.status)).toEqual(['rejected', 'rejected']);
  });
  expect(save).not.toHaveBeenCalled();
  expect(result.current.getConfirmedDocument()).toBe(next);
  expect(result.current.canUndo).toBe(false);
  expect(result.current.canRedo).toBe(false);
});

it('does not install a delayed save into a different canvas or run queued writes for it', async () => {
  let finish!: (document: CanvasDocument) => void;
  const save = vi.fn(
    () =>
      new Promise<CanvasDocument>((resolve) => {
        finish = resolve;
      })
  );
  const { result, rerender } = renderHook(
    ({ document }) => useCanvasHistory({ canvas: document, readOnly: false, onCanvasOperations: save }),
    { initialProps: { document: canvas } }
  );
  let first!: Promise<void>;
  let queued!: Promise<void>;
  await act(async () => {
    first = result.current.commitHistory('first', forward, inverse, []);
    queued = result.current.commitHistory('queued', forward, inverse, []);
    await Promise.resolve();
  });
  const next = { ...canvas, id: 'next' };
  rerender({ document: next });
  await act(async () => {
    const outcomes = Promise.allSettled([first, queued]);
    finish({ ...canvas, revision: 2 });
    expect((await outcomes).map((outcome) => outcome.status)).toEqual(['rejected', 'rejected']);
  });
  expect(save).toHaveBeenCalledOnce();
  expect(result.current.getConfirmedDocument()).toBe(next);
  expect(result.current.canUndo).toBe(false);
});

it('rejects direct mutations in read-only mode before invoking persistence', async () => {
  const save = vi.fn();
  const { result } = renderHook(() => useCanvasHistory({ canvas, readOnly: true, onCanvasOperations: save }));
  await expect(result.current.commitHistory('delete', forward, inverse, [])).rejects.toThrow('read-only');
  expect(save).not.toHaveBeenCalled();
});

it('records successful saves only and continues after rejection at the confirmed revision', async () => {
  const save = vi
    .fn()
    .mockRejectedValueOnce(new Error('save failed'))
    .mockResolvedValueOnce({ ...canvas, revision: 2 });
  const { result } = renderHook(() => useCanvasHistory({ canvas, readOnly: false, onCanvasOperations: save }));
  await act(async () => {
    await expect(result.current.commitHistory('delete', forward, inverse, ['one'])).rejects.toThrow('save failed');
  });
  expect(result.current.canUndo).toBe(false);
  expect(result.current.getConfirmedDocument()).toBe(canvas);
  await act(async () => {
    await result.current.commitHistory('delete', forward, inverse, ['one']);
  });
  expect(save.mock.calls.map((call) => call[1])).toEqual([1, 1]);
  expect(result.current.canUndo).toBe(true);
  expect(result.current.getConfirmedDocument().revision).toBe(2);
});

it('preserves local history on confirmed rerender and clears it for external revisions and canvas switches', async () => {
  const save = vi.fn(async (_operations, revision: number) => ({ ...canvas, revision: revision + 1 }));
  const { result, rerender } = renderHook(
    ({ document }) => useCanvasHistory({ canvas: document, readOnly: false, onCanvasOperations: save }),
    { initialProps: { document: canvas } }
  );
  await act(async () => {
    await result.current.commitHistory('delete', forward, inverse, []);
  });
  rerender({ document: { ...canvas, revision: 2 } });
  expect(result.current.canUndo).toBe(true);
  rerender({ document: { ...canvas, revision: 3 } });
  expect(result.current.canUndo).toBe(false);
  await act(async () => {
    await result.current.commitHistory('delete', forward, inverse, []);
  });
  rerender({ document: { ...canvas, id: 'another' } });
  expect(result.current.canUndo).toBe(false);
  expect(result.current.getConfirmedDocument().id).toBe('another');
});

it('reuses a failed macro key and records a successful macro as one undo unit', async () => {
  const plan: MacroPlan = {
    planId: 'plan',
    canvasId: canvas.id,
    canvasRevision: 1,
    macroId: 'macro',
    macroVersion: 1,
    anchor: { x: 0, y: 0 },
    inputDigest: 'input',
    planDigest: 'digest',
    createdAt: '',
    expiresAt: '',
    operations: [],
    previewElements: [],
    outputs: {},
    effectSummary: { label: 'Macro', operationCount: 1, generatedElementCount: 0, affectedElementIds: [] }
  };
  const completed: MacroExecutionResult = {
    canvas: { ...canvas, revision: 2 },
    outputs: {},
    provenance: { macroId: 'macro', macroVersion: 1, planId: plan.planId, inputDigest: 'input', planDigest: 'digest' },
    history: { label: 'Macro', forward, inverse, affectedElementIds: [] }
  };
  const execute = vi.fn().mockRejectedValueOnce(new Error('network lost')).mockResolvedValueOnce(completed);
  const save = vi.fn(async () => ({ ...canvas, revision: 3 }));
  const { result } = renderHook(() =>
    useCanvasHistory({ canvas, readOnly: false, onMacroExecute: execute, onCanvasOperations: save })
  );
  await act(async () => {
    await expect(result.current.runMacro(plan)).rejects.toThrow('network lost');
  });
  expect(result.current.canUndo).toBe(false);
  await act(async () => {
    await result.current.runMacro(plan);
  });
  expect(execute.mock.calls[0][0].idempotencyKey).toBe(execute.mock.calls[1][0].idempotencyKey);
  await act(async () => {
    await result.current.undo();
  });
  expect(save).toHaveBeenCalledWith(inverse, 2);
  expect(result.current.canUndo).toBe(false);
  expect(result.current.canRedo).toBe(true);
});
