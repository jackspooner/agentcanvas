import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { backup, DatabaseSync } from 'node:sqlite';
import type { CanvasElement, ElementSchemaMigration } from '@agentcanvas/plugin-sdk';
import { CanvasError } from '../errors.js';
import { PluginElementValidator, type FrozenPluginRegistry } from '../plugin-runtime/index.js';
import { PHYSICAL_SCHEMA_VERSION } from '../store/v2-schema.js';
import { inspectDatabaseVersion } from '../store/version.js';
import { createBackupManifest, verifyBackupManifest, writeBackupManifest } from './backup.js';
import type { MigrationCounts } from './types.js';

interface CanvasElementsRow {
  id: string;
  elements_json: string;
}

export interface PendingPluginSchemaMigration {
  canvasId: string;
  elementId: string;
  type: string;
  fromVersion: number;
  toVersion: number;
  steps: readonly ElementSchemaMigration[];
}

export interface PluginSchemaInspection {
  pending: readonly PendingPluginSchemaMigration[];
  blockers: readonly string[];
}

function chainFor(
  migrations: readonly ElementSchemaMigration[] | undefined,
  fromVersion: number,
  toVersion: number
): readonly ElementSchemaMigration[] | null {
  const byFrom = new Map<number, ElementSchemaMigration>();
  for (const migration of migrations ?? []) {
    if (migration.toVersion !== migration.fromVersion + 1 || byFrom.has(migration.fromVersion)) return null;
    byFrom.set(migration.fromVersion, migration);
  }
  const steps: ElementSchemaMigration[] = [];
  let version = fromVersion;
  while (version < toVersion) {
    const migration = byFrom.get(version);
    if (!migration || migration.toVersion > toVersion) return null;
    steps.push(migration);
    version = migration.toVersion;
  }
  return steps;
}

export function inspectPluginSchemaMigrations(
  db: DatabaseSync,
  registry: FrozenPluginRegistry
): PluginSchemaInspection {
  const state = inspectDatabaseVersion(db);
  if (state.kind !== 'v2' || state.physicalVersion !== PHYSICAL_SCHEMA_VERSION)
    return {
      pending: [],
      blockers: [
        `plugin schema inspection requires physical/document version ${PHYSICAL_SCHEMA_VERSION}/2, found ${state.kind}`
      ]
    };
  const pending: PendingPluginSchemaMigration[] = [];
  const blockers: string[] = [];
  const rows = db.prepare('SELECT id, elements_json FROM canvases ORDER BY id').all() as unknown as CanvasElementsRow[];
  for (const row of rows) {
    let elements: CanvasElement[];
    try {
      elements = JSON.parse(row.elements_json) as CanvasElement[];
    } catch {
      blockers.push(`canvas ${row.id} has malformed elements_json`);
      continue;
    }
    for (const element of elements) {
      const descriptor = registry.getElementType(element.type);
      if (!descriptor) continue;
      if (element.schemaVersion > descriptor.schemaVersion) {
        blockers.push(
          `${row.id}/${element.id} uses ${element.type}@${element.schemaVersion}, newer than installed ${descriptor.schemaVersion}`
        );
        continue;
      }
      if (element.schemaVersion === descriptor.schemaVersion) continue;
      const steps = chainFor(descriptor.schemaMigrations, element.schemaVersion, descriptor.schemaVersion);
      if (!steps) {
        blockers.push(
          `${row.id}/${element.id} has no contiguous migration chain for ${element.type}@${element.schemaVersion}->${descriptor.schemaVersion}`
        );
        continue;
      }
      pending.push({
        canvasId: row.id,
        elementId: element.id,
        type: element.type,
        fromVersion: element.schemaVersion,
        toVersion: descriptor.schemaVersion,
        steps
      });
    }
  }
  return { pending, blockers };
}

export function assertPluginSchemasReady(
  db: DatabaseSync,
  registry: FrozenPluginRegistry,
  databasePath: string,
  pluginsRoot: string
): void {
  const inspection = inspectPluginSchemaMigrations(db, registry);
  if (inspection.blockers.length) {
    throw new CanvasError('plugin_schema_version_unsupported', inspection.blockers.join('; '), 'storage', 503);
  }
  if (inspection.pending.length) {
    throw new CanvasError(
      'plugin_migration_required',
      `installed plugin schema migration is pending; run: agentcanvas migrate apply --database ${JSON.stringify(
        path.resolve(databasePath)
      )} --plugins ${JSON.stringify(path.resolve(pluginsRoot))}`,
      'storage',
      503
    );
  }
}

function count(db: DatabaseSync, table: string): number {
  return Number((db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count);
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

function backupPathFor(databasePath: string, backupDir: string | undefined, now: Date): string {
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  return path.join(
    path.resolve(backupDir ?? path.dirname(databasePath)),
    `${path.basename(databasePath)}.plugin-${stamp}.bak`
  );
}

export async function applyPluginSchemaMigrations(input: {
  databasePath: string;
  registry: FrozenPluginRegistry;
  backupDir?: string;
  toolVersion: string;
  now?: Date;
}): Promise<{
  ok: true;
  databasePath: string;
  backupPath: string;
  manifestPath: string;
  migratedElements: number;
}> {
  if (input.databasePath === ':memory:') throw new Error('plugin migration apply refuses in-memory databases');
  const databasePath = path.resolve(input.databasePath);
  if (!fs.existsSync(databasePath)) throw new Error(`database does not exist: ${databasePath}`);
  const now = input.now ?? new Date();
  const backupPath = backupPathFor(databasePath, input.backupDir, now);
  const manifestPath = `${backupPath}.manifest.json`;
  if (fs.existsSync(backupPath) || fs.existsSync(manifestPath))
    throw new Error(`backup target already exists: ${backupPath}`);
  const db = new DatabaseSync(databasePath);
  let transactionOpen = false;
  try {
    db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 1; BEGIN EXCLUSIVE; ROLLBACK;');
    const inspection = inspectPluginSchemaMigrations(db, input.registry);
    if (inspection.blockers.length) throw new Error(inspection.blockers.join('; '));
    const state = inspectDatabaseVersion(db);
    if (state.kind !== 'v2' || state.physicalVersion !== PHYSICAL_SCHEMA_VERSION)
      throw new Error(
        `plugin schema migration requires physical/document version ${PHYSICAL_SCHEMA_VERSION}/2, found ${state.kind}`
      );
    if (!inspection.pending.length) throw new Error('no installed-plugin schema migrations are pending');
    const before = counts(db);
    await backup(db, backupPath);
    const manifest = createBackupManifest({
      sourceDatabasePath: databasePath,
      backupPath,
      sourceVersion: 2,
      targetVersion: 2,
      sourcePhysicalVersion: state.physicalVersion,
      targetPhysicalVersion: state.physicalVersion,
      createdAt: now.toISOString(),
      counts: before,
      toolVersion: input.toolVersion
    });
    writeBackupManifest(manifestPath, manifest);
    const verified = verifyBackupManifest(manifest);
    if (!verified.ok) throw new Error(`plugin migration backup verification failed: ${verified.errors.join('; ')}`);

    const pendingByElement = new Map(inspection.pending.map((item) => [`${item.canvasId}\0${item.elementId}`, item]));
    const validator = new PluginElementValidator(input.registry);
    const rows = db
      .prepare('SELECT id, elements_json FROM canvases ORDER BY id')
      .all() as unknown as CanvasElementsRow[];
    const update = db.prepare('UPDATE canvases SET elements_json = ? WHERE id = ?');
    db.exec('BEGIN EXCLUSIVE;');
    transactionOpen = true;
    for (const row of rows) {
      const elements = JSON.parse(row.elements_json) as CanvasElement[];
      let changed = false;
      const migrated = elements.map((element) => {
        const pending = pendingByElement.get(`${row.id}\0${element.id}`);
        if (!pending) return element;
        let data = structuredClone(element.data);
        let style = element.style === undefined ? undefined : structuredClone(element.style);
        let schemaVersion = element.schemaVersion;
        for (const step of pending.steps) {
          const result = step.migrate(data, style ?? null);
          data = result.data;
          style = result.style;
          schemaVersion = step.toVersion;
          const pluginId = element.type.slice(0, element.type.lastIndexOf('/'));
          const migrationId = `${element.type}@${step.fromVersion}-${step.toVersion}`;
          const checksum = createHash('sha256')
            .update(`${pluginId}:${input.registry.getPlugin(pluginId)?.plugin.manifest.version}:${migrationId}`)
            .digest('hex');
          db.prepare(
            `INSERT OR IGNORE INTO plugin_migration_runs
             (plugin_id,migration_id,from_schema_version,to_schema_version,applied_at,checksum)
             VALUES (?,?,?,?,?,?)`
          ).run(pluginId, migrationId, step.fromVersion, step.toVersion, now.toISOString(), checksum);
        }
        changed = true;
        return validator.normalizeForWrite({
          ...element,
          schemaVersion,
          data,
          ...(style !== undefined ? { style } : {})
        });
      });
      if (changed) update.run(JSON.stringify(migrated), row.id);
    }
    const integrity = db.prepare('PRAGMA integrity_check').all() as unknown as Array<{ integrity_check: string }>;
    const foreignKeys = db.prepare('PRAGMA foreign_key_check').all();
    if (integrity.some((row) => row.integrity_check !== 'ok') || foreignKeys.length) {
      throw new Error('plugin migration target database failed integrity or foreign-key validation');
    }
    const after = counts(db);
    if (JSON.stringify(before) !== JSON.stringify(after))
      throw new Error('plugin migration changed preserved database counts');
    const afterInspection = inspectPluginSchemaMigrations(db, input.registry);
    if (afterInspection.pending.length || afterInspection.blockers.length) {
      throw new Error('plugin migration did not produce a ready installed schema set');
    }
    db.exec('COMMIT;');
    transactionOpen = false;
    return {
      ok: true,
      databasePath,
      backupPath,
      manifestPath,
      migratedElements: inspection.pending.length
    };
  } catch (error) {
    if (transactionOpen) db.exec('ROLLBACK;');
    throw error;
  } finally {
    db.close();
  }
}
