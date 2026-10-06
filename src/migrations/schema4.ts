import type { DatabaseSync } from 'node:sqlite';
import { MACRO_STORAGE_SCHEMA_SQL } from '../store/v2-schema.js';
import { applyPreservingSchemaMigration } from './preserving-schema.js';

export function createMacroStorageSchema(db: DatabaseSync): void {
  db.exec(MACRO_STORAGE_SCHEMA_SQL);
}

/** Applies the additive macro storage schema to a stopped physical-3/document-2 database. */
export function applyMacroStorageSchemaMigration(input: {
  databasePath: string;
  backupDir?: string;
  toolVersion: string;
  now?: Date;
}) {
  return applyPreservingSchemaMigration({
    ...input,
    sourcePhysicalVersion: 3,
    targetPhysicalVersion: 4,
    migrationId: 'agentcanvas:physical-3-to-4-macro-storage',
    schemaSql: MACRO_STORAGE_SCHEMA_SQL
  });
}
