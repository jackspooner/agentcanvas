import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { MigrationCounts } from './types';

export interface MigrationBackupManifest {
  manifestVersion: 1;
  sourceDatabasePath: string;
  backupPath: string;
  byteLength: number;
  sha256: string;
  sourceVersion: number;
  targetVersion: number;
  createdAt: string;
  counts: MigrationCounts;
  toolVersion: string;
}

export interface BackupVerificationResult {
  ok: boolean;
  actualByteLength: number;
  actualSha256: string;
  errors: string[];
}

export function sha256File(filePath: string): string {
  const hash = createHash('sha256');
  const descriptor = fs.openSync(filePath, 'r');
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    let bytesRead = 0;
    do {
      bytesRead = fs.readSync(descriptor, buffer, 0, buffer.length, null);
      if (bytesRead > 0) hash.update(buffer.subarray(0, bytesRead));
    } while (bytesRead > 0);
  } finally {
    fs.closeSync(descriptor);
  }
  return hash.digest('hex');
}

export function createBackupManifest(input: {
  sourceDatabasePath: string;
  backupPath: string;
  sourceVersion: number;
  targetVersion: number;
  createdAt?: string;
  counts: MigrationCounts;
  toolVersion: string;
}): MigrationBackupManifest {
  const backupPath = path.resolve(input.backupPath);
  const stat = fs.statSync(backupPath);
  if (!stat.isFile()) throw new Error(`backup is not a file: ${backupPath}`);
  return {
    manifestVersion: 1,
    sourceDatabasePath: path.resolve(input.sourceDatabasePath),
    backupPath,
    byteLength: stat.size,
    sha256: sha256File(backupPath),
    sourceVersion: input.sourceVersion,
    targetVersion: input.targetVersion,
    createdAt: input.createdAt ?? new Date().toISOString(),
    counts: { ...input.counts },
    toolVersion: input.toolVersion
  };
}

export function verifyBackupManifest(manifest: MigrationBackupManifest): BackupVerificationResult {
  const errors: string[] = [];
  if (manifest.manifestVersion !== 1) errors.push(`unsupported backup manifest version: ${manifest.manifestVersion}`);
  if (!fs.existsSync(manifest.backupPath)) {
    return { ok: false, actualByteLength: 0, actualSha256: '', errors: [...errors, 'backup file does not exist'] };
  }
  const stat = fs.statSync(manifest.backupPath);
  const actualSha256 = sha256File(manifest.backupPath);
  if (stat.size !== manifest.byteLength)
    errors.push(`backup length mismatch: expected ${manifest.byteLength}, found ${stat.size}`);
  if (actualSha256 !== manifest.sha256)
    errors.push(`backup SHA-256 mismatch: expected ${manifest.sha256}, found ${actualSha256}`);
  return { ok: errors.length === 0, actualByteLength: stat.size, actualSha256, errors };
}

export function writeBackupManifest(manifestPath: string, manifest: MigrationBackupManifest): void {
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
}

export function readBackupManifest(manifestPath: string): MigrationBackupManifest {
  const value = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as Partial<MigrationBackupManifest>;
  if (
    value.manifestVersion !== 1 ||
    typeof value.sourceDatabasePath !== 'string' ||
    typeof value.backupPath !== 'string' ||
    typeof value.byteLength !== 'number' ||
    typeof value.sha256 !== 'string' ||
    typeof value.sourceVersion !== 'number' ||
    typeof value.targetVersion !== 'number' ||
    typeof value.createdAt !== 'string' ||
    typeof value.toolVersion !== 'string' ||
    !value.counts
  ) {
    throw new Error('invalid migration backup manifest');
  }
  return value as MigrationBackupManifest;
}
