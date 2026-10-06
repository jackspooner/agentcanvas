import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { readBackupManifest, verifyBackupManifest } from '../src/migrations/backup';
import { applyCanvasDeletionSchemaMigration } from '../src/migrations/schema5';
import { restoreMigration } from '../src/migrations/restore';
import { applyMigrationCli } from '../src/cli/main';
import { inspectMigrationDatabase } from '../src/migrations/inspect';
import { inspectDatabaseVersion, requireV2Database } from '../src/store/version';
import { V2_SCHEMA_SQL } from '../src/store/v2-schema';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function fixture(version = 4): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentcanvas-schema5-'));
  roots.push(root);
  const file = path.join(root, 'canvas.sqlite');
  const db = new DatabaseSync(file);
  db.exec(V2_SCHEMA_SQL);
  db.prepare('INSERT INTO agent_canvas_installation_metadata VALUES (1,?,2,?,?)').run(version, 'before', 'test');
  db.exec(`
    INSERT INTO canvases (id,title,created_by,created_at,updated_at,width,height,elements_json,revision,document_version)
      VALUES ('canvas_1','Stored','agent','before','before',100,100,'[]',3,2);
    INSERT INTO plugin_kv VALUES ('fixture','media','{"assetId":"external"}','before');
    DROP TRIGGER macro_versions_immutable_delete;
    CREATE TRIGGER macro_versions_immutable_delete BEFORE DELETE ON macro_versions
      BEGIN SELECT RAISE(ABORT, 'macro version records are immutable'); END;
  `);
  if (version === 3) db.exec('DROP TABLE macro_invocations; DROP TABLE macro_versions; DROP TABLE macro_definitions;');
  if (version === 2)
    db.exec(
      'DROP TABLE macro_invocations; DROP TABLE macro_versions; DROP TABLE macro_definitions; ALTER TABLE canvases DROP COLUMN theme_json;'
    );
  db.exec(`PRAGMA user_version=${version};`);
  db.close();
  return file;
}

describe('physical schema 4 to 5 migration', () => {
  it('requires offline migration, verifies its backup, preserves rows, and keeps live macro versions immutable', async () => {
    const databasePath = fixture();
    const db = new DatabaseSync(databasePath);
    expect(() => requireV2Database(db)).toThrow('canvas deletion schema migration');
    db.exec(`
      INSERT INTO macro_definitions VALUES ('local','canvas','canvas_1',1,NULL,'before','before');
      INSERT INTO macro_definitions VALUES ('global','installation',NULL,1,NULL,'before','before');
      INSERT INTO macro_versions VALUES ('local',1,'{}','hash','before');
      INSERT INTO macro_versions VALUES ('global',1,'{}','hash','before');
    `);
    const tables = ['canvases', 'plugin_kv', 'macro_definitions', 'macro_versions'];
    const before = tables.map((table) => db.prepare(`SELECT * FROM ${table}`).all());
    db.close();
    expect(inspectMigrationDatabase(databasePath)).toMatchObject({ canApply: true, targetPhysicalVersion: 5 });
    const result = await applyCanvasDeletionSchemaMigration({ databasePath, toolVersion: 'test' });
    const manifest = readBackupManifest(result.manifestPath);
    expect(manifest).toMatchObject({ sourcePhysicalVersion: 4, targetPhysicalVersion: 5 });
    expect(verifyBackupManifest(manifest)).toMatchObject({ ok: true });
    expect(result.verification).toMatchObject({ ok: true, errors: [] });
    const migrated = new DatabaseSync(databasePath);
    try {
      expect(inspectDatabaseVersion(migrated)).toEqual({ kind: 'v2', physicalVersion: 5, documentVersion: 2 });
      expect(tables.map((table) => migrated.prepare(`SELECT * FROM ${table}`).all())).toEqual(before);
      for (const id of ['local', 'global']) {
        expect(() => migrated.prepare('DELETE FROM macro_versions WHERE macro_id=?').run(id)).toThrow('immutable');
        expect(() =>
          migrated.prepare("UPDATE macro_versions SET definition_json='changed' WHERE macro_id=?").run(id)
        ).toThrow('immutable');
      }
      migrated.exec(
        "PRAGMA foreign_keys=ON; BEGIN IMMEDIATE; PRAGMA defer_foreign_keys=ON; DELETE FROM macro_definitions WHERE id='local'; DELETE FROM macro_versions WHERE macro_id='local'; COMMIT;"
      );
      expect(migrated.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
      expect(migrated.prepare('SELECT macro_id FROM macro_versions').all()).toEqual([{ macro_id: 'global' }]);
    } finally {
      migrated.close();
    }
    await restoreMigration({ databasePath, backupPath: result.backupPath });
    const restored = new DatabaseSync(databasePath);
    try {
      expect(inspectDatabaseVersion(restored)).toEqual({ kind: 'v2', physicalVersion: 4, documentVersion: 2 });
      expect(tables.map((table) => restored.prepare(`SELECT * FROM ${table}`).all())).toEqual(before);
      expect(() => restored.prepare("DELETE FROM macro_versions WHERE macro_id='local'").run()).toThrow('immutable');
    } finally {
      restored.close();
    }
  });

  it('rolls back the trigger, metadata, and ledger on failure', async () => {
    const databasePath = fixture();
    const db = new DatabaseSync(databasePath);
    const trigger = db.prepare("SELECT sql FROM sqlite_master WHERE name='macro_versions_immutable_delete'").get();
    db.exec(
      "CREATE TRIGGER fail_schema5 BEFORE UPDATE OF physical_version ON agent_canvas_installation_metadata WHEN NEW.physical_version=5 BEGIN SELECT RAISE(ABORT, 'forced schema5 failure'); END;"
    );
    db.close();
    await expect(applyCanvasDeletionSchemaMigration({ databasePath, toolVersion: 'test' })).rejects.toThrow(
      'forced schema5 failure'
    );
    const failed = new DatabaseSync(databasePath);
    try {
      expect(inspectDatabaseVersion(failed)).toEqual({ kind: 'v2', physicalVersion: 4, documentVersion: 2 });
      expect(
        failed.prepare("SELECT sql FROM sqlite_master WHERE name='macro_versions_immutable_delete'").get()
      ).toEqual(trigger);
      expect(failed.prepare('SELECT COUNT(*) AS count FROM agent_canvas_migration_runs').get()).toEqual({ count: 0 });
    } finally {
      failed.close();
    }
  });

  it.each([2, 3])('chains physical schema %i through 4 to 5 in the CLI', async (version) => {
    const databasePath = fixture(version);
    const result = (await applyMigrationCli({ databasePath })) as {
      verification: { ok: boolean };
      precedingMigrations: unknown[];
    };
    expect(result.verification.ok).toBe(true);
    expect(result.precedingMigrations).toHaveLength(1);
    const db = new DatabaseSync(databasePath);
    try {
      expect(inspectDatabaseVersion(db)).toEqual({ kind: 'v2', physicalVersion: 5, documentVersion: 2 });
      expect(
        db
          .prepare('SELECT target_physical_version FROM agent_canvas_migration_runs ORDER BY target_physical_version')
          .all()
      ).toEqual([{ target_physical_version: 4 }, { target_physical_version: 5 }]);
    } finally {
      db.close();
    }
  });
});
