import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { backup, DatabaseSync } from 'node:sqlite';
import {
  createBackupManifest,
  verifyBackupManifest,
  writeBackupManifest,
  type MigrationBackupManifest
} from './backup';
import { inspectMigrationDatabase, intendedMigrationBackupPath } from './inspect';
import { MACRO_STORAGE_SCHEMA_SQL } from '../store/v2-schema.js';
import { canonicalizeLegacyElement } from './legacy';
import type { CanonicalElement, JsonObject, LegacyElementImporter, MigrationCounts } from './types';
import {
  assertCanonicalElement,
  verifyMigrationConnection,
  verifyMigrationDatabase,
  type CanonicalElementValidator,
  type MigrationVerificationExpectations,
  type MigrationVerificationReport
} from './verify';

const MIGRATION_ID = 'agentcanvas-v0.1-to-v0.2';

export interface ApplyMigrationInput {
  databasePath: string;
  backupDir?: string;
  importers: Iterable<LegacyElementImporter>;
  validateElement: CanonicalElementValidator;
  toolVersion: string;
  now?: Date;
}

export interface ApplyMigrationResult {
  ok: true;
  databasePath: string;
  backupPath: string;
  manifestPath: string;
  backupPages: number;
  migrationRunId: string;
  verification: MigrationVerificationReport;
}

interface CanvasElementsRow {
  id: string;
  elements_json: string;
}

function hasTable(db: DatabaseSync, table: string): boolean {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table));
}

function tableColumns(db: DatabaseSync, table: string): string[] {
  if (!hasTable(db, table)) return [];
  return (db.prepare(`PRAGMA table_info(${table})`).all() as unknown as Array<{ name: string }>).map((row) => row.name);
}

function addColumnIfMissing(db: DatabaseSync, table: string, column: string, declaration: string): void {
  if (!tableColumns(db, table).includes(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${declaration}`);
}

function importerMap(importers: Iterable<LegacyElementImporter>): Map<string, LegacyElementImporter> {
  const result = new Map<string, LegacyElementImporter>();
  for (const importer of importers) {
    if (result.has(importer.legacyType)) throw new Error(`duplicate legacy importer for ${importer.legacyType}`);
    result.set(importer.legacyType, importer);
  }
  return result;
}

function cloneAndFreeze<T>(value: T): T {
  const cloned = structuredClone(value);
  const freeze = (entry: unknown): void => {
    if (!entry || typeof entry !== 'object' || Object.isFrozen(entry)) return;
    for (const child of Object.values(entry)) freeze(child);
    Object.freeze(entry);
  };
  freeze(cloned);
  return cloned;
}

function canonicalizeDeterministically(
  legacy: unknown,
  importer: LegacyElementImporter,
  canvasId: string,
  validateElement: CanonicalElementValidator
): CanonicalElement {
  const context = {
    canvasId,
    elementId:
      legacy &&
      typeof legacy === 'object' &&
      !Array.isArray(legacy) &&
      typeof (legacy as { id?: unknown }).id === 'string'
        ? (legacy as { id: string }).id
        : '<missing>'
  };
  const first = canonicalizeLegacyElement(cloneAndFreeze(legacy), importer, context);
  const second = canonicalizeLegacyElement(cloneAndFreeze(legacy), importer, context);
  if (JSON.stringify(first) !== JSON.stringify(second)) {
    throw new Error(`legacy importer for ${importer.legacyType} is not deterministic`);
  }
  assertCanonicalElement(first);
  validateElement(first, { canvasId, elementId: first.id });
  return first;
}

function transformCanvases(
  db: DatabaseSync,
  importers: Map<string, LegacyElementImporter>,
  validateElement: CanonicalElementValidator
): Array<{ id: string; elementsJson: string }> {
  const rows = db.prepare('SELECT id, elements_json FROM canvases ORDER BY id').all() as unknown as CanvasElementsRow[];
  return rows.map((row) => {
    let elements: unknown;
    try {
      elements = JSON.parse(row.elements_json);
    } catch {
      throw new Error(`canvas ${row.id} has malformed elements_json`);
    }
    if (!Array.isArray(elements)) throw new Error(`canvas ${row.id} elements_json must contain an array`);
    const seenIds = new Set<string>();
    const canonical = elements.map((legacy) => {
      if (!legacy || typeof legacy !== 'object' || Array.isArray(legacy)) {
        throw new Error(`canvas ${row.id} contains a non-object legacy element`);
      }
      const legacyRecord = legacy as Record<string, unknown>;
      const legacyType = typeof legacyRecord.type === 'string' ? legacyRecord.type : '';
      const importer = importers.get(legacyType);
      if (!importer) throw new Error(`missing importer for legacy type ${legacyType || '<missing>'}`);
      const element = canonicalizeDeterministically(legacy, importer, row.id, validateElement);
      if (seenIds.has(element.id)) throw new Error(`canvas ${row.id} has duplicate element id ${element.id}`);
      seenIds.add(element.id);
      return element;
    });
    return { id: row.id, elementsJson: JSON.stringify(canonical) };
  });
}

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function stableRows(db: DatabaseSync, table: string, excludedColumns: string[] = []): unknown[] {
  if (!hasTable(db, table)) return [];
  const columns = tableColumns(db, table).filter((column) => !excludedColumns.includes(column));
  if (columns.length === 0) return [];
  const orderColumn = columns.includes('id') ? 'id' : columns.includes('key') ? 'key' : columns[0];
  return db
    .prepare(
      `SELECT ${columns.map(quoteIdentifier).join(', ')} FROM ${quoteIdentifier(table)} ORDER BY ${quoteIdentifier(orderColumn)}`
    )
    .all();
}

function hashRows(rows: unknown[]): string {
  return createHash('sha256')
    .update(JSON.stringify(rows, (_key, value) => (typeof value === 'bigint' ? value.toString() : value)))
    .digest('hex');
}

function preservationFingerprints(db: DatabaseSync): Record<string, string> {
  return {
    canvases: hashRows(stableRows(db, 'canvases', ['elements_json', 'document_version', 'theme_json'])),
    events: hashRows(stableRows(db, 'canvas_events', ['document_version'])),
    shares: hashRows(stableRows(db, 'canvas_share_links')),
    viewports: hashRows(stableRows(db, 'canvas_viewports')),
    configuration: hashRows(stableRows(db, 'agent_canvas_configuration'))
  };
}

function assertPreserved(before: Record<string, string>, after: Record<string, string>): void {
  for (const [surface, fingerprint] of Object.entries(before)) {
    if (after[surface] !== fingerprint) throw new Error(`${surface} changed outside the v0.2 representation migration`);
  }
}

function createV2Schema(db: DatabaseSync): void {
  addColumnIfMissing(db, 'canvases', 'document_version', 'INTEGER NOT NULL DEFAULT 2');
  addColumnIfMissing(db, 'canvases', 'theme_json', 'TEXT');
  addColumnIfMissing(db, 'canvas_events', 'document_version', 'INTEGER NOT NULL DEFAULT 2');
  db.exec(`
    CREATE TABLE agent_canvas_installation_metadata (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      physical_version INTEGER NOT NULL,
      document_version INTEGER NOT NULL,
      migrated_at TEXT NOT NULL,
      tool_version TEXT NOT NULL
    );

    CREATE TABLE agent_canvas_migration_runs (
      id TEXT PRIMARY KEY,
      migration_id TEXT NOT NULL UNIQUE,
      source_physical_version INTEGER NOT NULL,
      target_physical_version INTEGER NOT NULL,
      source_document_version INTEGER NOT NULL,
      target_document_version INTEGER NOT NULL,
      started_at TEXT NOT NULL,
      completed_at TEXT NOT NULL,
      backup_path TEXT NOT NULL,
      backup_sha256 TEXT NOT NULL,
      summary_json TEXT NOT NULL
    );

    CREATE TABLE plugin_migration_runs (
      plugin_id TEXT NOT NULL,
      migration_id TEXT NOT NULL,
      from_schema_version INTEGER NOT NULL,
      to_schema_version INTEGER NOT NULL,
      applied_at TEXT NOT NULL,
      checksum TEXT NOT NULL,
      PRIMARY KEY (plugin_id, migration_id)
    );

    CREATE TABLE plugin_kv (
      plugin_id TEXT NOT NULL,
      key TEXT NOT NULL,
      value_json TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (plugin_id, key)
    );
  `);
}

function replaceIdempotencyTable(db: DatabaseSync): void {
  db.exec(`
    DELETE FROM canvas_idempotency_keys;
    DROP TABLE canvas_idempotency_keys;
    CREATE TABLE canvas_idempotency_keys (
      canvas_id TEXT NOT NULL,
      document_version INTEGER NOT NULL DEFAULT 2,
      key TEXT NOT NULL,
      request_hash TEXT NOT NULL,
      response_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (canvas_id, document_version, key),
      FOREIGN KEY (canvas_id) REFERENCES canvases(id)
    );
  `);
}

function backupPathFor(databasePath: string, backupDir: string | undefined, now: Date): string {
  const intended = intendedMigrationBackupPath(databasePath, now);
  if (!backupDir) return intended;
  const directory = path.resolve(backupDir);
  fs.mkdirSync(directory, { recursive: true });
  return path.join(directory, path.basename(intended));
}

function writeFailureReport(input: {
  databasePath: string;
  backupPath: string;
  manifestPath: string;
  error: unknown;
  createdAt: string;
}): string | null {
  if (!fs.existsSync(input.backupPath)) return null;
  const reportPath = `${input.backupPath}.failure.json`;
  const body = {
    migrationId: MIGRATION_ID,
    databasePath: input.databasePath,
    backupPath: input.backupPath,
    manifestPath: fs.existsSync(input.manifestPath) ? input.manifestPath : null,
    failedAt: input.createdAt,
    error: input.error instanceof Error ? input.error.message : String(input.error)
  };
  try {
    fs.writeFileSync(reportPath, `${JSON.stringify(body, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
    return reportPath;
  } catch (error) {
    throw new AggregateError(
      [input.error, error],
      `migration failed and failure report could not be written: ${reportPath}`
    );
  }
}

function dataVersion(db: DatabaseSync): number {
  return Number((db.prepare('PRAGMA data_version').get() as { data_version: number }).data_version);
}

function assertBackupMatchesSource(manifest: MigrationBackupManifest): void {
  const manifestCheck = verifyBackupManifest(manifest);
  if (!manifestCheck.ok) throw new Error(`backup verification failed: ${manifestCheck.errors.join('; ')}`);
  const inspection = inspectMigrationDatabase(manifest.backupPath);
  if (!inspection.canApply) {
    throw new Error(
      `backup is not a valid v0.1 migration source: ${inspection.issues.map((issue) => issue.message).join('; ')}`
    );
  }
  for (const field of ['canvases', 'elements', 'shareLinks', 'events', 'idempotencyRows'] as const) {
    if (inspection.counts[field] !== manifest.counts[field]) {
      throw new Error(
        `backup ${field} count mismatch: expected ${manifest.counts[field]}, found ${inspection.counts[field]}`
      );
    }
  }
}

/**
 * Applies the representation and physical-schema migration while AgentCanvas is stopped.
 * A native SQLite backup and verified sidecar manifest are retained whether the transaction succeeds or fails.
 */
export async function applyMigration(input: ApplyMigrationInput): Promise<ApplyMigrationResult> {
  if (input.databasePath === ':memory:') throw new Error('migration apply refuses in-memory databases');
  if (!input.toolVersion) throw new Error('migration toolVersion is required');
  const databasePath = path.resolve(input.databasePath);
  if (!fs.existsSync(databasePath)) throw new Error(`database does not exist: ${databasePath}`);
  const now = input.now ?? new Date();
  const createdAt = now.toISOString();
  const backupPath = backupPathFor(databasePath, input.backupDir, now);
  const manifestPath = `${backupPath}.manifest.json`;
  if (fs.existsSync(backupPath) || fs.existsSync(manifestPath)) {
    throw new Error(`migration backup target already exists: ${backupPath}`);
  }

  const preflight = inspectMigrationDatabase(databasePath, { intendedBackupPath: backupPath, now });
  if (!preflight.canApply) {
    throw new Error(`migration preflight failed: ${preflight.issues.map((issue) => issue.message).join('; ')}`);
  }

  const importers = importerMap(input.importers);
  const db = new DatabaseSync(databasePath);
  let transactionOpen = false;
  let databaseClosed = false;
  try {
    db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 1;');
    db.exec('BEGIN EXCLUSIVE; ROLLBACK;');
    const beforeBackupDataVersion = dataVersion(db);
    const backupPages = await backup(db, backupPath);
    const backupInspection = inspectMigrationDatabase(backupPath);
    const manifest = createBackupManifest({
      sourceDatabasePath: databasePath,
      backupPath,
      sourceVersion: 1,
      targetVersion: 2,
      createdAt,
      counts: backupInspection.counts,
      toolVersion: input.toolVersion
    });
    writeBackupManifest(manifestPath, manifest);
    assertBackupMatchesSource(manifest);

    db.exec('BEGIN EXCLUSIVE;');
    transactionOpen = true;
    if (dataVersion(db) !== beforeBackupDataVersion) {
      throw new Error(
        'database changed while the migration backup was being created; keep AgentCanvas stopped and retry'
      );
    }

    const before = preservationFingerprints(db);
    const transformed = transformCanvases(db, importers, input.validateElement);
    const expectations: MigrationVerificationExpectations = {
      countsBefore: backupInspection.counts,
      mappedElementCounts: backupInspection.typeMappings,
      strippedRuntimeFieldCount: backupInspection.runtimeFieldsToStrip.length,
      invalidatedIdempotencyRows: backupInspection.counts.idempotencyRows
    };
    const migrationRunId = `migration_${createHash('sha256').update(`${MIGRATION_ID}:${createdAt}`).digest('hex').slice(0, 20)}`;

    createV2Schema(db);
    db.exec(MACRO_STORAGE_SCHEMA_SQL);
    const updateCanvas = db.prepare('UPDATE canvases SET elements_json = ?, document_version = 2 WHERE id = ?');
    for (const canvas of transformed) updateCanvas.run(canvas.elementsJson, canvas.id);
    db.exec('UPDATE canvas_events SET document_version = 1;');
    replaceIdempotencyTable(db);
    db.prepare(
      `INSERT INTO agent_canvas_installation_metadata
       (id, physical_version, document_version, migrated_at, tool_version) VALUES (1, 4, 2, ?, ?)`
    ).run(createdAt, input.toolVersion);
    db.exec('PRAGMA user_version = 4;');

    const provisionalSummary = {
      sourceVersion: 1,
      targetVersion: 2,
      sourcePhysicalVersion: preflight.versions.physicalVersion,
      targetPhysicalVersion: 4,
      countsBefore: expectations.countsBefore,
      countsAfter: { ...expectations.countsBefore, idempotencyRows: 0 } as MigrationCounts,
      mappedElementCounts: expectations.mappedElementCounts,
      strippedRuntimeFieldCount: expectations.strippedRuntimeFieldCount,
      invalidatedIdempotencyRows: expectations.invalidatedIdempotencyRows,
      preservedEventCount: expectations.countsBefore.events,
      preservedShareLinkCount: expectations.countsBefore.shareLinks,
      integrityOk: true,
      foreignKeysOk: true
    };
    db.prepare(
      `INSERT INTO agent_canvas_migration_runs
       (id, migration_id, source_physical_version, target_physical_version, source_document_version,
        target_document_version, started_at, completed_at, backup_path, backup_sha256, summary_json)
       VALUES (?, ?, ?, 4, 1, 2, ?, ?, ?, ?, ?)`
    ).run(
      migrationRunId,
      MIGRATION_ID,
      preflight.versions.physicalVersion,
      createdAt,
      createdAt,
      backupPath,
      manifest.sha256,
      JSON.stringify(provisionalSummary)
    );

    assertPreserved(before, preservationFingerprints(db));
    const transactionalVerification = verifyMigrationConnection(db, {
      targetPhysicalVersion: 4,
      expectations,
      validateElement: input.validateElement
    });
    if (!transactionalVerification.ok) {
      throw new Error(`target verification failed: ${transactionalVerification.errors.join('; ')}`);
    }
    db.prepare('UPDATE agent_canvas_migration_runs SET summary_json = ? WHERE id = ?').run(
      JSON.stringify(transactionalVerification.summary),
      migrationRunId
    );
    db.exec('COMMIT;');
    transactionOpen = false;
    db.close();
    databaseClosed = true;

    const verification = verifyMigrationDatabase({
      targetPhysicalVersion: 4,
      databasePath,
      expectations,
      validateElement: input.validateElement
    });
    if (!verification.ok) throw new Error(`committed migration verification failed: ${verification.errors.join('; ')}`);
    return { ok: true, databasePath, backupPath, manifestPath, backupPages, migrationRunId, verification };
  } catch (error) {
    if (transactionOpen) {
      try {
        db.exec('ROLLBACK;');
      } catch (rollbackError) {
        error = new AggregateError([error, rollbackError], 'migration failed and its transaction rollback also failed');
      }
    }
    if (!databaseClosed) {
      try {
        db.close();
      } catch (closeError) {
        error = new AggregateError(
          [error, closeError],
          'migration failed and the database could not be closed cleanly'
        );
      }
    }
    writeFailureReport({ databasePath, backupPath, manifestPath, error, createdAt: new Date().toISOString() });
    throw error;
  }
}
