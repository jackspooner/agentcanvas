import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { readBackupManifest, verifyBackupManifest } from '../src/migrations/backup.js';
import { restoreMigration } from '../src/migrations/restore.js';
import { applyMacroStorageSchemaMigration } from '../src/migrations/schema4.js';
import { inspectDatabaseVersion } from '../src/store/version.js';
import { V2_SCHEMA_SQL } from '../src/store/v2-schema.js';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function physical3Database(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentcanvas-schema4-'));
  roots.push(root);
  const databasePath = path.join(root, 'canvas.sqlite');
  const db = new DatabaseSync(databasePath);
  db.exec(V2_SCHEMA_SQL);
  db.prepare(
    `INSERT INTO agent_canvas_installation_metadata
     (id,physical_version,document_version,migrated_at,tool_version) VALUES (1,3,2,'before','test')`
  ).run();
  db.prepare(
    `INSERT INTO canvases
     (id,title,created_by,created_at,updated_at,width,height,elements_json,revision,document_version)
     VALUES ('canvas_1','Stored','agent','created','updated',100,100,'[]',3,2)`
  ).run();
  db.prepare(
    `INSERT INTO canvas_events
     (id,canvas_id,revision,operation_json,created_at,actor,document_version)
     VALUES ('event_1','canvas_1',3,'{"op":"keep"}','event','agent',2)`
  ).run();
  db.prepare(
    `INSERT INTO canvas_share_links
     (id,canvas_id,token_hash,mode,created_at) VALUES ('share_1','canvas_1','hash','read','share')`
  ).run();
  db.prepare(
    `INSERT INTO canvas_viewports
     (canvas_id,source,center_x,center_y,zoom,width,height,updated_at)
     VALUES ('canvas_1','user',1,2,1,100,100,'viewport')`
  ).run();
  db.prepare(
    `INSERT INTO agent_canvas_configuration (id,configuration_json,updated_at)
     VALUES (1,'{"keep":true}','config')`
  ).run();
  db.prepare(
    `INSERT INTO plugin_kv (plugin_id,key,value_json,updated_at) VALUES ('fixture','key','{"keep":true}','kv')`
  ).run();
  db.prepare(
    `INSERT INTO canvas_idempotency_keys
     (canvas_id,document_version,key,request_hash,response_json,created_at)
     VALUES ('canvas_1',2,'key_1','request','{"revision":3}','idempotency')`
  ).run();
  db.exec(
    'DROP INDEX macro_invocations_macro_id_idx; DROP INDEX macro_invocations_canvas_id_idx; DROP INDEX macro_versions_macro_id_idx; DROP INDEX macro_definitions_canvas_id_idx; DROP TABLE macro_invocations; DROP TABLE macro_versions; DROP TABLE macro_definitions; PRAGMA user_version=3;'
  );
  db.prepare('UPDATE agent_canvas_installation_metadata SET physical_version=3').run();
  db.close();
  return databasePath;
}

function preservedRows(db: DatabaseSync): Record<string, unknown[]> {
  return {
    canvases: db.prepare('SELECT * FROM canvases ORDER BY id').all(),
    canvas_events: db.prepare('SELECT * FROM canvas_events ORDER BY id').all(),
    canvas_share_links: db.prepare('SELECT * FROM canvas_share_links ORDER BY id').all(),
    canvas_viewports: db.prepare('SELECT * FROM canvas_viewports ORDER BY canvas_id, source').all(),
    agent_canvas_configuration: db.prepare('SELECT * FROM agent_canvas_configuration ORDER BY id').all(),
    plugin_kv: db.prepare('SELECT * FROM plugin_kv ORDER BY plugin_id, key').all(),
    canvas_idempotency_keys: db.prepare('SELECT * FROM canvas_idempotency_keys ORDER BY canvas_id, key').all()
  };
}

describe('physical schema 3 to 4 migration', () => {
  it('adds macro storage while preserving existing canvas state and idempotency', async () => {
    const databasePath = physical3Database();
    const beforeDb = new DatabaseSync(databasePath, { readOnly: true });
    const beforeRows = preservedRows(beforeDb);
    beforeDb.close();
    const result = await applyMacroStorageSchemaMigration({
      databasePath,
      toolVersion: '0.3.0-test',
      now: new Date('2026-07-20T10:00:00.000Z')
    });
    const db = new DatabaseSync(databasePath, { readOnly: true });
    expect(inspectDatabaseVersion(db)).toEqual({ kind: 'v2', physicalVersion: 4, documentVersion: 2 });
    expect(db.prepare('SELECT COUNT(*) AS count FROM macro_definitions').get()).toEqual({ count: 0 });
    expect(db.prepare('SELECT COUNT(*) AS count FROM canvas_idempotency_keys').get()).toEqual({ count: 1 });
    expect(preservedRows(db)).toEqual(beforeRows);
    expect(
      db.prepare('SELECT source_physical_version,target_physical_version FROM agent_canvas_migration_runs').get()
    ).toEqual({
      source_physical_version: 3,
      target_physical_version: 4
    });
    db.close();
    expect(result.verification.ok).toBe(true);
    expect(fs.existsSync(result.backupPath)).toBe(true);
    expect(fs.existsSync(result.manifestPath)).toBe(true);

    const manifest = readBackupManifest(result.manifestPath);
    expect(verifyBackupManifest(manifest)).toMatchObject({ ok: true, errors: [] });
    const restored = await restoreMigration({
      databasePath,
      backupPath: result.backupPath,
      now: new Date('2026-07-20T11:00:00.000Z')
    });
    expect(restored).toMatchObject({
      restoredVersion: 2,
      restoredPhysicalVersion: 3,
      restoredDocumentVersion: 2
    });
    const restoredDb = new DatabaseSync(databasePath, { readOnly: true });
    expect(inspectDatabaseVersion(restoredDb)).toEqual({ kind: 'v2', physicalVersion: 3, documentVersion: 2 });
    expect(preservedRows(restoredDb)).toEqual(beforeRows);
    expect(restoredDb.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE name LIKE 'macro_%'").get()).toEqual({
      count: 0
    });
    expect(restoredDb.prepare('SELECT COUNT(*) AS count FROM agent_canvas_migration_runs').get()).toEqual({ count: 0 });
    restoredDb.close();
  });

  it('rolls back macro tables, metadata, and the migration ledger on a pre-commit failure', async () => {
    const databasePath = physical3Database();
    const db = new DatabaseSync(databasePath);
    db.exec(`
      CREATE TRIGGER force_schema4_failure
      BEFORE UPDATE OF physical_version ON agent_canvas_installation_metadata
      WHEN NEW.physical_version = 4
      BEGIN
        SELECT RAISE(ABORT, 'forced schema4 failure');
      END;
    `);
    db.close();

    await expect(
      applyMacroStorageSchemaMigration({
        databasePath,
        toolVersion: '0.3.0-test',
        now: new Date('2026-07-20T12:00:00.000Z')
      })
    ).rejects.toThrow('forced schema4 failure');

    const failedDb = new DatabaseSync(databasePath, { readOnly: true });
    expect(inspectDatabaseVersion(failedDb)).toEqual({ kind: 'v2', physicalVersion: 3, documentVersion: 2 });
    expect(failedDb.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE name LIKE 'macro_%'").get()).toEqual({
      count: 0
    });
    expect(failedDb.prepare('SELECT COUNT(*) AS count FROM agent_canvas_migration_runs').get()).toEqual({ count: 0 });
    failedDb.close();
  });
});
