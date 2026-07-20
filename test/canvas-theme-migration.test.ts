import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { applyCanvasThemeSchemaMigration } from '../src/migrations/theme-schema.js';
import { inspectMigrationDatabase } from '../src/migrations/inspect.js';
import { restoreMigration } from '../src/migrations/restore.js';
import { verifyMigrationDatabase } from '../src/migrations/verify.js';
import { V2_SCHEMA_SQL } from '../src/store/v2-schema.js';
import { inspectDatabaseVersion } from '../src/store/version.js';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function legacyDatabase(): string {
  fs.mkdirSync(path.join(process.cwd(), 'tmp'), { recursive: true });
  const root = fs.mkdtempSync(path.join(process.cwd(), 'tmp', 'agentcanvas-theme-migration-'));
  roots.push(root);
  const databasePath = path.join(root, 'agentcanvas.sqlite');
  const db = new DatabaseSync(databasePath);
  db.exec(V2_SCHEMA_SQL.replace('  theme_json TEXT,\n', ''));
  db.prepare(
    `INSERT INTO agent_canvas_installation_metadata
     (id,physical_version,document_version,migrated_at,tool_version) VALUES (1,2,2,?,?)`
  ).run('2026-07-17T10:00:00.000Z', '0.2.0');
  db.prepare(
    `INSERT INTO canvases
     (id,title,created_by,created_at,updated_at,width,height,bounds_json,background_json,elements_json,revision,
      metadata_json,document_version)
     VALUES ('canvas_1','Legacy','agent',?,?,?,?,?,?,?,?,?,2)`
  ).run(
    '2026-07-17T10:00:00.000Z',
    '2026-07-17T10:00:00.000Z',
    1600,
    1000,
    '{"mode":"unlimited"}',
    'null',
    '[]',
    1,
    '{}'
  );
  db.prepare(
    `INSERT INTO canvas_events
     (id,canvas_id,revision,operation_json,created_at,actor,document_version)
     VALUES ('event_current','canvas_1',1,'{"op":"createCanvas"}',?,NULL,2)`
  ).run('2026-07-17T10:00:00.000Z');
  db.prepare(
    `INSERT INTO canvas_idempotency_keys
     (canvas_id,document_version,key,request_hash,response_json,created_at) VALUES ('canvas_1',2,'key_1','hash','{}',?)`
  ).run('2026-07-17T10:00:00.000Z');
  db.exec('PRAGMA user_version = 2;');
  db.close();
  return databasePath;
}

describe('canvas theme physical schema migration', () => {
  it('backs up and upgrades a stopped physical 2/document 2 database without changing canvases', async () => {
    const databasePath = legacyDatabase();
    const before = new DatabaseSync(databasePath);
    expect(inspectDatabaseVersion(before)).toMatchObject({ kind: 'v2-theme-migration-required' });
    before.close();
    expect(inspectMigrationDatabase(databasePath, { now: new Date('2026-07-17T10:30:00.000Z') })).toMatchObject({
      sourceVersion: 2,
      targetVersion: 2,
      canApply: true,
      intendedBackupPath: `${databasePath}.theme-schema-2026-07-17T10-30-00-000Z.bak`
    });

    const result = await applyCanvasThemeSchemaMigration({
      databasePath,
      now: new Date('2026-07-17T11:00:00.000Z'),
      toolVersion: '0.3.0-alpha.1'
    });
    expect(fs.existsSync(result.backupPath)).toBe(true);
    expect(fs.existsSync(result.manifestPath)).toBe(true);
    const migrated = new DatabaseSync(databasePath);
    expect(inspectDatabaseVersion(migrated)).toEqual({ kind: 'v2', physicalVersion: 3, documentVersion: 2 });
    expect(
      migrated.prepare("SELECT COUNT(*) AS count FROM pragma_table_info('canvases') WHERE name='theme_json'").get()
    ).toEqual({ count: 1 });
    expect(migrated.prepare('SELECT id,title,theme_json,revision FROM canvases').get()).toEqual({
      id: 'canvas_1',
      title: 'Legacy',
      theme_json: null,
      revision: 1
    });
    migrated.close();
    expect(verifyMigrationDatabase({ databasePath })).toMatchObject({ ok: true, errors: [] });

    const restored = await restoreMigration({
      databasePath,
      backupPath: result.backupPath,
      now: new Date('2026-07-17T11:30:00.000Z')
    });
    expect(restored).toMatchObject({
      restoredVersion: 2,
      restoredPhysicalVersion: 2,
      restoredDocumentVersion: 2
    });
    expect(restored.failedDatabasePath).not.toBeNull();
    expect(verifyMigrationDatabase({ databasePath: restored.failedDatabasePath as string })).toMatchObject({
      ok: true,
      errors: []
    });
    const restoredDb = new DatabaseSync(databasePath, { readOnly: true });
    expect(inspectDatabaseVersion(restoredDb)).toEqual({
      kind: 'v2-theme-migration-required',
      physicalVersion: 2,
      documentVersion: 2
    });
    expect(
      restoredDb.prepare("SELECT COUNT(*) AS count FROM pragma_table_info('canvases') WHERE name='theme_json'").get()
    ).toEqual({ count: 0 });
    expect(restoredDb.prepare('SELECT COUNT(*) AS count FROM canvas_idempotency_keys').get()).toEqual({ count: 1 });
    restoredDb.close();
  });
});
