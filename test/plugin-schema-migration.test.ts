import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { ElementTypeDescriptor, JsonObject } from '@agentcanvas/plugin-sdk';
import { describe, expect, it } from 'vitest';
import {
  applyPluginSchemaMigrations,
  assertPluginSchemasReady,
  inspectPluginSchemaMigrations
} from '../src/migrations/plugin-schema.js';
import { FrozenPluginRegistry, type ActivatedPlugin } from '../src/plugin-runtime/registry.js';
import { initializeEmptyV2Database } from '../src/store/version.js';

function registry(): FrozenPluginRegistry {
  const descriptor: ElementTypeDescriptor = {
    name: 'card',
    schemaVersion: 2,
    dataSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['message', 'migrated'],
      properties: { message: { type: 'string' }, migrated: { const: true } }
    },
    browser: false,
    snapshot: 'unsupported',
    summarize: () => ({ title: 'Card' }),
    schemaMigrations: [
      {
        fromVersion: 1,
        toVersion: 2,
        migrate: (data) => ({ data: { ...data, migrated: true } as JsonObject })
      }
    ]
  };
  const activated = {
    plugin: {
      manifest: {
        id: 'example.plugin',
        version: '2.0.0',
        permissions: [],
        contributes: { elements: [], tools: [], procedures: [], migrations: [] }
      }
    },
    elements: [descriptor],
    tools: [],
    procedures: [],
    migrations: []
  } as unknown as ActivatedPlugin;
  return new FrozenPluginRegistry([activated], new Map());
}

function database(directory: string): string {
  const databasePath = path.join(directory, 'canvas.sqlite');
  const db = new DatabaseSync(databasePath);
  initializeEmptyV2Database(db, 'test');
  const now = '2026-07-13T00:00:00.000Z';
  db.prepare(
    `INSERT INTO canvases
     (id,title,description,project,conversation_id,created_by,created_at,updated_at,width,height,
      bounds_json,background_json,elements_json,revision,metadata_json,document_version)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,2)`
  ).run(
    'canvas-1',
    'Fixture',
    null,
    null,
    null,
    'system',
    now,
    now,
    100,
    100,
    JSON.stringify({ mode: 'fixed', width: 100, height: 100 }),
    null,
    JSON.stringify([
      {
        id: 'card-1',
        type: 'example.plugin/card',
        schemaVersion: 1,
        x: 0,
        y: 0,
        data: { message: 'hello' }
      }
    ]),
    1,
    null
  );
  db.close();
  return databasePath;
}

describe('installed plugin schema migrations', () => {
  it('blocks startup, applies a backed-up pure chain, and records the migration', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'agentcanvas-plugin-migration-'));
    const databasePath = database(directory);
    const plugins = registry();
    const before = new DatabaseSync(databasePath);
    expect(inspectPluginSchemaMigrations(before, plugins).pending).toHaveLength(1);
    expect(() => assertPluginSchemasReady(before, plugins, databasePath, path.join(directory, 'plugins'))).toThrowError(
      expect.objectContaining({ code: 'plugin_migration_required', status: 503 })
    );
    before.close();

    const result = await applyPluginSchemaMigrations({
      databasePath,
      registry: plugins,
      backupDir: directory,
      toolVersion: '0.2.0',
      now: new Date('2026-07-13T01:00:00.000Z')
    });
    expect(result.migratedElements).toBe(1);
    expect(fs.existsSync(result.backupPath)).toBe(true);
    expect(fs.existsSync(result.manifestPath)).toBe(true);

    const after = new DatabaseSync(databasePath);
    expect(inspectPluginSchemaMigrations(after, plugins)).toEqual({ pending: [], blockers: [] });
    const row = after.prepare('SELECT elements_json, revision FROM canvases WHERE id=?').get('canvas-1') as {
      elements_json: string;
      revision: number;
    };
    expect(JSON.parse(row.elements_json)).toMatchObject([
      { schemaVersion: 2, data: { message: 'hello', migrated: true } }
    ]);
    expect(row.revision).toBe(1);
    expect(
      (after.prepare('SELECT COUNT(*) AS count FROM plugin_migration_runs').get() as { count: number }).count
    ).toBe(1);
    after.close();
  });
});
