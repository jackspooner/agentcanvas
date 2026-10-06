import { createHash } from 'node:crypto';
import type { ElementTypeDescriptor, PluginManifest } from '@agentcanvas/plugin-sdk';
import { describe, expect, it } from 'vitest';
import { PluginElementValidator } from '../src/plugin-runtime/elements';
import { FrozenPluginRegistry } from '../src/plugin-runtime/registry';
import { V2SqliteCanvasStore } from '../src/store/v2';
import { MacroRuntime } from '../src/macros/runtime';
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
  it('permanently deletes owned state and canvas macros while preserving installation macros and other canvases', async () => {
    const store = makeStore();
    try {
      const target = store.createCanvas({ title: 'Delete' });
      const keep = store.createCanvas({ title: 'Keep' });
      const macros = new MacroRuntime(store, store.elementValidator.registry);
      const authoring = {
        title: 'Card',
        inputSchema: { type: 'object', additionalProperties: false },
        elements: [
          {
            key: 'card',
            type: 'fixture.cards/card',
            schemaVersion: 1,
            x: 0,
            y: 0,
            width: 100,
            height: 100,
            data: { title: 'Macro' }
          }
        ]
      };
      const local = macros.create({ ...authoring, scope: 'canvas', canvasId: target.id });
      macros.createVersion({ ...authoring, scope: 'canvas', canvasId: target.id, macroId: local.definition.id });
      const installation = macros.create({ ...authoring, scope: 'installation' });
      await macros.direct({
        mode: 'direct',
        canvasId: target.id,
        macroId: local.definition.id,
        macroVersion: 2,
        anchor: { x: 0, y: 0 },
        input: {},
        expectedRevision: 1,
        idempotencyKey: 'local-run'
      });
      await macros.direct({
        mode: 'direct',
        canvasId: target.id,
        macroId: installation.definition.id,
        macroVersion: 1,
        anchor: { x: 200, y: 0 },
        input: {},
        expectedRevision: 2,
        idempotencyKey: 'installation-run'
      });
      store.recordViewport(target.id, { centerX: 0, centerY: 0, zoom: 1, width: 800, height: 600 }, 'user');
      store.recordViewport(target.id, { centerX: 1, centerY: 1, zoom: 1, width: 800, height: 600 }, 'agent');
      const share = store.createShareLink(target.id, {});
      await macros.direct({
        mode: 'direct',
        canvasId: keep.id,
        macroId: installation.definition.id,
        macroVersion: 1,
        anchor: { x: 0, y: 0 },
        input: {},
        expectedRevision: 1,
        idempotencyKey: 'keep-run'
      });
      store.createShareLink(keep.id, {});
      store.recordViewport(keep.id, { centerX: 0, centerY: 0, zoom: 1, width: 800, height: 600 }, 'user');
      const keepState = store.getCanvas(keep.id);
      const retainedTables = [
        'canvas_events',
        'canvas_share_links',
        'canvas_viewports',
        'canvas_idempotency_keys',
        'macro_invocations'
      ];
      const retainedRows = () =>
        retainedTables.map((table) => store.db.prepare(`SELECT * FROM ${table} WHERE canvas_id=?`).all(keep.id));
      const retainedBefore = retainedRows();
      store.db.prepare("INSERT INTO plugin_kv VALUES ('provider','media','{\"assetId\":\"keep\"}','now')").run();
      expect(() => store.db.prepare('DELETE FROM macro_versions WHERE macro_id=?').run(local.definition.id)).toThrow(
        'immutable'
      );
      expect(() =>
        store.db.prepare('DELETE FROM macro_versions WHERE macro_id=?').run(installation.definition.id)
      ).toThrow('immutable');
      expect(store.deleteCanvas(target.id, 3)).toEqual({ canvasId: target.id, deleted: true });
      for (const table of [
        'canvas_events',
        'canvas_share_links',
        'canvas_viewports',
        'canvas_idempotency_keys',
        'macro_invocations',
        'macro_definitions'
      ]) {
        expect(store.db.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE canvas_id=?`).get(target.id)).toEqual({
          count: 0
        });
      }
      expect(
        store.db.prepare('SELECT COUNT(*) AS count FROM macro_versions WHERE macro_id=?').get(local.definition.id)
      ).toEqual({ count: 0 });
      expect(macros.get(installation.definition.id, 1, keep.id).definition).toEqual(installation.definition);
      expect(store.getCanvas(keep.id)).toEqual(keepState);
      expect(retainedRows()).toEqual(retainedBefore);
      expect(store.db.prepare('SELECT value_json FROM plugin_kv').get()).toEqual({ value_json: '{"assetId":"keep"}' });
      expect(store.db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
      expect(store.db.prepare('PRAGMA defer_foreign_keys').get()).toEqual({ defer_foreign_keys: 0 });
      expect(() => store.resolveShareToken(share.token)).toThrow();
      expect(() => store.getCanvas(target.id)).toThrow('canvas not found');
      expect(() => store.deleteCanvas(target.id)).toThrow('canvas not found');
      expect(() => store.applyOperations(target.id, { operations: [{ op: 'clear' }] })).toThrow('canvas not found');
      expect(() =>
        macros.plan({
          canvasId: target.id,
          macroId: installation.definition.id,
          macroVersion: 1,
          anchor: { x: 0, y: 0 },
          input: {}
        })
      ).toThrow();
    } finally {
      store.close();
    }
  });

  it('rejects invalid and stale revisions without deleting anything', () => {
    const store = makeStore();
    try {
      const canvas = store.createCanvas({ title: 'Keep' });
      for (const expected of [0, -1, 1.5, NaN, Infinity])
        expect(() => store.deleteCanvas(canvas.id, expected)).toThrow('positive integer');
      expect(() => store.deleteCanvas(canvas.id, 2)).toThrow('expected revision');
      expect(store.getCanvas(canvas.id)).toEqual(canvas);
      expect(() => store.deleteCanvas('missing')).toThrow('canvas not found');
      expect(store.deleteCanvas(canvas.id)).toEqual({ canvasId: canvas.id, deleted: true });
    } finally {
      store.close();
    }
  });

  it.each(['parent', 'foreign-key'])('rolls back every deletion on %s failure', (failure) => {
    const store = makeStore();
    try {
      const canvas = store.createCanvas({ title: 'Rollback' });
      const macros = new MacroRuntime(store, store.elementValidator.registry);
      macros.create({
        title: 'Scoped',
        scope: 'canvas',
        canvasId: canvas.id,
        inputSchema: { type: 'object' },
        elements: []
      });
      store.createShareLink(canvas.id, {});
      store.applyOperations(canvas.id, { idempotencyKey: 'retry', operations: [{ op: 'clear' }] });
      const tables = [
        'canvases',
        'canvas_events',
        'canvas_share_links',
        'canvas_idempotency_keys',
        'macro_definitions',
        'macro_versions'
      ];
      const snapshot = () => tables.map((table) => store.db.prepare(`SELECT * FROM ${table}`).all());
      const before = snapshot();
      if (failure === 'parent')
        store.db.exec(
          "CREATE TRIGGER fail_delete BEFORE DELETE ON canvases BEGIN SELECT RAISE(ABORT, 'forced deletion failure'); END;"
        );
      else {
        store.db.exec('CREATE TABLE retained_reference (canvas_id TEXT REFERENCES canvases(id));');
        store.db.prepare('INSERT INTO retained_reference VALUES (?)').run(canvas.id);
      }
      expect(() => store.deleteCanvas(canvas.id, 2)).toThrow(
        failure === 'parent' ? 'forced deletion failure' : 'FOREIGN KEY'
      );
      expect(snapshot()).toEqual(before);
      expect(store.db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
      expect(store.db.prepare('PRAGMA defer_foreign_keys').get()).toEqual({ defer_foreign_keys: 0 });
    } finally {
      store.close();
    }
  });
  it('enforces the rendered frame within fixed bounds and keeps rejected batches atomic', () => {
    const store = makeStore();
    try {
      const canvas = store.createCanvas({ title: 'Bounded', bounds: { mode: 'fixed', width: 500, height: 300 } });
      const cardAt = (id: string, x: number, y: number, width?: number, height?: number) => ({
        id,
        type: 'fixture.cards/card',
        schemaVersion: 1,
        x,
        y,
        ...(width === undefined ? {} : { width }),
        ...(height === undefined ? {} : { height }),
        data: { title: id }
      });
      const upsert = (element: ReturnType<typeof cardAt>) => ({ op: 'upsertElement' as const, element });
      const edge = store.applyOperations(canvas.id, { operations: [upsert(cardAt('edge', 260, 180))] });
      expect(edge.revision).toBe(2); // Missing sizes render as 240 × 120.
      const before = store.getCanvas(canvas.id);
      const events = store.db.prepare('SELECT * FROM canvas_events').all();
      for (const element of [
        cardAt('right', 261, 180),
        cardAt('bottom', 260, 181),
        cardAt('negative', -1, 0),
        cardAt('negative_width', 10, 10, -1, 10)
      ]) {
        expect(() =>
          store.applyOperations(canvas.id, { operations: [upsert(cardAt('valid', 0, 0)), upsert(element)] })
        ).toThrow(`element ${element.id} does not fit within the canvas bounds`);
        expect(store.getCanvas(canvas.id)).toEqual(before);
        expect(store.db.prepare('SELECT * FROM canvas_events').all()).toEqual(events);
      }
      expect(() =>
        store.applyOperations(canvas.id, {
          operations: [{ op: 'patchElementFrame', elementId: 'edge', frame: { x: 261 } }]
        })
      ).toThrow('element edge does not fit within the canvas bounds');
      expect(store.getCanvas(canvas.id)).toEqual(before);
      expect(store.applyOperations(canvas.id, { operations: [upsert(cardAt('zero', 500, 300, 0, 0))] }).revision).toBe(
        3
      );
    } finally {
      store.close();
    }
  });

  it('rejects bounds that strand elements and permits repair of legacy outliers', () => {
    const store = makeStore();
    try {
      const canvas = store.createCanvas({ title: 'Existing elements' });
      const inserted = store.applyOperations(canvas.id, {
        operations: [
          {
            op: 'upsertElement',
            element: { id: 'outside', type: 'fixture.cards/card', schemaVersion: 1, x: 400, y: 0, data: { title: 'A' } }
          }
        ]
      });
      expect(() =>
        store.updateCanvasBounds(canvas.id, {
          bounds: { mode: 'fixed', width: 500, height: 300 },
          expectedRevision: inserted.revision
        })
      ).toThrow('element outside does not fit within the canvas bounds');
      expect(store.getCanvas(canvas.id)).toEqual(inserted);
      store.db
        .prepare('UPDATE canvases SET bounds_json=?,width=?,height=? WHERE id=?')
        .run(JSON.stringify({ mode: 'fixed', width: 500, height: 300 }), 500, 300, canvas.id); // Existing databases may already have out-of-bounds elements.
      const renamed = store.applyOperations(canvas.id, {
        operations: [{ op: 'replaceElementMetadata', elementId: 'outside', metadata: { legacy: true } }]
      });
      expect(renamed.revision).toBe(3);
      expect(() =>
        store.applyOperations(canvas.id, {
          operations: [{ op: 'patchElementFrame', elementId: 'outside', frame: { x: 400 } }]
        })
      ).toThrow('element outside does not fit within the canvas bounds');
      const repaired = store.applyOperations(canvas.id, {
        operations: [{ op: 'patchElementFrame', elementId: 'outside', frame: { x: 260 } }]
      });
      expect(repaired.elements[0].x).toBe(260);
      expect(
        store.updateCanvasBounds(canvas.id, {
          bounds: { mode: 'fixed', width: 500, height: 300 },
          expectedRevision: repaired.revision
        }).revision
      ).toBe(5);
      expect(
        store.updateCanvasBounds(canvas.id, {
          bounds: { mode: 'unlimited' },
          expectedRevision: 5
        }).revision
      ).toBe(6);
      expect(
        store.applyOperations(canvas.id, {
          operations: [
            {
              op: 'patchElementFrame',
              elementId: 'outside',
              frame: { x: -100, width: -10 }
            }
          ]
        }).elements[0]
      ).toMatchObject({ x: -100, width: -10 });
    } finally {
      store.close();
    }
  });

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
