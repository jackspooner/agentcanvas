import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { PHYSICAL_SCHEMA_VERSION, MACRO_VERSION_DELETE_TRIGGER_SQL } from '../store/v2-schema.js';
import { LEGACY_TYPE_DEFINITIONS, RUNTIME_ONLY_LEGACY_FIELDS } from './legacy';
import type { CanonicalElement, MigrationCounts, MigrationVerificationSummary, TypeMappingCount } from './types';

const CANONICAL_ELEMENT_FIELDS = new Set([
  'id',
  'type',
  'schemaVersion',
  'x',
  'y',
  'width',
  'height',
  'zIndex',
  'rotation',
  'opacity',
  'locked',
  'style',
  'metadata',
  'data'
]);
const STYLE_LAYOUT_FIELDS = new Set(['x', 'y', 'width', 'height', 'zIndex', 'rotation', 'opacity', 'locked']);

export interface CanonicalElementValidationContext {
  canvasId: string;
  elementId: string;
}

export type CanonicalElementValidator = (element: CanonicalElement, context: CanonicalElementValidationContext) => void;

export interface MigrationVerificationExpectations {
  sourceVersion?: number;
  sourcePhysicalVersion?: number;
  countsBefore: MigrationCounts;
  mappedElementCounts: TypeMappingCount[];
  strippedRuntimeFieldCount: number;
  invalidatedIdempotencyRows: number;
}

export interface MigrationVerificationReport {
  ok: boolean;
  databasePath?: string;
  errors: string[];
  summary: MigrationVerificationSummary;
}

function hasTable(db: DatabaseSync, table: string): boolean {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table));
}

function tableColumns(db: DatabaseSync, table: string): string[] {
  if (!hasTable(db, table)) return [];
  return (db.prepare(`PRAGMA table_info(${table})`).all() as unknown as Array<{ name: string }>).map((row) => row.name);
}

function tableCount(db: DatabaseSync, table: string): number {
  if (!hasTable(db, table)) return 0;
  return Number((db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number | bigint }).count);
}

function countElements(
  db: DatabaseSync,
  errors: string[],
  validateElement?: CanonicalElementValidator
): Map<string, number> {
  const typeCounts = new Map<string, number>();
  if (!hasTable(db, 'canvases') || !tableColumns(db, 'canvases').includes('elements_json')) return typeCounts;
  const rows = db.prepare('SELECT id, elements_json FROM canvases ORDER BY id').all() as unknown as Array<{
    id: string;
    elements_json: string;
  }>;
  for (const row of rows) {
    let elements: unknown;
    try {
      elements = JSON.parse(row.elements_json);
    } catch {
      errors.push(`canvas ${row.id} has malformed elements_json`);
      continue;
    }
    if (!Array.isArray(elements)) {
      errors.push(`canvas ${row.id} elements_json is not an array`);
      continue;
    }
    const seen = new Set<string>();
    for (const value of elements) {
      try {
        assertCanonicalElement(value);
        if (seen.has(value.id)) throw new Error(`duplicate element id ${value.id}`);
        seen.add(value.id);
        validateElement?.(value, { canvasId: row.id, elementId: value.id });
        typeCounts.set(value.type, (typeCounts.get(value.type) ?? 0) + 1);
      } catch (error) {
        errors.push(`canvas ${row.id}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
  return typeCounts;
}

function assertJsonValue(value: unknown, field: string, seen = new Set<object>()): void {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`${field} contains a non-finite number`);
    if (Number.isInteger(value) && !Number.isSafeInteger(value)) throw new Error(`${field} contains an unsafe integer`);
    return;
  }
  if (typeof value !== 'object') throw new Error(`${field} contains a non-JSON value`);
  if (seen.has(value)) throw new Error(`${field} contains a cycle`);
  if (Object.getOwnPropertySymbols(value).length > 0) throw new Error(`${field} contains symbol properties`);
  seen.add(value);
  if (Array.isArray(value)) {
    if (Object.keys(value).length !== value.length)
      throw new Error(`${field} contains array holes or extra properties`);
    for (let index = 0; index < value.length; index += 1) assertJsonValue(value[index], `${field}[${index}]`, seen);
  } else {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) throw new Error(`${field} is not a plain JSON object`);
    for (const key of Object.getOwnPropertyNames(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor?.enumerable || !('value' in descriptor)) {
        throw new Error(`${field}.${key} is not an enumerable JSON data property`);
      }
      if (RUNTIME_ONLY_LEGACY_FIELDS.has(key)) throw new Error(`${field} contains runtime-only field ${key}`);
      assertJsonValue(descriptor.value, `${field}.${key}`, seen);
    }
  }
  seen.delete(value);
}

function optionalFinite(value: unknown, field: string): void {
  if (value !== undefined && value !== null && (typeof value !== 'number' || !Number.isFinite(value))) {
    throw new Error(`${field} must be a finite number or null`);
  }
}

/** Validates the stable v0.2 envelope independently of any plugin-owned data/style schema. */
export function assertCanonicalElement(value: unknown): asserts value is CanonicalElement {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('element must be a JSON object');
  const element = value as Record<string, unknown>;
  for (const field of Object.keys(element)) {
    if (!CANONICAL_ELEMENT_FIELDS.has(field)) throw new Error(`element has unknown top-level field ${field}`);
  }
  if (typeof element.id !== 'string' || !element.id) throw new Error('element id is required');
  if (typeof element.type !== 'string' || !/^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*\/[a-z][a-z0-9-]*$/.test(element.type)) {
    throw new Error(`element ${element.id} has invalid canonical type`);
  }
  if (!Number.isInteger(element.schemaVersion) || (element.schemaVersion as number) < 1) {
    throw new Error(`element ${element.id} has invalid schemaVersion`);
  }
  for (const field of ['x', 'y'] as const) {
    if (typeof element[field] !== 'number' || !Number.isFinite(element[field])) {
      throw new Error(`element ${element.id} ${field} must be a finite number`);
    }
  }
  for (const field of ['width', 'height', 'zIndex', 'rotation', 'opacity'] as const) {
    optionalFinite(element[field], `element ${element.id} ${field}`);
  }
  if (element.locked !== undefined && element.locked !== null && typeof element.locked !== 'boolean') {
    throw new Error(`element ${element.id} locked must be boolean or null`);
  }
  if (!element.data || typeof element.data !== 'object' || Array.isArray(element.data)) {
    throw new Error(`element ${element.id} data must be a JSON object`);
  }
  for (const field of ['style', 'metadata'] as const) {
    const fieldValue = element[field];
    if (
      fieldValue !== undefined &&
      fieldValue !== null &&
      (typeof fieldValue !== 'object' || Array.isArray(fieldValue))
    ) {
      throw new Error(`element ${element.id} ${field} must be a JSON object${field === 'style' ? ' or null' : ''}`);
    }
  }
  if (element.style && typeof element.style === 'object') {
    for (const field of Object.keys(element.style)) {
      if (STYLE_LAYOUT_FIELDS.has(field)) throw new Error(`element ${element.id} style overrides host field ${field}`);
    }
  }
  assertJsonValue(element, `element ${element.id}`);
}

function mappedCountsFromCanonical(typeCounts: Map<string, number>): TypeMappingCount[] {
  return Object.values(LEGACY_TYPE_DEFINITIONS)
    .filter((definition) => definition.targetType !== null)
    .map((definition) => ({
      legacyType: definition.legacyType,
      targetType: definition.targetType,
      count: typeCounts.get(definition.targetType as string) ?? 0
    }))
    .filter((entry) => entry.count > 0)
    .sort((a, b) => a.legacyType.localeCompare(b.legacyType));
}

function sameCounts(
  actual: MigrationCounts,
  expected: MigrationCounts,
  invalidatedIdempotencyRows: number,
  errors: string[]
): void {
  for (const field of ['canvases', 'elements', 'shareLinks', 'events'] as const) {
    if (actual[field] !== expected[field])
      errors.push(`${field} count changed: expected ${expected[field]}, found ${actual[field]}`);
  }
  const expectedIdempotencyRows = expected.idempotencyRows - invalidatedIdempotencyRows;
  if (actual.idempotencyRows !== expectedIdempotencyRows) {
    errors.push(`idempotency row count changed: expected ${expectedIdempotencyRows}, found ${actual.idempotencyRows}`);
  }
}

function checkSchema(db: DatabaseSync, errors: string[]): void {
  const requiredTables = [
    'canvases',
    'canvas_events',
    'canvas_share_links',
    'canvas_idempotency_keys',
    'agent_canvas_installation_metadata',
    'agent_canvas_migration_runs',
    'plugin_migration_runs',
    'plugin_kv',
    'macro_definitions',
    'macro_versions',
    'macro_invocations'
  ];
  for (const table of requiredTables) if (!hasTable(db, table)) errors.push(`required v0.2 table is missing: ${table}`);
  if (!tableColumns(db, 'canvases').includes('document_version')) errors.push('canvases.document_version is missing');
  if (!tableColumns(db, 'canvases').includes('theme_json')) errors.push('canvases.theme_json is missing');
  if (!tableColumns(db, 'canvas_events').includes('document_version'))
    errors.push('canvas_events.document_version is missing');
  if (!tableColumns(db, 'canvas_idempotency_keys').includes('document_version')) {
    errors.push('canvas_idempotency_keys.document_version is missing');
  }
}

function ledgerExpectations(db: DatabaseSync): { expectations?: MigrationVerificationExpectations; error?: string } {
  if (!hasTable(db, 'agent_canvas_migration_runs')) return {};
  const row = db
    .prepare('SELECT summary_json FROM agent_canvas_migration_runs ORDER BY completed_at DESC, id DESC LIMIT 1')
    .get() as { summary_json: string } | undefined;
  if (!row) return {};
  try {
    const summary = JSON.parse(row.summary_json) as Partial<MigrationVerificationSummary>;
    if (
      !summary.countsBefore ||
      !Array.isArray(summary.mappedElementCounts) ||
      typeof summary.strippedRuntimeFieldCount !== 'number' ||
      typeof summary.invalidatedIdempotencyRows !== 'number'
    ) {
      return { error: 'latest migration ledger summary is incomplete' };
    }
    return {
      expectations: {
        ...(typeof summary.sourceVersion === 'number' ? { sourceVersion: summary.sourceVersion } : {}),
        ...(typeof summary.sourcePhysicalVersion === 'number'
          ? { sourcePhysicalVersion: summary.sourcePhysicalVersion }
          : {}),
        countsBefore: summary.countsBefore,
        mappedElementCounts: summary.mappedElementCounts,
        strippedRuntimeFieldCount: summary.strippedRuntimeFieldCount,
        invalidatedIdempotencyRows: summary.invalidatedIdempotencyRows
      }
    };
  } catch {
    return { error: 'latest migration ledger summary is malformed JSON' };
  }
}

/** Verifies an already-open database. The caller may use this before COMMIT so failed checks remain rollbackable. */
export function verifyMigrationConnection(
  db: DatabaseSync,
  options: {
    expectations?: MigrationVerificationExpectations;
    validateElement?: CanonicalElementValidator;
    targetPhysicalVersion?: number;
  } = {}
): MigrationVerificationReport {
  const errors: string[] = [];
  checkSchema(db, errors);
  const targetPhysicalVersion = options.targetPhysicalVersion ?? PHYSICAL_SCHEMA_VERSION;
  if (targetPhysicalVersion === 5) {
    const trigger = db
      .prepare("SELECT sql FROM sqlite_master WHERE type='trigger' AND name='macro_versions_immutable_delete'")
      .get() as { sql: string } | undefined;
    const normalizedSql = (sql: string) =>
      sql
        .replace(/IF NOT EXISTS\s+/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/;$/, '');
    if (!trigger || normalizedSql(trigger.sql) !== normalizedSql(MACRO_VERSION_DELETE_TRIGGER_SQL))
      errors.push('macro version deletion guard is missing or outdated');
  }
  const physicalVersion = Number((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version);
  if (physicalVersion !== targetPhysicalVersion) {
    errors.push(`physical database version must be ${targetPhysicalVersion}, found ${physicalVersion}`);
  }

  const integrity = (db.prepare('PRAGMA integrity_check').all() as unknown as Array<Record<string, string>>).map(
    (row) => Object.values(row)[0] ?? 'unknown'
  );
  const foreignKeyViolations = (db.prepare('PRAGMA foreign_key_check').all() as unknown[]).length;
  const integrityOk = integrity.every((value) => value === 'ok');
  const foreignKeysOk = foreignKeyViolations === 0;
  if (!integrityOk) errors.push(`SQLite integrity check failed: ${integrity.join('; ')}`);
  if (!foreignKeysOk) errors.push(`SQLite foreign-key check found ${foreignKeyViolations} violation(s)`);

  if (tableColumns(db, 'canvases').includes('document_version')) {
    const invalid = Number(
      (
        db.prepare('SELECT COUNT(*) AS count FROM canvases WHERE document_version <> 2').get() as {
          count: number | bigint;
        }
      ).count
    );
    if (invalid > 0) errors.push(`${invalid} canvas(es) do not use document version 2`);
  }
  if (tableColumns(db, 'canvases').includes('created_by')) {
    const invalid = Number(
      (
        db
          .prepare("SELECT COUNT(*) AS count FROM canvases WHERE created_by NOT IN ('agent', 'user', 'system')")
          .get() as { count: number | bigint }
      ).count
    );
    if (invalid > 0) errors.push(`${invalid} canvas(es) use a noncanonical created_by value`);
  }
  if (tableColumns(db, 'canvas_events').includes('document_version')) {
    const invalid = Number(
      (
        db.prepare('SELECT COUNT(*) AS count FROM canvas_events WHERE document_version NOT IN (1, 2)').get() as {
          count: number | bigint;
        }
      ).count
    );
    if (invalid > 0) errors.push(`${invalid} event(s) use an unsupported document version`);
  }

  const typeCounts = countElements(db, errors, options.validateElement);
  const elementCount = [...typeCounts.values()].reduce((sum, count) => sum + count, 0);
  const countsAfter: MigrationCounts = {
    canvases: tableCount(db, 'canvases'),
    elements: elementCount,
    shareLinks: tableCount(db, 'canvas_share_links'),
    events: tableCount(db, 'canvas_events'),
    idempotencyRows: tableCount(db, 'canvas_idempotency_keys')
  };
  const expectations = options.expectations;
  if (expectations) {
    sameCounts(countsAfter, expectations.countsBefore, expectations.invalidatedIdempotencyRows, errors);
    for (const mapping of expectations.mappedElementCounts) {
      const actual = mapping.targetType ? (typeCounts.get(mapping.targetType) ?? 0) : 0;
      if (actual !== mapping.count) {
        errors.push(`mapped count for ${mapping.legacyType} must be ${mapping.count}, found ${actual}`);
      }
    }
  }

  if (hasTable(db, 'agent_canvas_installation_metadata')) {
    const row = db
      .prepare('SELECT physical_version, document_version FROM agent_canvas_installation_metadata WHERE id = 1')
      .get() as { physical_version: number; document_version: number } | undefined;
    if (!row || row.physical_version !== targetPhysicalVersion || row.document_version !== 2) {
      errors.push(`installation metadata does not declare physical/document version ${targetPhysicalVersion}/2`);
    }
  }
  if (hasTable(db, 'agent_canvas_migration_runs') && tableCount(db, 'agent_canvas_migration_runs') < 1) {
    errors.push('agent migration ledger has no completed migration run');
  }

  return {
    ok: errors.length === 0,
    errors,
    summary: {
      sourceVersion: expectations?.sourceVersion ?? 1,
      targetVersion: 2,
      sourcePhysicalVersion: expectations?.sourcePhysicalVersion,
      targetPhysicalVersion,
      countsBefore: expectations?.countsBefore ?? countsAfter,
      countsAfter,
      mappedElementCounts: expectations?.mappedElementCounts ?? mappedCountsFromCanonical(typeCounts),
      strippedRuntimeFieldCount: expectations?.strippedRuntimeFieldCount ?? 0,
      invalidatedIdempotencyRows: expectations?.invalidatedIdempotencyRows ?? 0,
      preservedEventCount: countsAfter.events,
      preservedShareLinkCount: countsAfter.shareLinks,
      integrityOk,
      foreignKeysOk
    }
  };
}

/** Opens an exact v0.2 database read-only and verifies schema, canonical documents, ledgers, and SQLite integrity. */
export function verifyMigrationDatabase(input: {
  databasePath: string;
  targetPhysicalVersion?: number;
  expectations?: MigrationVerificationExpectations;
  validateElement?: CanonicalElementValidator;
}): MigrationVerificationReport {
  const databasePath = path.resolve(input.databasePath);
  if (!fs.existsSync(databasePath)) throw new Error(`database does not exist: ${databasePath}`);
  const db = new DatabaseSync(databasePath, { readOnly: true });
  try {
    const ledger = input.expectations ? {} : ledgerExpectations(db);
    const report = verifyMigrationConnection(db, {
      targetPhysicalVersion: input.targetPhysicalVersion,
      ...(input.expectations
        ? { expectations: input.expectations }
        : ledger.expectations
          ? { expectations: ledger.expectations }
          : {}),
      ...(input.validateElement ? { validateElement: input.validateElement } : {})
    });
    if (ledger.error) {
      report.ok = false;
      report.errors.push(ledger.error);
    }
    return {
      ...report,
      databasePath
    };
  } finally {
    db.close();
  }
}
