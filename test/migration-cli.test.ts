import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyMigrationCli } from '../src/cli/main';
import { readBackupManifest, verifyBackupManifest } from '../src/migrations/backup';
import { runMigrationCli } from '../src/cli/migrate';
import { inspectDatabaseVersion } from '../src/store/version';
import { V2_SCHEMA_SQL } from '../src/store/v2-schema';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function physical3Database(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentcanvas-cli-migration-'));
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
     VALUES ('canvas_1','CLI','agent','created','updated',100,100,'[]',1,2)`
  ).run();
  db.exec(
    'DROP INDEX macro_invocations_macro_id_idx; DROP INDEX macro_invocations_canvas_id_idx; DROP INDEX macro_versions_macro_id_idx; DROP INDEX macro_definitions_canvas_id_idx; DROP TABLE macro_invocations; DROP TABLE macro_versions; DROP TABLE macro_definitions; PRAGMA user_version=3;'
  );
  db.prepare('UPDATE agent_canvas_installation_metadata SET physical_version=3').run();
  db.close();
  return databasePath;
}

describe('migration CLI dispatch', () => {
  it('dispatches apply arguments through an integration hook', async () => {
    const apply = vi.fn(() => ({ ok: true }));
    const stdout = vi.fn();
    const code = await runMigrationCli(
      ['migrate', 'apply', '--database', 'canvas.sqlite', '--backup-dir', 'backups', '--plugins', 'plugins'],
      { stdout, stderr: vi.fn() },
      { inspect: vi.fn(), apply }
    );
    expect(code).toBe(0);
    expect(apply).toHaveBeenCalledWith({
      databasePath: 'canvas.sqlite',
      backupDir: 'backups',
      pluginsPath: 'plugins'
    });
    expect(stdout).toHaveBeenCalledWith(JSON.stringify({ ok: true }, null, 2));
  });

  it('routes physical 3/document 2 apply through offline macro storage migration', async () => {
    const databasePath = physical3Database();
    const result = await applyMigrationCli({
      databasePath,
      backupDir: path.join(path.dirname(databasePath), 'backups'),
      pluginsPath: path.join(path.dirname(databasePath), 'missing-plugins')
    });
    const migration = result as { backupPath: string; manifestPath: string };
    expect(migration.backupPath).toContain('.macro-storage-');
    expect(verifyBackupManifest(readBackupManifest(migration.manifestPath))).toMatchObject({ ok: true, errors: [] });
    const db = new DatabaseSync(databasePath, { readOnly: true });
    expect(inspectDatabaseVersion(db)).toEqual({ kind: 'v2', physicalVersion: 4, documentVersion: 2 });
    db.close();
  });

  it('fails closed when a mutating integration hook is absent', async () => {
    const stderr = vi.fn();
    const code = await runMigrationCli(
      ['migrate', 'restore', '--database', 'canvas.sqlite', '--backup', 'backup.sqlite'],
      { stdout: vi.fn(), stderr },
      { inspect: vi.fn() }
    );
    expect(code).toBe(1);
    expect(stderr).toHaveBeenCalledWith('migration restore integration is not available in this build');
  });
});
