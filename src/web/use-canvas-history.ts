import { EditorHistory } from '@agentcanvas/editor';
import { nanoid } from 'nanoid';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { CanvasOperation } from '../contracts';
import type { MacroExecutionResult, MacroPlan, MacroServiceExecuteRequest } from '../macros/types';
import type { CanvasDocument } from './v2-types';

interface CanvasHistoryOptions {
  canvas: CanvasDocument;
  readOnly: boolean;
  onCanvasOperations?: (operations: readonly CanvasOperation[], expectedRevision: number) => Promise<CanvasDocument>;
  onMacroExecute?: (request: MacroServiceExecuteRequest) => Promise<MacroExecutionResult>;
}
export function useCanvasHistory({ canvas, readOnly, onCanvasOperations, onMacroExecute }: CanvasHistoryOptions) {
  const [version, setHistoryVersion] = useState(0);
  const lastLocalRevision = useRef<number | null>(null);
  const pendingLocalMutations = useRef(0);
  const confirmedCanvas = useRef(canvas);
  const currentCanvas = useRef({ id: canvas.id, readOnly });
  currentCanvas.current = { id: canvas.id, readOnly };
  const mutationQueue = useRef<Promise<void>>(Promise.resolve());
  const history = useRef(new EditorHistory<CanvasOperation>(100));
  const macroIdempotencyKeys = useRef(new Map<string, string>());
  const refreshCommandState = useCallback(() => setHistoryVersion((value) => value + 1), []);
  const runCanvasOperations = useCallback(
    async (operations: readonly CanvasOperation[]): Promise<CanvasDocument> => {
      if (!onCanvasOperations) throw new Error('Canvas mutations are unavailable.');
      const canvasId = confirmedCanvas.current.id;
      let result: CanvasDocument | null = null;
      const task = mutationQueue.current.then(async () => {
        if (currentCanvas.current.id !== canvasId) throw new Error('The canvas changed before saving.');
        if (currentCanvas.current.readOnly) throw new Error('The canvas is read-only.');
        pendingLocalMutations.current += 1;
        try {
          result = await onCanvasOperations(operations, confirmedCanvas.current.revision);
          if (currentCanvas.current.id !== canvasId) throw new Error('The canvas changed while saving.');
          confirmedCanvas.current = result;
          lastLocalRevision.current = result.revision;
        } finally {
          pendingLocalMutations.current -= 1;
        }
      });
      mutationQueue.current = task.catch(() => undefined);
      await task;
      if (!result) throw new Error('Canvas mutation did not return a document.');
      return result;
    },
    [onCanvasOperations]
  );

  const commitHistory = useCallback(
    async (
      label: string,
      forward: readonly CanvasOperation[],
      inverse: readonly CanvasOperation[],
      affectedElementIds: readonly string[]
    ) => {
      if (forward.length === 0) return;
      await runCanvasOperations(forward);
      history.current.record({
        label,
        forward,
        inverse,
        affectedElementIds,
        timestamp: Date.now()
      });
      refreshCommandState();
    },
    [refreshCommandState, runCanvasOperations]
  );

  const runMacro = useCallback(
    async (plan: MacroPlan): Promise<void> => {
      if (readOnly) throw new Error('Macro execution is unavailable in read-only canvases.');
      if (!onMacroExecute) throw new Error('Macro execution is unavailable.');
      let result: MacroExecutionResult | null = null;
      const task = mutationQueue.current.then(async () => {
        if (currentCanvas.current.id !== plan.canvasId) throw new Error('The canvas changed before macro execution.');
        if (currentCanvas.current.readOnly) throw new Error('The canvas is read-only.');
        pendingLocalMutations.current += 1;
        try {
          const idempotencyKey = macroIdempotencyKeys.current.get(plan.planId) ?? `macro_${nanoid(24)}`;
          macroIdempotencyKeys.current.set(plan.planId, idempotencyKey);
          result = await onMacroExecute({
            canvasId: plan.canvasId,
            planId: plan.planId,
            expectedRevision: plan.canvasRevision,
            idempotencyKey
          });
          if (currentCanvas.current.id !== plan.canvasId) throw new Error('The canvas changed during macro execution.');
          const updatedCanvas = result.canvas as CanvasDocument;
          confirmedCanvas.current = updatedCanvas;
          lastLocalRevision.current = updatedCanvas.revision;
        } finally {
          pendingLocalMutations.current -= 1;
        }
      });
      mutationQueue.current = task.catch(() => undefined);
      await task;
      const completed = result as MacroExecutionResult | null;
      if (!completed) throw new Error('Macro execution did not return a result.');
      history.current.record({
        label: completed.history.label,
        forward: completed.history.forward,
        inverse: completed.history.inverse,
        affectedElementIds: completed.history.affectedElementIds,
        timestamp: Date.now()
      });
      macroIdempotencyKeys.current.delete(completed.provenance.planId);
      refreshCommandState();
    },
    [onMacroExecute, readOnly, refreshCommandState]
  );

  useEffect(() => {
    if (confirmedCanvas.current.id !== canvas.id) {
      confirmedCanvas.current = canvas;
      lastLocalRevision.current = null;
      history.current.clear();
      macroIdempotencyKeys.current.clear();
      refreshCommandState();
      return;
    }
    if (confirmedCanvas.current.revision !== canvas.revision) {
      const external = pendingLocalMutations.current === 0 && lastLocalRevision.current !== canvas.revision;
      confirmedCanvas.current = canvas;
      if (external) {
        history.current.clear();
        refreshCommandState();
      }
    }
  }, [canvas, refreshCommandState]);
  async function undo() {
    const entry = history.current.peekUndo();
    if (!entry) return;
    const next = await runCanvasOperations(entry.inverse);
    history.current.confirmUndo(entry);
    refreshCommandState();
    return entry.affectedElementIds.filter((id) => next.elements.some((element) => element.id === id));
  }

  async function redo() {
    const entry = history.current.peekRedo();
    if (!entry) return;
    const next = await runCanvasOperations(entry.forward);
    history.current.confirmRedo(entry);
    refreshCommandState();
    return entry.affectedElementIds.filter((id) => next.elements.some((element) => element.id === id));
  }

  return {
    commitHistory,
    runMacro,
    undo,
    redo,
    version,
    getConfirmedDocument: () => confirmedCanvas.current,
    canUndo: !readOnly && history.current.canUndo,
    canRedo: !readOnly && history.current.canRedo
  };
}
