import { describe, expect, it, vi } from 'vitest';
import { createPluginCanvasOperations } from '../src/plugin-runtime/canvas-operations.js';
import type { V2SqliteCanvasStore } from '../src/store/v2.js';

function store() {
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
    applyOperations: vi.fn(() => ({ id: 'canvas-1', elements: [], revision: 2 }))
  } as unknown as V2SqliteCanvasStore;
}

describe('plugin canvas permissions', () => {
  it('requires declared read and mutation permissions', async () => {
    const denied = createPluginCanvasOperations(store(), 'example.plugin', []);
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
    const operations = createPluginCanvasOperations(backing, 'example.plugin', ['canvas.read', 'canvas.mutate-own']);
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
});
