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
