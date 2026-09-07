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
