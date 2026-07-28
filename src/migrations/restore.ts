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
  restoredVersion: 1 | 2;
  restoredPhysicalVersion: number;
  restoredDocumentVersion: 1 | 2;
}

interface RestorableBackupState {
  sourceVersion: 1 | 2;
  physicalVersion: number;
  documentVersion: 1 | 2;
}

function restoreTimestamp(date: Date): string {
  return date.toISOString().replace(/[:.]/g, '-');
}

function failedDatabasePath(databasePath: string, now: Date): string {
  const parsed = path.parse(databasePath);
  return path.join(parsed.dir, `${parsed.name}.failed-v0.2-${restoreTimestamp(now)}${parsed.ext || '.sqlite'}`);
}

function assertInspectionMatchesManifest(
  backupPath: string,
  sourceVersion: number,
  targetVersion: number,
  expectedCounts: MigrationCounts
): RestorableBackupState {
  const inspection = inspectMigrationDatabase(backupPath);
  const isLegacyMigrationSource =
    sourceVersion === 1 && targetVersion === 2 && inspection.canApply && inspection.sourceVersion === 1;
  const isThemeMigrationSource =
    sourceVersion === 2 &&
    targetVersion === 2 &&
    inspection.canApply &&
    inspection.sourceVersion === 2 &&
    inspection.versions.physicalVersion === 2 &&
    inspection.versions.documentVersions.length === 1 &&
    inspection.versions.documentVersions[0] === 2;
  const isMacroStorageMigrationSource =
    sourceVersion === 2 &&
    targetVersion === 2 &&
    inspection.canApply &&
    inspection.sourceVersion === 2 &&
    inspection.versions.physicalVersion === 3;
  if (!isLegacyMigrationSource && !isThemeMigrationSource && !isMacroStorageMigrationSource) {
    const details =
      inspection.issues.map((issue) => issue.message).join('; ') || 'version state does not match manifest';
    throw new Error(`backup is not a supported migration source (${sourceVersion} -> ${targetVersion}): ${details}`);
  }
  for (const field of ['canvases', 'elements', 'shareLinks', 'events', 'idempotencyRows'] as const) {
    if (inspection.counts[field] !== expectedCounts[field]) {
      throw new Error(
        `backup ${field} count mismatch: expected ${expectedCounts[field]}, found ${inspection.counts[field]}`
      );
    }
  }
  return {
    sourceVersion: inspection.sourceVersion as 1 | 2,
    physicalVersion: inspection.versions.physicalVersion,
    documentVersion: inspection.sourceVersion as 1 | 2
  };
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
 * Restores a supported manifest-verified SQLite migration backup through a staged database and atomic final rename.
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
  const backupState = assertInspectionMatchesManifest(
    backupPath,
    manifest.sourceVersion,
    manifest.targetVersion,
    manifest.counts
  );

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
  assertInspectionMatchesManifest(stagePath, manifest.sourceVersion, manifest.targetVersion, manifest.counts);

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

  const restoredState = assertInspectionMatchesManifest(
    databasePath,
    manifest.sourceVersion,
    manifest.targetVersion,
    manifest.counts
  );
  if (
    restoredState.sourceVersion !== backupState.sourceVersion ||
    restoredState.physicalVersion !== backupState.physicalVersion ||
    restoredState.documentVersion !== backupState.documentVersion
  ) {
    throw new Error('restored database version differs from the verified backup');
  }
  return {
    ok: true,
    databasePath,
    backupPath,
    manifestPath,
    failedDatabasePath: failedPath,
    restoredVersion: restoredState.sourceVersion,
    restoredPhysicalVersion: restoredState.physicalVersion,
    restoredDocumentVersion: restoredState.documentVersion
  };
}
