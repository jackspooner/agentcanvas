import type {
  BrowserCommandContext,
  BrowserCommandDescriptor,
  BrowserOwnCanvasOperation
} from '@agentcanvas/plugin-sdk';
import { CORE_EDITOR_COMMANDS } from '@agentcanvas/editor';
import { act, renderHook } from '@testing-library/react';
import { useRef, useState } from 'react';
import { expect, it, vi } from 'vitest';
import type { CanvasOperation } from '../src/contracts';
import { DomRendererOverlayService } from '../src/web/plugins/overlays';
import { useCanvasCommands } from '../src/web/use-canvas-commands';
import { useCanvasHistory } from '../src/web/use-canvas-history';
import type { CanvasDocument } from '../src/web/v2-types';
import { coerceViewport } from '../src/web/viewport';

const canvas: CanvasDocument = {
  id: 'commands',
  title: 'Commands',
  createdBy: 'user',
  createdAt: '',
  updatedAt: '',
  bounds: { mode: 'unlimited' },
  revision: 1,
  documentVersion: 2,
  elements: [{ id: 'one', type: 'fixture/card', schemaVersion: 1, x: 0, y: 0, data: { value: 0 } }]
};
const replace = (value: number): BrowserOwnCanvasOperation[] => [
  { op: 'replaceElementData', elementId: 'one', data: { value } }
];

function harness(
  save: (operations: readonly CanvasOperation[], revision: number) => Promise<CanvasDocument>,
  isEnabled?: BrowserCommandDescriptor['isEnabled']
) {
  const contexts: BrowserCommandContext[] = [];
  const execute = vi.fn<BrowserCommandDescriptor['execute']>((context) => {
    contexts.push(context);
  });
  const registry = {
    plugins: { plugins: [] },
    renderers: new Map(),
    diagnostics: [],
    dispose: async () => {},
    commands: new Map([
      [
        'fixture.inspect',
        {
          id: 'fixture.inspect',
          pluginId: 'fixture',
          descriptor: { name: 'inspect', title: 'Inspect', hidden: true, execute, isEnabled }
        }
      ]
    ])
  };
  const hook = renderHook(
    ({ document, readOnly }) => {
      const [selectedIds, setSelectedIds] = useState<readonly string[]>([]);
      const [viewport, setViewport] = useState(coerceViewport(null));
      const [, setGridSnapEnabled] = useState(true);
      const [, setMoveError] = useState<string | null>(null);
      const history = useCanvasHistory({ canvas: document, readOnly, onCanvasOperations: save });
      const commands = useCanvasCommands({
        canvas: document,
        selectedIds,
        readOnly,
        viewport,
        nodeElements: document.elements,
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
      return { ...commands, history };
    },
    { initialProps: { document: canvas, readOnly: false } }
  );
  return { ...hook, contexts, execute };
}

it('binds renderer input to its origin and reads only current owned confirmed elements', async () => {
  const h = harness(vi.fn());
  await h.result.current.executeRendererCommand(canvas.id, canvas.elements[0], 'fixture.inspect', {
    elementId: 'spoofed',
    value: 3
  });
  expect(h.execute.mock.calls[0][1]).toEqual({ elementId: 'one', value: 3 });
  expect(h.result.current.commands.get('fixture.inspect')?.hidden).toBe(true);
  expect(h.contexts[0].getElement?.('one')).toMatchObject({ revision: 1, element: { id: 'one' } });
  expect(h.contexts[0].getElement?.('missing')).toBeNull();
  const owned = h.contexts[0].getElement?.('one');
  if (owned) owned.element.data.value = 99;
  expect(canvas.elements[0].data.value).toBe(0);
  const changed: CanvasDocument = {
    ...canvas,
    revision: 2,
    elements: [
      { ...canvas.elements[0], data: { value: 2 } },
      { ...canvas.elements[0], id: 'foreign', type: 'other/card' }
    ]
  };
  h.rerender({ document: changed, readOnly: true });
  expect(h.contexts[0].readOnly).toBe(true);
  expect(h.contexts[0].getElement?.('one')).toMatchObject({ revision: 2, element: { data: { value: 2 } } });
  expect(h.contexts[0].getElement?.('foreign')).toBeNull();
  await expect(h.result.current.executeRendererCommand(canvas.id, canvas.elements[0], 'fixture.inspect')).resolves.toBe(
    true
  );
  await expect(h.contexts[0].transact('Edit', replace(4))).rejects.toThrow('read-only');
  await expect(
    h.result.current.executeRendererCommand(canvas.id, canvas.elements[0], CORE_EDITOR_COMMANDS.delete)
  ).rejects.toThrow('own extension commands');
  await expect(h.result.current.executeRendererCommand('stale', canvas.elements[0], 'fixture.inspect')).rejects.toThrow(
    'no longer active'
  );
  await expect(
    h.result.current.executeRendererCommand(canvas.id, { ...canvas.elements[0], id: 'missing' }, 'fixture.inspect')
  ).rejects.toThrow('no longer exists');
  h.unmount();
});

it.each([
  'renderer disposal',
  'canvas switch'
] as const)('rejects a retained command context after %s', async (change) => {
  const save = vi.fn();
  const h = harness(save);
  const lifetime = new AbortController();
  await h.result.current.executeRendererCommand(canvas.id, canvas.elements[0], 'fixture.inspect', {}, lifetime.signal);
  if (change === 'renderer disposal') lifetime.abort();
  else h.rerender({ document: { ...canvas, id: 'next' }, readOnly: false });
  expect(h.contexts[0].signal.aborted).toBe(true);
  expect(() => h.contexts[0].getElement?.('one')).toThrow('no longer active');
  await expect(h.contexts[0].transact('Edit', replace(1))).rejects.toThrow('no longer active');
  expect(save).not.toHaveBeenCalled();
  h.unmount();
});

it('uses the renderer origin for command eligibility independently of menu selection', async () => {
  const h = harness(vi.fn(), (context) => context.selection.length === 1 && context.selection[0].id === 'one');
  expect(h.result.current.commands.isEnabled('fixture.inspect')).toBe(false);
  await expect(h.result.current.executeRendererCommand(canvas.id, canvas.elements[0], 'fixture.inspect')).resolves.toBe(
    true
  );
  expect(h.contexts[0].selection.map((element) => element.id)).toEqual(['one']);
  h.unmount();
});

it('prepares queued inverses from the confirmed document and checks expected revisions inside the queue', async () => {
  let persisted = canvas;
  const save = vi.fn(async (operations: readonly CanvasOperation[], revision: number) => {
    const op = operations[0];
    if (op.op !== 'replaceElementData') throw new Error('Expected data edit');
    if (typeof op.data.value !== 'number') throw new Error('Expected numeric value');
    persisted = {
      ...persisted,
      revision: revision + 1,
      elements: [{ ...persisted.elements[0], data: { value: op.data.value } }]
    };
    return persisted;
  });
  const h = harness(save);
  await h.result.current.commands.execute('fixture.inspect');
  const context = h.contexts[0];
  await act(async () => {
    const results = await Promise.allSettled([
      context.transact('First', replace(1), { expectedRevision: 1 }),
      context.transact('Stale', replace(99), { expectedRevision: 1 }),
      context.transact('Second', replace(2))
    ]);
    expect(results.map((result) => result.status)).toEqual(['fulfilled', 'rejected', 'fulfilled']);
    expect(results[1]).toMatchObject({
      reason: expect.objectContaining({ message: expect.stringContaining('revision conflict') })
    });
    await h.result.current.history.undo();
  });
  expect(persisted.elements[0].data).toEqual({ value: 1 });
  expect(save.mock.calls.map((call) => call[1])).toEqual([1, 2, 3]);
  h.unmount();
});

it.each([
  'locked',
  'deleted',
  'foreign'
] as const)('rechecks a %s target after an earlier queued save', async (change) => {
  const save = vi.fn(
    async (): Promise<CanvasDocument> => ({
      ...canvas,
      revision: 2,
      elements:
        change === 'deleted'
          ? []
          : [
              {
                ...canvas.elements[0],
                locked: change === 'locked',
                type: change === 'foreign' ? 'other/card' : 'fixture/card'
              }
            ]
    })
  );
  const h = harness(save);
  await h.result.current.commands.execute('fixture.inspect');
  await act(async () => {
    const results = await Promise.allSettled([
      h.result.current.history.commitHistory('Earlier save', [{ op: 'clear' }], [], []),
      h.contexts[0].transact('Edit', replace(1))
    ]);
    expect(results.map((result) => result.status)).toEqual(['fulfilled', 'rejected']);
  });
  expect(save).toHaveBeenCalledTimes(1);
  h.unmount();
});
