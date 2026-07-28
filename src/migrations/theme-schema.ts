import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { backup, DatabaseSync } from 'node:sqlite';
import { AGENTCANVAS_VERSION } from '../version.js';
import { inspectDatabaseVersion } from '../store/version.js';
import { createBackupManifest, verifyBackupManifest, writeBackupManifest } from './backup.js';
import type { MigrationCounts } from './types.js';
import { MACRO_STORAGE_SCHEMA_SQL } from '../store/v2-schema.js';

const MIGRATION_ID = 'agentcanvas:physical-2-to-4-canvas-theme-and-macro-storage';

function count(db: DatabaseSync, table: string): number {
  return Number((db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number | bigint }).count);
}

function counts(db: DatabaseSync): MigrationCounts {
  const rows = db.prepare('SELECT elements_json FROM canvases').all() as unknown as Array<{ elements_json: string }>;
  return {
    canvases: rows.length,
    elements: rows.reduce((total, row) => total + (JSON.parse(row.elements_json) as unknown[]).length, 0),
    shareLinks: count(db, 'canvas_share_links'),
    events: count(db, 'canvas_events'),
    idempotencyRows: count(db, 'canvas_idempotency_keys')
  };
}

export function intendedCanvasThemeSchemaBackupPath(
  databasePath: string,
  backupDir: string | undefined,
  now: Date
): string {
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  return path.join(
    path.resolve(backupDir ?? path.dirname(databasePath)),
    `${path.basename(databasePath)}.theme-schema-${stamp}.bak`
  );
}

/** Adds first-class per-canvas theme storage without changing document version 2 envelopes. */
export async function applyCanvasThemeSchemaMigration(input: {
  databasePath: string;
  backupDir?: string;
  toolVersion?: string;
  now?: Date;
}): Promise<{
  ok: true;
  databasePath: string;
  backupPath: string;
  manifestPath: string;
  migrationRunId: string;
  invalidatedIdempotencyRows: number;
}> {
  if (input.databasePath === ':memory:') throw new Error('theme schema migration refuses in-memory databases');
  const databasePath = path.resolve(input.databasePath);
  if (!fs.existsSync(databasePath)) throw new Error(`database does not exist: ${databasePath}`);
  const toolVersion = input.toolVersion ?? AGENTCANVAS_VERSION;
  const now = input.now ?? new Date();
  const createdAt = now.toISOString();
  const backupPath = intendedCanvasThemeSchemaBackupPath(databasePath, input.backupDir, now);
  const manifestPath = `${backupPath}.manifest.json`;
  if (fs.existsSync(backupPath) || fs.existsSync(manifestPath)) {
    throw new Error(`migration backup target already exists: ${backupPath}`);
  }
  fs.mkdirSync(path.dirname(backupPath), { recursive: true });

  const db = new DatabaseSync(databasePath);
  let transactionOpen = false;
  try {
    db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 1; BEGIN EXCLUSIVE; ROLLBACK;');
    const state = inspectDatabaseVersion(db);
    if (state.kind !== 'v2-theme-migration-required') {
      throw new Error(`theme schema migration requires physical/document version 2/2, found ${state.kind}`);
    }
    const before = counts(db);
    await backup(db, backupPath);
    const manifest = createBackupManifest({
      sourceDatabasePath: databasePath,
      backupPath,
      sourceVersion: 2,
      targetVersion: 2,
      sourcePhysicalVersion: 2,
      targetPhysicalVersion: 4,
      createdAt,
      counts: before,
      toolVersion
    });
    writeBackupManifest(manifestPath, manifest);
    const verified = verifyBackupManifest(manifest);
    if (!verified.ok) throw new Error(`theme schema backup verification failed: ${verified.errors.join('; ')}`);

    db.exec('BEGIN EXCLUSIVE;');
    transactionOpen = true;
    if (inspectDatabaseVersion(db).kind !== 'v2-theme-migration-required') {
      throw new Error('database version changed while the theme schema backup was created');
    }
    db.exec('ALTER TABLE canvases ADD COLUMN theme_json TEXT; DELETE FROM canvas_idempotency_keys;');
    db.exec(MACRO_STORAGE_SCHEMA_SQL);
    db.prepare(
      `UPDATE agent_canvas_installation_metadata
       SET physical_version=4, document_version=2, migrated_at=?, tool_version=? WHERE id=1`
    ).run(createdAt, toolVersion);
    db.exec('PRAGMA user_version = 4;');

    const migrationRunId = `migration_${createHash('sha256')
      .update(`${MIGRATION_ID}:${createdAt}`)
      .digest('hex')
      .slice(0, 20)}`;
    const after = counts(db);
    const summary = {
      sourceVersion: 2,
      targetVersion: 2,
      sourcePhysicalVersion: 2,
      targetPhysicalVersion: 4,
      documentVersion: 2,
      countsBefore: before,
      countsAfter: after,
      mappedElementCounts: [],
      strippedRuntimeFieldCount: 0,
      invalidatedIdempotencyRows: before.idempotencyRows,
      preservedEventCount: after.events,
      preservedShareLinkCount: after.shareLinks,
      integrityOk: true,
      foreignKeysOk: true
    };
    db.prepare(
      `INSERT INTO agent_canvas_migration_runs
       (id,migration_id,source_physical_version,target_physical_version,source_document_version,
        target_document_version,started_at,completed_at,backup_path,backup_sha256,summary_json)
       VALUES (?,?,2,4,2,2,?,?,?,?,?)`
    ).run(migrationRunId, MIGRATION_ID, createdAt, createdAt, backupPath, manifest.sha256, JSON.stringify(summary));

    const integrity = (db.prepare('PRAGMA integrity_check').all() as unknown as Array<Record<string, string>>).map(
      (row) => Object.values(row)[0]
    );
    if (!integrity.every((value) => value === 'ok')) {
      throw new Error(`SQLite integrity check failed: ${integrity.join('; ')}`);
    }
    const foreignKeyViolations = (db.prepare('PRAGMA foreign_key_check').all() as unknown[]).length;
    if (foreignKeyViolations) throw new Error(`SQLite foreign-key check found ${foreignKeyViolations} violation(s)`);
    const finalState = inspectDatabaseVersion(db);
    if (finalState.kind !== 'v2') throw new Error(`theme schema migration produced invalid state: ${finalState.kind}`);
    if (after.canvases !== before.canvases || after.elements !== before.elements || after.events !== before.events) {
      throw new Error('theme schema migration changed canonical canvas, element, or event counts');
    }

    db.exec('COMMIT;');
    transactionOpen = false;
    return {
      ok: true,
      databasePath,
      backupPath,
      manifestPath,
      migrationRunId,
      invalidatedIdempotencyRows: before.idempotencyRows
    };
  } catch (error) {
    if (transactionOpen) db.exec('ROLLBACK;');
    throw error;
  } finally {
    db.close();
  }
}
