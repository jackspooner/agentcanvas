import type { ElementTypeDescriptor, PluginManifest } from '@agentcanvas/plugin-sdk';
import { describe, expect, it } from 'vitest';
import { PluginElementValidator } from '../src/plugin-runtime/elements';
import { FrozenPluginRegistry } from '../src/plugin-runtime/registry';
import { V2SqliteCanvasStore } from '../src/store/v2';

const manifest: PluginManifest = {
  apiVersion: 'agentcanvas.plugin/v1',
  id: 'fixture.cards',
  version: '1.0.0',
  displayName: 'Fixture cards',
  description: 'Fixture',
  license: 'MIT',
  entrypoints: { server: 'dist/server.mjs' },
  requires: { hostApi: '^1.0.0', plugins: {}, capabilities: {} },
  provides: { capabilities: {} },
  permissions: ['canvas.mutate-own'],
  contributes: {
    elements: [{ name: 'card', schemaVersion: 1, browser: false, snapshot: 'unsupported' }],
    tools: [],
    procedures: [],
    migrations: []
  }
};

const card: ElementTypeDescriptor = {
  name: 'card',
  schemaVersion: 1,
  dataSchema: {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    type: 'object',
    additionalProperties: false,
    required: ['title'],
    properties: { title: { type: 'string' } }
  },
  browser: false,
  snapshot: 'unsupported',
  summarize: (element) => ({ title: String(element.data.title) })
};

function makeStore(): V2SqliteCanvasStore {
  const registry = new FrozenPluginRegistry(
    [
      {
        plugin: {
          manifest,
          root: 'fixture',
          serverEntry: 'fixture/server.mjs',
          config: {}
        },
        elements: [card],
        tools: [],
        procedures: [],
        migrations: []
      }
    ],
    new Map()
  );
  return new V2SqliteCanvasStore(new PluginElementValidator(registry), ':memory:');
}

describe('v0.2 canonical store', () => {
  it('separates frame, data, and metadata mutations and versions events/idempotency', () => {
    const store = makeStore();
    const canvas = store.createCanvas({ title: 'Cards' });
    const upserted = store.applyOperations(canvas.id, {
      idempotencyKey: 'create-card',
      operations: [
        {
          op: 'upsertElement',
          element: {
            id: 'card_1',
            type: 'fixture.cards/card',
            schemaVersion: 1,
            x: 10,
            y: 20,
            data: { title: 'Initial' }
          }
        }
      ]
    });
    const framed = store.applyOperations(canvas.id, {
      expectedRevision: upserted.revision,
      operations: [{ op: 'patchElementFrame', elementId: 'card_1', frame: { x: 50, locked: true } }]
    });
    const replaced = store.applyOperations(canvas.id, {
      expectedRevision: framed.revision,
      operations: [
        { op: 'replaceElementData', elementId: 'card_1', data: { title: 'Updated' } },
        { op: 'replaceElementMetadata', elementId: 'card_1', metadata: { source: 'test' } }
      ]
    });
    expect(replaced.elements[0]).toMatchObject({
      id: 'card_1',
      type: 'fixture.cards/card',
      schemaVersion: 1,
      x: 50,
      locked: true,
      data: { title: 'Updated' },
      metadata: { source: 'test' }
    });
    expect(store.db.prepare('SELECT DISTINCT document_version FROM canvas_events').all()).toEqual([
      { document_version: 2 }
    ]);
    expect(store.db.prepare('SELECT canvas_id, document_version, key FROM canvas_idempotency_keys').get()).toEqual({
      canvas_id: canvas.id,
      document_version: 2,
      key: 'create-card'
    });
    store.close();
  });

  it('preserves missing-plugin data while allowing only kernel-owned changes', () => {
    const store = makeStore();
    const canvas = store.createCanvas({ title: 'Missing plugin' });
    const missing = {
      id: 'missing_1',
      type: 'missing.plugin/item',
      schemaVersion: 3,
      x: 1,
      y: 2,
      data: { future: true }
    };
    store.db.prepare('UPDATE canvases SET elements_json=? WHERE id=?').run(JSON.stringify([missing]), canvas.id);
    expect(store.getCanvas(canvas.id).elements[0]).toEqual(missing);
    const framed = store.applyOperations(canvas.id, {
      operations: [{ op: 'patchElementFrame', elementId: 'missing_1', frame: { x: 99 } }]
    });
    expect(framed.elements[0]).toMatchObject({ x: 99, data: { future: true } });
    expect(() =>
      store.applyOperations(canvas.id, {
        operations: [{ op: 'replaceElementData', elementId: 'missing_1', data: { future: false } }]
      })
    ).toThrowError(/unavailable/);
    store.close();
  });

  it('rejects identity changes during upsert', () => {
    const store = makeStore();
    const canvas = store.createCanvas({ title: 'Identity' });
    store.applyOperations(canvas.id, {
      operations: [
        {
          op: 'upsertElement',
          element: { id: 'card_1', type: 'fixture.cards/card', schemaVersion: 1, x: 0, y: 0, data: { title: 'A' } }
        }
      ]
    });
    expect(() =>
      store.applyOperations(canvas.id, {
        operations: [
          {
            op: 'upsertElement',
            element: { id: 'card_1', type: 'fixture.cards/other', schemaVersion: 1, x: 0, y: 0, data: {} }
          }
        ]
      })
    ).toThrowError();
    store.close();
  });
});
