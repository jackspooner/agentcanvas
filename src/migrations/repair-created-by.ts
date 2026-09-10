import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { backup, DatabaseSync } from 'node:sqlite';
import { createBackupManifest, verifyBackupManifest, writeBackupManifest } from './backup.js';
import { inspectMigrationDatabase } from './inspect.js';

const MIGRATION_ID = 'agentcanvas-repair-created-by';
const CANONICAL_CREATORS = new Set(['agent', 'user', 'system']);

export interface RepairCreatedByResult {
  ok: true;
  databasePath: string;
  repaired: number;
  noOp: boolean;
  backupPath?: string;
  manifestPath?: string;
  migrationRunId?: string;
}

function backupPath(databasePath: string, backupDir: string, now: Date): string {
  const parsed = path.parse(databasePath);
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  const directory = path.resolve(backupDir);
  fs.mkdirSync(directory, { recursive: true });
  return path.join(directory, `${parsed.name}.created-by-${stamp}${parsed.ext || '.sqlite'}.bak`);
}

/** Repairs historical creator labels offline without changing schema versions. */
export async function repairCreatedBy(input: {
  databasePath: string;
  backupDir: string;
  toolVersion: string;
  now?: Date;
}): Promise<RepairCreatedByResult> {
  if (!input.backupDir) throw new Error('repair-created-by requires --backup-dir');
  const databasePath = path.resolve(input.databasePath);
  if (!fs.existsSync(databasePath)) throw new Error(`database does not exist: ${databasePath}`);
  const db = new DatabaseSync(databasePath);
  let transactionOpen = false;
  try {
    db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 1; BEGIN EXCLUSIVE; ROLLBACK;');
    const existing = db.prepare('SELECT id FROM agent_canvas_migration_runs WHERE migration_id = ?').get(MIGRATION_ID);
    if (existing) return { ok: true, databasePath, repaired: 0, noOp: true };
    const rows = db
      .prepare('SELECT id, created_by, metadata_json FROM canvases ORDER BY id')
      .all() as unknown as Array<{ id: string; created_by: string; metadata_json: string | null }>;
    const invalid = rows.filter((row) => !CANONICAL_CREATORS.has(row.created_by));
    if (invalid.length === 0) return { ok: true, databasePath, repaired: 0, noOp: true };
    const updates = invalid.map((row) => {
      const metadata = row.metadata_json ? (JSON.parse(row.metadata_json) as Record<string, unknown>) : {};
      if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata))
        throw new Error(`canvas ${row.id} metadata_json is not an object`);
      if (metadata.legacyCreatedBy !== undefined && metadata.legacyCreatedBy !== row.created_by)
        throw new Error(`canvas ${row.id} has conflicting metadata.legacyCreatedBy`);
      return { id: row.id, metadata: { ...metadata, legacyCreatedBy: row.created_by } };
    });
    const now = input.now ?? new Date();
    const createdAt = now.toISOString();
    const target = backupPath(databasePath, input.backupDir, now);
    const manifestPath = `${target}.manifest.json`;
    if (fs.existsSync(target) || fs.existsSync(manifestPath))
      throw new Error(`repair backup target already exists: ${target}`);
    const before = inspectMigrationDatabase(databasePath);
    await backup(db, target);
    const manifest = createBackupManifest({
      sourceDatabasePath: databasePath,
      backupPath: target,
      sourceVersion: 2,
      targetVersion: 2,
      sourcePhysicalVersion: 4,
      targetPhysicalVersion: 4,
      createdAt,
      counts: before.counts,
      toolVersion: input.toolVersion
    });
    writeBackupManifest(manifestPath, manifest);
    const backupCheck = verifyBackupManifest(manifest);
    const backupInspection = inspectMigrationDatabase(target);
    if (
      !backupCheck.ok ||
      !backupInspection.checks.integrity.every((value) => value === 'ok') ||
      backupInspection.checks.foreignKeyViolations !== 0
    )
      throw new Error(`repair backup verification failed: ${backupCheck.errors.join('; ') || 'SQLite checks failed'}`);

    db.exec('BEGIN EXCLUSIVE;');
    transactionOpen = true;
    const update = db.prepare("UPDATE canvases SET created_by = 'system', metadata_json = ? WHERE id = ?");
    for (const row of updates) update.run(JSON.stringify(row.metadata), row.id);
    const migrationRunId = `migration_${createHash('sha256').update(`${MIGRATION_ID}:${createdAt}`).digest('hex').slice(0, 20)}`;
    const summary = {
      sourceVersion: 2,
      targetVersion: 2,
      sourcePhysicalVersion: 4,
      targetPhysicalVersion: 4,
      countsBefore: before.counts,
      countsAfter: before.counts,
      mappedElementCounts: before.typeMappings,
      strippedRuntimeFieldCount: 0,
      invalidatedIdempotencyRows: 0,
      preservedEventCount: before.counts.events,
      preservedShareLinkCount: before.counts.shareLinks,
      integrityOk: true,
      foreignKeysOk: true,
      repairedCreatedByRows: updates.length
    };
    db.prepare(
      `INSERT INTO agent_canvas_migration_runs
       (id, migration_id, source_physical_version, target_physical_version, source_document_version,
        target_document_version, started_at, completed_at, backup_path, backup_sha256, summary_json)
       VALUES (?, ?, 4, 4, 2, 2, ?, ?, ?, ?, ?)`
    ).run(migrationRunId, MIGRATION_ID, createdAt, createdAt, target, manifest.sha256, JSON.stringify(summary));
    const remaining = Number(
      (
        db
          .prepare("SELECT COUNT(*) AS count FROM canvases WHERE created_by NOT IN ('agent', 'user', 'system')")
          .get() as { count: number | bigint }
      ).count
    );
    if (remaining !== 0) throw new Error(`repair verification found ${remaining} noncanonical creator value(s)`);
    const integrity = db.prepare('PRAGMA integrity_check').all() as unknown as Array<Record<string, string>>;
    if (integrity.some((row) => Object.values(row)[0] !== 'ok') || db.prepare('PRAGMA foreign_key_check').all().length)
      throw new Error('repair verification failed SQLite integrity checks');
    db.exec('COMMIT;');
    transactionOpen = false;
    return {
      ok: true,
      databasePath,
      repaired: updates.length,
      noOp: false,
      backupPath: target,
      manifestPath,
      migrationRunId
    };
  } catch (error) {
    if (transactionOpen) db.exec('ROLLBACK;');
    throw error;
  } finally {
    db.close();
  }
}
