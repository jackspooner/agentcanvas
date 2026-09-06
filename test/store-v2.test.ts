import { createHash } from 'node:crypto';
import type { ElementTypeDescriptor, PluginManifest } from '@agentcanvas/plugin-sdk';
import { describe, expect, it } from 'vitest';
import { PluginElementValidator } from '../src/plugin-runtime/elements';
import { FrozenPluginRegistry } from '../src/plugin-runtime/registry';
import { V2SqliteCanvasStore } from '../src/store/v2';
import { TEST_CANVAS_THEME } from './fixtures/canvas-theme';

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
  it('rolls back metadata, revision, and events together when event recording fails', () => {
    const store = makeStore();
    try {
      const canvas = store.createCanvas({ title: 'Original' });
      const before = store.db.prepare('SELECT * FROM canvases WHERE id=?').get(canvas.id);
      store.db.exec(
        "CREATE TRIGGER fail_event BEFORE INSERT ON canvas_events BEGIN SELECT RAISE(ABORT, 'event rejected'); END;"
      );
      const updates = [
        () => store.renameCanvas(canvas.id, { title: 'Changed', expectedRevision: 1 }),
        () =>
          store.updateCanvasBounds(canvas.id, {
            bounds: { mode: 'fixed', width: 100, height: 100 },
            expectedRevision: 1
          }),
        () => store.updateCanvasTheme(canvas.id, { theme: TEST_CANVAS_THEME, expectedRevision: 1 })
      ];
      for (const update of updates) {
        expect(update).toThrow('event rejected');
        expect(store.db.prepare('SELECT * FROM canvases WHERE id=?').get(canvas.id)).toEqual(before);
        expect(store.db.prepare('SELECT * FROM canvas_events').all()).toEqual([]);
      }
      store.db.exec('DROP TRIGGER fail_event');
      expect(store.renameCanvas(canvas.id, { title: 'Original', expectedRevision: 1 }).revision).toBe(1);
      expect(store.renameCanvas(canvas.id, { title: 'Changed', expectedRevision: 1 }).revision).toBe(2);
      expect(() => store.updateCanvasBounds(canvas.id, { bounds: { mode: 'unlimited' }, expectedRevision: 1 })).toThrow(
        /expected revision/
      );
      expect(store.db.prepare('SELECT * FROM canvas_events').all()).toHaveLength(1);
    } finally {
      store.close();
    }
  });

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

  it('keeps element-batch idempotency replay and conflict behavior unchanged', () => {
    const store = makeStore();
    const canvas = store.createCanvas({ title: 'Idempotency' });
    const request = {
      idempotencyKey: 'same-request',
      operations: [
        {
          op: 'upsertElement' as const,
          element: { id: 'card_1', type: 'fixture.cards/card', schemaVersion: 1, x: 0, y: 0, data: { title: 'A' } }
        }
      ]
    };
    const first = store.applyOperations(canvas.id, request);
    expect(store.applyOperations(canvas.id, request)).toEqual(first);
    expect(store.db.prepare('SELECT request_hash FROM canvas_idempotency_keys').get()).toEqual({
      request_hash: createHash('sha256')
        .update(
          JSON.stringify({
            canvasId: canvas.id,
            documentVersion: 2,
            operations: request.operations
          })
        )
        .digest('hex')
    });
    expect(() =>
      store.applyOperations(canvas.id, {
        ...request,
        operations: [{ ...request.operations[0], element: { ...request.operations[0].element, x: 1 } }]
      })
    ).toThrowError('idempotency key was reused with a different request');
    expect(store.getCanvas(canvas.id).revision).toBe(first.revision);
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

  it('rolls back the canvas batch when the optional transaction callback fails', () => {
    const store = makeStore();
    const canvas = store.createCanvas({ title: 'Atomic callback' });
    expect(() =>
      store.applyOperationsWithTransaction(
        canvas.id,
        {
          idempotencyKey: 'callback-failure',
          operations: [
            {
              op: 'upsertElement',
              element: { id: 'card_1', type: 'fixture.cards/card', schemaVersion: 1, x: 0, y: 0, data: { title: 'A' } }
            }
          ]
        },
        ({ db }) => {
          db.prepare(
            `INSERT INTO macro_definitions
             (id,scope_kind,canvas_id,current_version,archived_at,created_at,updated_at)
             VALUES ('macro_1','installation',NULL,1,NULL,'now','now')`
          ).run();
          throw new Error('callback failed');
        }
      )
    ).toThrowError('callback failed');
    expect(store.getCanvas(canvas.id)).toMatchObject({ revision: 1, elements: [] });
    expect(store.db.prepare('SELECT COUNT(*) AS count FROM canvas_events').get()).toEqual({ count: 0 });
    expect(store.db.prepare('SELECT COUNT(*) AS count FROM canvas_idempotency_keys').get()).toEqual({ count: 0 });
    expect(store.db.prepare('SELECT COUNT(*) AS count FROM macro_definitions').get()).toEqual({ count: 0 });
    store.close();
  });

  it('uses a macro-namespaced digest for callback responses and replays without rerunning the callback', () => {
    const store = makeStore();
    const canvas = store.createCanvas({ title: 'Callback response' });
    const request = {
      idempotencyKey: 'callback-response',
      operations: [
        {
          op: 'upsertElement' as const,
          element: { id: 'card_1', type: 'fixture.cards/card', schemaVersion: 1, x: 0, y: 0, data: { title: 'A' } }
        }
      ]
    };
    const ordinaryDigest = createHash('sha256')
      .update(JSON.stringify({ canvasId: canvas.id, documentVersion: 2, operations: request.operations }))
      .digest('hex');
    const macroDigest = createHash('sha256').update(`macro:${ordinaryDigest}`).digest('hex');
    let callbackCalls = 0;
    const first = store.applyOperationsWithTransaction(
      canvas.id,
      request,
      ({ response }) => {
        callbackCalls += 1;
        return { revision: response.revision, elementCount: response.elements.length, responseKind: 'macro' };
      },
      { idempotencyRequestDigest: macroDigest }
    );
    const replay = store.applyOperationsWithTransaction(
      canvas.id,
      request,
      () => {
        callbackCalls += 1;
        return { revision: -1, elementCount: -1, responseKind: 'wrong' };
      },
      { idempotencyRequestDigest: macroDigest }
    );
    expect(first).toEqual({ revision: 2, elementCount: 1, responseKind: 'macro' });
    expect(replay).toEqual(first);
    expect(callbackCalls).toBe(1);
    expect(macroDigest).not.toBe(ordinaryDigest);
    expect(store.db.prepare('SELECT request_hash FROM canvas_idempotency_keys').get()).toEqual({
      request_hash: macroDigest
    });
    expect(() => store.applyOperations(canvas.id, request)).toThrowError(
      'idempotency key was reused with a different request'
    );
    store.close();
  });

  it('rejects malformed explicit transaction idempotency digests', () => {
    const store = makeStore();
    const canvas = store.createCanvas({ title: 'Digest validation' });
    expect(() =>
      store.applyOperationsWithTransaction(canvas.id, { operations: [] }, undefined, {
        idempotencyRequestDigest: 'ABC'
      })
    ).toThrowError('idempotencyRequestDigest must be a 64-character lowercase SHA-256 hex string');
    store.close();
  });

  it('requires invocation idempotency keys and protects macro version records', () => {
    const store = makeStore();
    const canvas = store.createCanvas({ title: 'Macro schema constraints' });
    store.db
      .prepare(
        `INSERT INTO macro_definitions
         (id,scope_kind,canvas_id,current_version,archived_at,created_at,updated_at)
         VALUES ('macro_1','canvas',?,1,NULL,'created','updated')`
      )
      .run(canvas.id);
    store.db
      .prepare(
        `INSERT INTO macro_versions
         (macro_id,version,definition_json,definition_sha256,created_at)
         VALUES ('macro_1',1,'{}',?, 'created')`
      )
      .run('a'.repeat(64));
    expect(() =>
      store.db
        .prepare(
          `INSERT INTO macro_invocations
           (id,canvas_id,resulting_revision,macro_id,macro_version,plan_sha256,input_sha256,safe_summary_json,outputs_json,idempotency_key,created_at)
           VALUES ('invocation_null',?,2,'macro_1',1,?,?, '{}','{}',NULL,'created')`
        )
        .run(canvas.id, 'b'.repeat(64), 'c'.repeat(64))
    ).toThrowError(/NOT NULL constraint failed: macro_invocations\.idempotency_key/);
    expect(() => store.db.prepare('UPDATE macro_versions SET created_at=?').run('changed')).toThrowError(
      'macro version records are immutable'
    );
    expect(() => store.db.prepare('DELETE FROM macro_versions').run()).toThrowError(
      'macro version records are immutable'
    );
    store.db
      .prepare('UPDATE macro_definitions SET current_version=2, archived_at=? WHERE id=?')
      .run('archived', 'macro_1');
    expect(
      store.db.prepare('SELECT current_version, archived_at FROM macro_definitions WHERE id=?').get('macro_1')
    ).toEqual({ current_version: 2, archived_at: 'archived' });
    store.close();
  });
});
