import type { DatabaseSync } from 'node:sqlite';
import { CanvasError } from '../errors.js';
import { DOCUMENT_SCHEMA_VERSION, PHYSICAL_SCHEMA_VERSION, V2_SCHEMA_SQL } from './v2-schema.js';

interface VersionMetadataRow {
  physical_version: number;
  document_version: number;
}

export type DatabaseVersionState =
  | { kind: 'empty' }
  | { kind: 'v1'; physicalVersion: number; documentVersion: 1 }
  | { kind: 'v2-theme-migration-required'; physicalVersion: 2; documentVersion: 2 }
  | { kind: 'v2'; physicalVersion: 3; documentVersion: 2 }
  | { kind: 'newer'; physicalVersion: number; documentVersion: number }
  | { kind: 'contradictory'; message: string };

function tableNames(db: DatabaseSync): Set<string> {
  const rows = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
    .all() as unknown as Array<{ name: string }>;
  return new Set(rows.map((row) => row.name));
}

function pragmaVersion(db: DatabaseSync): number {
  return Number((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version);
}

export function inspectDatabaseVersion(db: DatabaseSync): DatabaseVersionState {
  const tables = tableNames(db);
  const physicalVersion = pragmaVersion(db);
  if (tables.size === 0) {
    return physicalVersion === 0
      ? { kind: 'empty' }
      : { kind: 'contradictory', message: `empty database declares physical version ${physicalVersion}` };
  }

  const hasCanvases = tables.has('canvases');
  const hasMetadata = tables.has('agent_canvas_installation_metadata');
  if (!hasCanvases) return { kind: 'contradictory', message: 'database has tables but no canvases table' };
  if (!hasMetadata) {
    if (physicalVersion >= PHYSICAL_SCHEMA_VERSION) {
      return {
        kind: 'contradictory',
        message: `database declares physical version ${physicalVersion} without installation metadata`
      };
    }
    return { kind: 'v1', physicalVersion, documentVersion: 1 };
  }

  const metadata = db
    .prepare('SELECT physical_version, document_version FROM agent_canvas_installation_metadata WHERE id = 1')
    .get() as VersionMetadataRow | undefined;
  if (!metadata) return { kind: 'contradictory', message: 'installation metadata row is missing' };
  if (metadata.physical_version !== physicalVersion) {
    return {
      kind: 'contradictory',
      message: `PRAGMA user_version ${physicalVersion} disagrees with metadata ${metadata.physical_version}`
    };
  }
  if (physicalVersion > PHYSICAL_SCHEMA_VERSION || metadata.document_version > DOCUMENT_SCHEMA_VERSION) {
    return {
      kind: 'newer',
      physicalVersion,
      documentVersion: metadata.document_version
    };
  }
  if (physicalVersion === 2 && metadata.document_version === 2) {
    return { kind: 'v2-theme-migration-required', physicalVersion: 2, documentVersion: 2 };
  }
  if (physicalVersion === PHYSICAL_SCHEMA_VERSION && metadata.document_version === DOCUMENT_SCHEMA_VERSION) {
    return { kind: 'v2', physicalVersion: 3, documentVersion: 2 };
  }
  return {
    kind: 'contradictory',
    message: `unsupported version pair physical=${physicalVersion}, document=${metadata.document_version}`
  };
}

export function initializeEmptyV2Database(
  db: DatabaseSync,
  toolVersion: string,
  timestamp = new Date().toISOString()
): void {
  const state = inspectDatabaseVersion(db);
  if (state.kind !== 'empty') throw new Error(`cannot initialize non-empty database (${state.kind})`);
  db.exec('BEGIN IMMEDIATE;');
  try {
    db.exec(V2_SCHEMA_SQL);
    db.prepare(
      `INSERT INTO agent_canvas_installation_metadata
       (id, physical_version, document_version, migrated_at, tool_version) VALUES (1, 3, 2, ?, ?)`
    ).run(timestamp, toolVersion);
    db.exec(`PRAGMA user_version = ${PHYSICAL_SCHEMA_VERSION}; COMMIT;`);
  } catch (error) {
    db.exec('ROLLBACK;');
    throw error;
  }
}

export function requireV2Database(db: DatabaseSync): void {
  const state = inspectDatabaseVersion(db);
  if (state.kind === 'v2') return;
  if (state.kind === 'v1') {
    throw new CanvasError(
      'database_migration_required',
      'AgentCanvas v0.1 database detected; run: agentcanvas migrate apply --database <path>',
      'storage',
      503,
      false
    );
  }
  if (state.kind === 'v2-theme-migration-required') {
    throw new CanvasError(
      'database_migration_required',
      'AgentCanvas theme schema migration is required; run: agentcanvas migrate apply --database <path>',
      'storage',
      503,
      false
    );
  }
  if (state.kind === 'newer') {
    throw new CanvasError(
      'database_version_unsupported',
      `database version ${state.physicalVersion}/${state.documentVersion} is newer than AgentCanvas supports`,
      'storage',
      503,
      false
    );
  }
  const message = state.kind === 'contradictory' ? state.message : 'database was not initialized';
  throw new CanvasError('database_version_invalid', message, 'storage', 503, false);
}
