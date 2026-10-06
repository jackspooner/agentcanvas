import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { backup, DatabaseSync } from 'node:sqlite';
import { inspectDatabaseVersion } from '../store/version.js';
import { createBackupManifest, verifyBackupManifest, writeBackupManifest } from './backup.js';
import {
  inspectMigrationDatabase,
  intendedMacroStorageBackupPath,
  intendedCanvasDeletionBackupPath
} from './inspect.js';
import type { MigrationCounts } from './types.js';
import { verifyMigrationConnection, verifyMigrationDatabase } from './verify.js';

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

function hasTable(db: DatabaseSync, table: string): boolean {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table));
}

function tableColumns(db: DatabaseSync, table: string): string[] {
  if (!hasTable(db, table)) return [];
  return (db.prepare(`PRAGMA table_info(${table})`).all() as unknown as Array<{ name: string }>).map((row) => row.name);
}

function stableRows(db: DatabaseSync, table: string): unknown[] {
  if (!hasTable(db, table)) return [];
  const columns = tableColumns(db, table);
  if (!columns.length) return [];
  const orderColumn = columns.includes('id') ? 'id' : columns.includes('key') ? 'key' : columns[0];
  return db.prepare(`SELECT * FROM "${table.replaceAll('"', '""')}" ORDER BY "${orderColumn}"`).all();
}

function preservationFingerprints(db: DatabaseSync): Record<string, string> {
  const tables = [
    'canvases',
    'canvas_events',
    'canvas_share_links',
    'canvas_viewports',
    'agent_canvas_configuration',
    'plugin_kv',
    'canvas_idempotency_keys',
    'macro_definitions',
    'macro_versions',
    'macro_invocations'
  ];
  return Object.fromEntries(
    tables.map((table) => [
      table,
      createHash('sha256')
        .update(
          JSON.stringify(stableRows(db, table), (_key, value) => (typeof value === 'bigint' ? value.toString() : value))
        )
        .digest('hex')
    ])
  );
}

function assertPreserved(before: Record<string, string>, after: Record<string, string>): void {
  for (const [table, fingerprint] of Object.entries(before)) {
    if (after[table] !== fingerprint) throw new Error(`${table} changed during the schema migration`);
  }
}

export async function applyPreservingSchemaMigration(input: {
  databasePath: string;
  backupDir?: string;
  toolVersion: string;
  now?: Date;
  sourcePhysicalVersion: 3 | 4;
  targetPhysicalVersion: 4 | 5;
  migrationId: string;
  schemaSql: string;
}): Promise<{
  ok: true;
  databasePath: string;
  backupPath: string;
  manifestPath: string;
  migrationRunId: string;
  verification: ReturnType<typeof verifyMigrationConnection>;
}> {
  if (input.databasePath === ':memory:') throw new Error('schema migration refuses in-memory databases');
  if (!input.toolVersion) throw new Error('migration toolVersion is required');
  const databasePath = path.resolve(input.databasePath);
  if (!fs.existsSync(databasePath)) throw new Error(`database does not exist: ${databasePath}`);
  const now = input.now ?? new Date();
  const createdAt = now.toISOString();
  const backupPath = path.join(
    path.resolve(input.backupDir ?? path.dirname(databasePath)),
    path.basename(
      input.sourcePhysicalVersion === 3
        ? intendedMacroStorageBackupPath(databasePath, now)
        : intendedCanvasDeletionBackupPath(databasePath, now)
    )
  );
  const manifestPath = `${backupPath}.manifest.json`;
  if (fs.existsSync(backupPath) || fs.existsSync(manifestPath)) {
    throw new Error(`migration backup target already exists: ${backupPath}`);
  }
  fs.mkdirSync(path.dirname(backupPath), { recursive: true });

  const db = new DatabaseSync(databasePath);
  let transactionOpen = false;
  let databaseClosed = false;
  try {
    db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 1; BEGIN EXCLUSIVE; ROLLBACK;');
    const state = inspectDatabaseVersion(db);
    if (state.kind !== 'v2' || state.physicalVersion !== input.sourcePhysicalVersion) {
      throw new Error(
        `schema migration requires physical/document version ${input.sourcePhysicalVersion}/2, found ${state.kind}`
      );
    }
    const before = counts(db);
    const beforeFingerprints = preservationFingerprints(db);
    await backup(db, backupPath);
    const backupInspection = inspectMigrationDatabase(backupPath);
    if (!backupInspection.canApply || backupInspection.versions.physicalVersion !== input.sourcePhysicalVersion) {
      throw new Error('schema migration backup is not a valid migration source');
    }
    const manifest = createBackupManifest({
      sourceDatabasePath: databasePath,
      backupPath,
      sourceVersion: 2,
      targetVersion: 2,
      sourcePhysicalVersion: input.sourcePhysicalVersion,
      targetPhysicalVersion: input.targetPhysicalVersion,
      createdAt,
      counts: before,
      toolVersion: input.toolVersion
    });
    writeBackupManifest(manifestPath, manifest);
    const verified = verifyBackupManifest(manifest);
    if (!verified.ok) throw new Error(`schema migration backup verification failed: ${verified.errors.join('; ')}`);

    db.exec('BEGIN EXCLUSIVE;');
    transactionOpen = true;
    const lockedState = inspectDatabaseVersion(db);
    if (lockedState.kind !== 'v2' || lockedState.physicalVersion !== input.sourcePhysicalVersion) {
      throw new Error('database version changed while the schema migration backup was created');
    }
    db.exec(input.schemaSql);
    db.prepare(
      `UPDATE agent_canvas_installation_metadata
       SET physical_version=?, document_version=2, migrated_at=?, tool_version=? WHERE id=1`
    ).run(input.targetPhysicalVersion, createdAt, input.toolVersion);
    db.exec(`PRAGMA user_version = ${input.targetPhysicalVersion};`);
    const migrationRunId = `migration_${createHash('sha256')
      .update(`${input.migrationId}:${createdAt}`)
      .digest('hex')
      .slice(0, 20)}`;
    const after = counts(db);
    const summary = {
      sourceVersion: 2,
      targetVersion: 2,
      sourcePhysicalVersion: input.sourcePhysicalVersion,
      targetPhysicalVersion: input.targetPhysicalVersion,
      countsBefore: before,
      countsAfter: after,
      mappedElementCounts: [],
      strippedRuntimeFieldCount: 0,
      invalidatedIdempotencyRows: 0,
      preservedEventCount: after.events,
      preservedShareLinkCount: after.shareLinks,
      integrityOk: true,
      foreignKeysOk: true
    };
    db.prepare(
      `INSERT INTO agent_canvas_migration_runs
       (id,migration_id,source_physical_version,target_physical_version,source_document_version,
        target_document_version,started_at,completed_at,backup_path,backup_sha256,summary_json)
       VALUES (?,?,?,?,2,2,?,?,?,?,?)`
    ).run(
      migrationRunId,
      input.migrationId,
      input.sourcePhysicalVersion,
      input.targetPhysicalVersion,
      createdAt,
      createdAt,
      backupPath,
      manifest.sha256,
      JSON.stringify(summary)
    );
    assertPreserved(beforeFingerprints, preservationFingerprints(db));
    const verification = verifyMigrationConnection(db, {
      targetPhysicalVersion: input.targetPhysicalVersion,
      expectations: {
        sourceVersion: 2,
        sourcePhysicalVersion: input.sourcePhysicalVersion,
        countsBefore: before,
        mappedElementCounts: [],
        strippedRuntimeFieldCount: 0,
        invalidatedIdempotencyRows: 0
      }
    });
    if (!verification.ok) throw new Error(`target verification failed: ${verification.errors.join('; ')}`);
    db.prepare('UPDATE agent_canvas_migration_runs SET summary_json=? WHERE id=?').run(
      JSON.stringify(verification.summary),
      migrationRunId
    );
    db.exec('COMMIT;');
    transactionOpen = false;
    db.close();
    databaseClosed = true;
    const committedVerification = verifyMigrationDatabase({
      databasePath,
      targetPhysicalVersion: input.targetPhysicalVersion
    });
    if (!committedVerification.ok) {
      throw new Error(`committed migration verification failed: ${committedVerification.errors.join('; ')}`);
    }
    return { ok: true, databasePath, backupPath, manifestPath, migrationRunId, verification: committedVerification };
  } catch (error) {
    if (transactionOpen) db.exec('ROLLBACK;');
    throw error;
  } finally {
    if (!databaseClosed) db.close();
  }
}
