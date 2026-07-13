import fs from 'node:fs';
import path from 'node:path';
import { backup, DatabaseSync } from 'node:sqlite';
import { readBackupManifest, verifyBackupManifest } from './backup';
import { inspectMigrationDatabase } from './inspect';
import type { MigrationCounts } from './types';

export interface RestoreMigrationInput {
  databasePath: string;
  backupPath: string;
  manifestPath?: string;
  now?: Date;
}

export interface RestoreMigrationResult {
  ok: true;
  databasePath: string;
  backupPath: string;
  manifestPath: string;
  failedDatabasePath: string | null;
  restoredVersion: 1;
}

function restoreTimestamp(date: Date): string {
  return date.toISOString().replace(/[:.]/g, '-');
}

function failedDatabasePath(databasePath: string, now: Date): string {
  const parsed = path.parse(databasePath);
  return path.join(parsed.dir, `${parsed.name}.failed-v0.2-${restoreTimestamp(now)}${parsed.ext || '.sqlite'}`);
}

function assertInspectionMatchesManifest(backupPath: string, expectedCounts: MigrationCounts): void {
  const inspection = inspectMigrationDatabase(backupPath);
  if (!inspection.canApply || inspection.sourceVersion !== 1) {
    throw new Error(
      `backup is not a valid v0.1 database: ${inspection.issues.map((issue) => issue.message).join('; ')}`
    );
  }
  for (const field of ['canvases', 'elements', 'shareLinks', 'events', 'idempotencyRows'] as const) {
    if (inspection.counts[field] !== expectedCounts[field]) {
      throw new Error(
        `backup ${field} count mismatch: expected ${expectedCounts[field]}, found ${inspection.counts[field]}`
      );
    }
  }
}

function verifyExclusiveAccess(databasePath: string): void {
  const db = new DatabaseSync(databasePath);
  try {
    db.exec('PRAGMA busy_timeout = 1; BEGIN EXCLUSIVE; ROLLBACK;');
  } catch (error) {
    throw new Error('database is in use; stop AgentCanvas before restore', { cause: error });
  } finally {
    db.close();
  }
}

function moveSidecars(databasePath: string, failedPath: string): Array<{ from: string; to: string }> {
  const moved: Array<{ from: string; to: string }> = [];
  try {
    for (const suffix of ['-wal', '-shm']) {
      const from = `${databasePath}${suffix}`;
      if (!fs.existsSync(from)) continue;
      const to = `${failedPath}${suffix}`;
      fs.renameSync(from, to);
      moved.push({ from, to });
    }
    return moved;
  } catch (error) {
    for (const entry of moved.reverse()) fs.renameSync(entry.to, entry.from);
    throw error;
  }
}

/**
 * Restores a manifest-verified v0.1 SQLite backup through a staged database and atomic final rename.
 * The current database is first retained as a consistent native SQLite backup for post-failure investigation.
 */
export async function restoreMigration(input: RestoreMigrationInput): Promise<RestoreMigrationResult> {
  if (input.databasePath === ':memory:') throw new Error('migration restore refuses in-memory databases');
  const databasePath = path.resolve(input.databasePath);
  const backupPath = path.resolve(input.backupPath);
  const manifestPath = path.resolve(input.manifestPath ?? `${backupPath}.manifest.json`);
  if (databasePath === backupPath) throw new Error('restore target and backup path must differ');
  if (!fs.existsSync(backupPath)) throw new Error(`backup does not exist: ${backupPath}`);
  if (!fs.existsSync(manifestPath)) throw new Error(`backup manifest does not exist: ${manifestPath}`);

  const manifest = readBackupManifest(manifestPath);
  if (path.resolve(manifest.backupPath) !== backupPath) throw new Error('backup path does not match its manifest');
  if (path.resolve(manifest.sourceDatabasePath) !== databasePath) {
    throw new Error('restore target does not match the source database recorded by the backup manifest');
  }
  const manifestVerification = verifyBackupManifest(manifest);
  if (!manifestVerification.ok) {
    throw new Error(`backup manifest verification failed: ${manifestVerification.errors.join('; ')}`);
  }
  assertInspectionMatchesManifest(backupPath, manifest.counts);

  const now = input.now ?? new Date();
  const stagePath = path.join(
    path.dirname(databasePath),
    `.${path.basename(databasePath)}.restore-${restoreTimestamp(now)}.staging`
  );
  const failedPath = fs.existsSync(databasePath) ? failedDatabasePath(databasePath, now) : null;
  for (const candidate of [stagePath, failedPath]) {
    if (candidate && fs.existsSync(candidate)) throw new Error(`restore target already exists: ${candidate}`);
  }

  const backupDb = new DatabaseSync(backupPath, { readOnly: true });
  try {
    await backup(backupDb, stagePath);
  } finally {
    backupDb.close();
  }
  assertInspectionMatchesManifest(stagePath, manifest.counts);

  if (failedPath) {
    verifyExclusiveAccess(databasePath);
    const currentDb = new DatabaseSync(databasePath, { readOnly: true });
    try {
      await backup(currentDb, failedPath);
    } finally {
      currentDb.close();
    }
  }

  const movedSidecars = failedPath ? moveSidecars(databasePath, failedPath) : [];
  try {
    fs.renameSync(stagePath, databasePath);
  } catch (error) {
    for (const entry of movedSidecars.reverse()) fs.renameSync(entry.to, entry.from);
    throw new Error('atomic database restore failed; the original database remains in place', { cause: error });
  }

  const restored = inspectMigrationDatabase(databasePath);
  if (!restored.canApply || restored.sourceVersion !== 1) {
    throw new Error(
      'restored database failed final v0.1 verification; the preserved failed database remains available'
    );
  }
  return { ok: true, databasePath, backupPath, manifestPath, failedDatabasePath: failedPath, restoredVersion: 1 };
}
