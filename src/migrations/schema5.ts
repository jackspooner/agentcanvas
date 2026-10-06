import { MACRO_VERSION_DELETE_TRIGGER_SQL } from '../store/v2-schema.js';
import { applyPreservingSchemaMigration } from './preserving-schema.js';

/** Permits version cleanup only after the owning macro definition has been removed. */
export function applyCanvasDeletionSchemaMigration(input: {
  databasePath: string;
  backupDir?: string;
  toolVersion: string;
  now?: Date;
}) {
  return applyPreservingSchemaMigration({
    ...input,
    sourcePhysicalVersion: 4,
    targetPhysicalVersion: 5,
    migrationId: 'agentcanvas:physical-4-to-5-canvas-deletion',
    schemaSql: 'DROP TRIGGER macro_versions_immutable_delete;\n' + MACRO_VERSION_DELETE_TRIGGER_SQL
  });
}
