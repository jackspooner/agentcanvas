import { act, renderHook } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { useRef, useState } from 'react';
import type { BrowserCommandContext } from '@agentcanvas/plugin-sdk';
import { CORE_EDITOR_COMMANDS } from '@agentcanvas/editor';
import { useCanvasHistory } from '../src/web/use-canvas-history';
import { useCanvasCommands } from '../src/web/use-canvas-commands';
import { DomRendererOverlayService } from '../src/web/plugins/overlays';
import type { LoadedBrowserRegistry } from '../src/web/plugins/catalog';
import type { CanvasDocument } from '../src/web/v2-types';
import { coerceViewport } from '../src/web/viewport';
import type { CanvasOperation } from '../src/contracts';

it('registered commands use current context and release registrations and abort signals', async () => {
  const contexts: BrowserCommandContext[] = [];
  const descriptor = {
    name: 'inspect',
    title: 'Inspect',
    execute: (context: BrowserCommandContext) => {
      contexts.push(context);
    }
  };
  const registry: LoadedBrowserRegistry = {
    plugins: { plugins: [] },
    renderers: new Map(),
    diagnostics: [],
    dispose: async () => {},
    commands: new Map([['fixture/inspect', { id: 'fixture/inspect', pluginId: 'fixture', descriptor }]])
  };
  const document: CanvasDocument = {
    id: 'one',
    title: 'One',
    createdBy: 'user',
    createdAt: '',
    updatedAt: '',
    bounds: { mode: 'unlimited' },
    revision: 1,
    documentVersion: 2,
    elements: [{ id: 'element', type: 'fixture/card', schemaVersion: 1, x: 0, y: 0, data: {} }]
  };
  const { result, rerender, unmount } = renderHook(
    ({ canvas, readOnly }) => {
      const [selectedIds, setSelectedIds] = useState<readonly string[]>([]);
      const [viewport, setViewport] = useState(coerceViewport(null));
      const [, setGridSnapEnabled] = useState(true);
      const [, setMoveError] = useState<string | null>(null);
      const history = useCanvasHistory({ canvas, readOnly });
      return useCanvasCommands({
        canvas,
        selectedIds,
        readOnly,
        viewport,
        nodeElements: canvas.elements,
        browserRegistry: registry,
        overlays: new DomRendererOverlayService(),
        history,
        viewportNode: useRef(null),
        setSelectedIds,
        setViewport,
        setGridSnapEnabled,
        setMoveError,
        reportDiagnostic: vi.fn(),
        fitCanvas: vi.fn(),
        resetViewport: vi.fn()
      });
    },
    { initialProps: { canvas: document, readOnly: false } }
  );
  const service = result.current.commands;
  await act(async () => {
    await service.execute(CORE_EDITOR_COMMANDS.selectAll);
  });
  rerender({
    canvas: { ...document, revision: 2, elements: [{ ...document.elements[0], data: { changed: true } }] },
    readOnly: true
  });
  await act(async () => {
    await service.execute('fixture/inspect');
  });
  expect(result.current.commands).toBe(service);
  expect(contexts[0]).toMatchObject({ readOnly: true, selection: [{ data: { changed: true } }] });
  expect(service.isEnabled(CORE_EDITOR_COMMANDS.delete)).toBe(false);
  rerender({ canvas: { ...document, id: 'two' }, readOnly: false });
  expect(contexts[0].signal.aborted).toBe(true);
  await act(async () => {
    await service.execute('fixture/inspect');
  });
  expect(contexts[1].selection).toEqual([]);
  unmount();
  expect(contexts[1].signal.aborted).toBe(true);
  expect(service.isEnabled('fixture/inspect')).toBe(false);
});

it('serializes rapid undo commands without losing requests or selection', async () => {
  let persisted: CanvasDocument = {
    id: 'commands',
    title: 'Commands',
    createdBy: 'user',
    createdAt: '',
    updatedAt: '',
    bounds: { mode: 'unlimited' },
    revision: 1,
    documentVersion: 2,
    elements: [{ id: 'element', type: 'fixture/card', schemaVersion: 1, x: 0, y: 0, data: {} }]
  };
  const registry: LoadedBrowserRegistry = {
    plugins: { plugins: [] },
    renderers: new Map(),
    commands: new Map(),
    diagnostics: [],
    dispose: async () => {}
  };
  const move = (x: number): CanvasOperation[] => [{ op: 'patchElementFrame', elementId: 'element', frame: { x } }];
  let delayNext = false;
  let finish!: () => void;
  let started!: () => void;
  const pending = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const saving = new Promise<void>((resolve) => {
    started = resolve;
  });
  const save = vi.fn(async (operations: readonly CanvasOperation[], revision: number) => {
    expect(revision).toBe(persisted.revision);
    if (delayNext) {
      delayNext = false;
      started();
      await pending;
    }
    const operation = operations[0];
    if (operation?.op !== 'patchElementFrame' || typeof operation.frame.x !== 'number')
      throw new Error('Expected move');
    persisted = {
      ...persisted,
      revision: revision + 1,
      elements: [{ ...persisted.elements[0], x: operation.frame.x }]
    };
    return persisted;
  });
  const { result } = renderHook(() => {
    const [canvas, setCanvas] = useState(persisted);
    const [selectedIds, setSelectedIds] = useState<readonly string[]>([]);
    const [viewport, setViewport] = useState(coerceViewport(null));
    const [, setGridSnapEnabled] = useState(true);
    const [, setMoveError] = useState<string | null>(null);
    const history = useCanvasHistory({
      canvas,
      readOnly: false,
      onCanvasOperations: async (operations, revision) => {
        const next = await save(operations, revision);
        setCanvas(next);
        return next;
      }
    });
    const { commands } = useCanvasCommands({
      canvas,
      selectedIds,
      readOnly: false,
      viewport,
      nodeElements: canvas.elements,
      browserRegistry: registry,
      overlays: new DomRendererOverlayService(),
      history,
      viewportNode: useRef(null),
      setSelectedIds,
      setViewport,
      setGridSnapEnabled,
      setMoveError,
      reportDiagnostic: vi.fn(),
      fitCanvas: vi.fn(),
      resetViewport: vi.fn()
    });
    return { commands, history, selectedIds };
  });
  await act(async () => {
    await result.current.history.commitHistory('Move 1', move(10), move(0), ['element']);
    await result.current.history.commitHistory('Move 2', move(20), move(10), ['element']);
  });
  save.mockClear();
  delayNext = true;
  await act(async () => {
    const completed = Promise.all([
      result.current.commands.execute(CORE_EDITOR_COMMANDS.undo),
      result.current.commands.execute(CORE_EDITOR_COMMANDS.undo)
    ]);
    await saving;
    expect(save).toHaveBeenCalledTimes(1);
    finish();
    expect(await completed).toEqual([true, true]);
  });
  expect(save.mock.calls).toEqual([
    [move(10), 3],
    [move(0), 4]
  ]);
  expect(persisted.elements[0].x).toBe(0);
  expect(result.current.selectedIds).toEqual(['element']);
  expect(result.current.commands.isEnabled(CORE_EDITOR_COMMANDS.undo)).toBe(false);
  expect(result.current.commands.isEnabled(CORE_EDITOR_COMMANDS.redo)).toBe(true);
});
