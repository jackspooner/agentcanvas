import { describe, expect, it, vi } from 'vitest';
import { createPluginCanvasOperations } from '../src/plugin-runtime/canvas-operations.js';
import type { FrozenPluginRegistry } from '../src/plugin-runtime/registry.js';
import type { V2SqliteCanvasStore } from '../src/store/v2.js';

const registry = { getElementType: () => ({}) } as unknown as FrozenPluginRegistry;

function store(resultElements: unknown[] = []) {
  return {
    getCanvas: vi.fn(() => ({
      id: 'canvas-1',
      elements: [
        {
          id: 'owned',
          type: 'example.plugin/card',
          schemaVersion: 1,
          x: 0,
          y: 0,
          data: {}
        },
        {
          id: 'foreign',
          type: 'another.plugin/card',
          schemaVersion: 1,
          x: 0,
          y: 0,
          data: {}
        }
      ]
    })),
    applyOperations: vi.fn(() => ({ id: 'canvas-1', elements: resultElements, revision: 2 })),
    getConfiguration: vi.fn(() => ({ diagnostics: { overlapMode: 'off', maxOverlapWarnings: 100 } }))
  } as unknown as V2SqliteCanvasStore;
}

describe('plugin canvas permissions', () => {
  it('requires declared read and mutation permissions', async () => {
    const denied = createPluginCanvasOperations(store(), 'example.plugin', [], registry);
    await expect(denied.get('canvas-1')).rejects.toMatchObject({ code: 'plugin_permission_denied', status: 403 });
    await expect(
      denied.upsertElement('canvas-1', {
        id: 'new',
        type: 'example.plugin/card',
        schemaVersion: 1,
        x: 0,
        y: 0,
        data: {}
      })
    ).rejects.toMatchObject({ code: 'plugin_permission_denied', status: 403 });
  });

  it('limits canvas.mutate-own to elements owned by the calling plugin', async () => {
    const backing = store();
    const operations = createPluginCanvasOperations(
      backing,
      'example.plugin',
      ['canvas.read', 'canvas.mutate-own'],
      registry
    );
    await expect(operations.get('canvas-1')).resolves.toMatchObject({ id: 'canvas-1' });
    await expect(operations.deleteElement('canvas-1', 'foreign')).rejects.toMatchObject({
      code: 'plugin_permission_denied',
      status: 403
    });
    await expect(
      operations.upsertElement('canvas-1', {
        id: 'bad',
        type: 'another.plugin/card',
        schemaVersion: 1,
        x: 0,
        y: 0,
        data: {}
      })
    ).rejects.toMatchObject({ code: 'plugin_permission_denied', status: 403 });
    await operations.deleteElement('canvas-1', 'owned');
    expect(backing.applyOperations).toHaveBeenCalledOnce();
  });

  it('keeps legacy full results while receipt methods omit canvas contents', async () => {
    const operations = createPluginCanvasOperations(
      store(),
      'example.plugin',
      ['canvas.read', 'canvas.mutate-own'],
      registry
    );
    const element = {
      id: 'new',
      type: 'example.plugin/card',
      schemaVersion: 1,
      x: 0,
      y: 0,
      data: {}
    } as const;
    await expect(operations.upsertElement('canvas-1', element)).resolves.toMatchObject({
      id: 'canvas-1',
      elements: [],
      revision: 2
    });
    await expect(operations.upsertElementReceipt('canvas-1', element)).resolves.toEqual({
      canvasId: 'canvas-1',
      revision: 2,
      inspectionSummary: { errorCount: 0, warningCount: 0, infoCount: 0 }
    });
  });

  it('returns the same-size receipt for small and large canvases', async () => {
    const permissions = ['canvas.read', 'canvas.mutate-own'] as const;
    const element = {
      id: 'new',
      type: 'example.plugin/card',
      schemaVersion: 1,
      x: 0,
      y: 0,
      data: {}
    } as const;
    const largeElements = Array.from({ length: 1_000 }, (_, index) => ({
      ...element,
      id: `existing-${index}`,
      data: { markdown: 'content that must not reach a mutation response'.repeat(20) }
    }));
    const small = await createPluginCanvasOperations(
      store(),
      'example.plugin',
      permissions,
      registry
    ).upsertElementReceipt('canvas-1', element);
    const large = await createPluginCanvasOperations(
      store(largeElements),
      'example.plugin',
      permissions,
      registry
    ).upsertElementReceipt('canvas-1', element);

    expect(JSON.stringify(large)).toBe(JSON.stringify(small));
  });
});
