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
interface PreparedHistoryEntry {
  forward: readonly CanvasOperation[];
  inverse: readonly CanvasOperation[];
  affectedElementIds: readonly string[];
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
  const enqueue = useCallback(<T>(operation: () => Promise<T>, canvasId = confirmedCanvas.current.id): Promise<T> => {
    const task = mutationQueue.current.then(async () => {
      if (currentCanvas.current.id !== canvasId) throw new Error('The canvas changed before saving.');
      if (currentCanvas.current.readOnly) throw new Error('The canvas is read-only.');
      pendingLocalMutations.current += 1;
      try {
        return await operation();
      } finally {
        pendingLocalMutations.current -= 1;
      }
    });
    // Recover the queue only; the caller must still receive this operation's failure.
    mutationQueue.current = task.then(
      () => undefined,
      () => undefined
    );
    return task;
  }, []);
  const persistCanvasOperations = useCallback(
    async (operations: readonly CanvasOperation[]): Promise<CanvasDocument> => {
      if (!onCanvasOperations) throw new Error('Canvas mutations are unavailable.');
      const canvasId = confirmedCanvas.current.id;
      const result = await onCanvasOperations(operations, confirmedCanvas.current.revision);
      if (currentCanvas.current.id !== canvasId) throw new Error('The canvas changed while saving.');
      if (!result) throw new Error('Canvas mutation did not return a document.');
      confirmedCanvas.current = result;
      lastLocalRevision.current = result.revision;
      return result;
    },
    [onCanvasOperations]
  );

  const commitHistory = useCallback(
    async (
      label: string,
      forward: readonly CanvasOperation[] | ((document: CanvasDocument) => PreparedHistoryEntry),
      inverse: readonly CanvasOperation[] = [],
      affectedElementIds: readonly string[] = []
    ) => {
      if (typeof forward !== 'function' && forward.length === 0) return;
      await enqueue(async () => {
        const prepared =
          typeof forward === 'function' ? forward(confirmedCanvas.current) : { forward, inverse, affectedElementIds };
        if (prepared.forward.length === 0) return;
        await persistCanvasOperations(prepared.forward);
        history.current.record({
          label,
          ...prepared,
          timestamp: Date.now()
        });
        refreshCommandState();
      });
    },
    [enqueue, refreshCommandState, persistCanvasOperations]
  );

  const runMacro = useCallback(
    async (plan: MacroPlan): Promise<void> => {
      if (readOnly) throw new Error('Macro execution is unavailable in read-only canvases.');
      if (!onMacroExecute) throw new Error('Macro execution is unavailable.');
      await enqueue(async () => {
        const idempotencyKey = macroIdempotencyKeys.current.get(plan.planId) ?? `macro_${nanoid(24)}`;
        macroIdempotencyKeys.current.set(plan.planId, idempotencyKey);
        const completed = await onMacroExecute({
          canvasId: plan.canvasId,
          planId: plan.planId,
          expectedRevision: plan.canvasRevision,
          idempotencyKey
        });
        if (currentCanvas.current.id !== plan.canvasId) throw new Error('The canvas changed during macro execution.');
        if (!completed) throw new Error('Macro execution did not return a result.');
        const updatedCanvas = completed.canvas as CanvasDocument;
        confirmedCanvas.current = updatedCanvas;
        lastLocalRevision.current = updatedCanvas.revision;
        history.current.record({
          label: completed.history.label,
          forward: completed.history.forward,
          inverse: completed.history.inverse,
          affectedElementIds: completed.history.affectedElementIds,
          timestamp: Date.now()
        });
        macroIdempotencyKeys.current.delete(completed.provenance.planId);
        refreshCommandState();
      }, plan.canvasId);
    },
    [enqueue, onMacroExecute, readOnly, refreshCommandState]
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
    return enqueue(async () => {
      const entry = history.current.peekUndo();
      if (!entry) return;
      const next = await persistCanvasOperations(entry.inverse);
      history.current.confirmUndo(entry);
      refreshCommandState();
      return entry.affectedElementIds.filter((id) => next.elements.some((element) => element.id === id));
    });
  }

  async function redo() {
    return enqueue(async () => {
      const entry = history.current.peekRedo();
      if (!entry) return;
      const next = await persistCanvasOperations(entry.forward);
      history.current.confirmRedo(entry);
      refreshCommandState();
      return entry.affectedElementIds.filter((id) => next.elements.some((element) => element.id === id));
    });
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
