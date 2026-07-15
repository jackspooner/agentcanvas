import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { inspectDatabaseVersion } from '../store/version';
import { analyzeLegacyElement } from './legacy';
import type {
  DatabaseVersionState,
  GroupBlocker,
  MigrationInspectionReport,
  MigrationIssue,
  RuntimeFieldOccurrence,
  TypeMappingCount
} from './types';

interface CanvasElementsRow {
  id: string;
  elements_json: string;
}

export interface InspectMigrationOptions {
  now?: Date;
  intendedBackupPath?: string;
  validateLegacyElement?: (element: unknown) => void;
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

function versionState(db: DatabaseSync): DatabaseVersionState {
  const physicalVersion = Number((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version);
  const columns = tableColumns(db, 'canvases');
  if (!columns.includes('document_version')) {
    return {
      physicalVersion,
      documentVersions: hasTable(db, 'canvases') ? [1] : [],
      inferredLegacyDocumentVersion: true
    };
  }
  const rows = db
    .prepare('SELECT DISTINCT document_version FROM canvases ORDER BY document_version')
    .all() as unknown as Array<{
    document_version: number | null;
  }>;
  return {
    physicalVersion,
    documentVersions: rows
      .map((row) => row.document_version)
      .filter((value): value is number => Number.isInteger(value)),
    inferredLegacyDocumentVersion: false
  };
}

function backupTimestamp(date: Date): string {
  return date.toISOString().replace(/[:.]/g, '-');
}

export function intendedMigrationBackupPath(databasePath: string, now = new Date()): string {
  const parsed = path.parse(path.resolve(databasePath));
  return path.join(parsed.dir, `${parsed.name}.v0.1-backup-${backupTimestamp(now)}${parsed.ext || '.sqlite'}`);
}

/** Opens SQLite in read-only mode and produces the complete preflight report without changing database state. */
export function inspectMigrationDatabase(
  databasePath: string,
  options: InspectMigrationOptions = {}
): MigrationInspectionReport {
  const absolutePath = path.resolve(databasePath);
  const generatedAt = (options.now ?? new Date()).toISOString();
  if (!fs.existsSync(absolutePath)) throw new Error(`database does not exist: ${absolutePath}`);
  const db = new DatabaseSync(absolutePath, { readOnly: true });
  try {
    const versions = versionState(db);
    const databaseVersion = inspectDatabaseVersion(db);
    const sourceVersion = databaseVersion.kind === 'v1' ? 1 : databaseVersion.kind === 'v2' ? 2 : null;
    const integrity = (db.prepare('PRAGMA integrity_check').all() as unknown as Array<Record<string, string>>).map(
      (row) => Object.values(row)[0] ?? 'unknown'
    );
    const foreignKeyViolations = (db.prepare('PRAGMA foreign_key_check').all() as unknown[]).length;
    const issues: MigrationIssue[] = [];
    const runtimeFieldsToStrip: RuntimeFieldOccurrence[] = [];
    const groupBlockers: GroupBlocker[] = [];
    const typeCounts = new Map<string, TypeMappingCount>();
    const requiredImporters = new Set<string>();
    let elements = 0;

    if (!hasTable(db, 'canvases')) {
      issues.push({
        code: 'database_unreadable',
        severity: 'blocker',
        message: 'required canvases table is missing'
      });
    } else {
      const columns = tableColumns(db, 'canvases');
      if (!columns.includes('elements_json')) {
        issues.push({
          code: 'database_unreadable',
          severity: 'blocker',
          message: 'required canvases.elements_json column is missing'
        });
      } else {
        const rows = db
          .prepare('SELECT id, elements_json FROM canvases ORDER BY id')
          .all() as unknown as CanvasElementsRow[];
        for (const row of rows) {
          let parsed: unknown;
          try {
            parsed = JSON.parse(row.elements_json);
          } catch {
            issues.push({
              code: 'malformed_elements_json',
              severity: 'blocker',
              message: 'canvas elements_json is malformed JSON',
              canvasId: row.id
            });
            continue;
          }
          if (!Array.isArray(parsed)) {
            issues.push({
              code: 'malformed_elements_json',
              severity: 'blocker',
              message: 'canvas elements_json must contain an array',
              canvasId: row.id
            });
            continue;
          }
          elements += parsed.length;
          const seenIds = new Set<string>();
          for (const element of parsed) {
            const analysis = sourceVersion === 1 ? analyzeLegacyElement(row.id, element) : null;
            if (analysis) {
              issues.push(...analysis.issues);
              runtimeFieldsToStrip.push(...analysis.runtimeFields);
              groupBlockers.push(...analysis.groupBlockers);
              if (analysis.mapping) {
                const current = typeCounts.get(analysis.mapping.legacyType);
                if (current) current.count += 1;
                else typeCounts.set(analysis.mapping.legacyType, { ...analysis.mapping });
              }
              if (analysis.pluginId) requiredImporters.add(analysis.pluginId);
            }
            const elementId =
              analysis?.elementId ??
              (element && typeof element === 'object' && typeof (element as { id?: unknown }).id === 'string'
                ? (element as { id: string }).id
                : undefined);
            if (elementId) {
              if (seenIds.has(elementId)) {
                issues.push({
                  code: 'duplicate_element_id',
                  severity: 'blocker',
                  message: `duplicate element id in canvas: ${elementId}`,
                  canvasId: row.id,
                  elementId
                });
              }
              seenIds.add(elementId);
            }
            if (sourceVersion === 1 && options.validateLegacyElement) {
              try {
                options.validateLegacyElement(element);
              } catch (error) {
                issues.push({
                  code: 'validation_failed',
                  severity: 'blocker',
                  message: error instanceof Error ? error.message : 'legacy validator rejected element',
                  canvasId: row.id,
                  ...(elementId ? { elementId } : {})
                });
              }
            }
          }
        }
      }
    }

    if (
      versions.documentVersions.some((version) => version !== 1 && version !== 2) ||
      versions.documentVersions.length > 1
    ) {
      issues.push({
        code: 'invalid_document_version',
        severity: 'blocker',
        message: `contradictory document versions: ${versions.documentVersions.join(', ') || '<none>'}`
      });
    }
    if (databaseVersion.kind === 'contradictory' || databaseVersion.kind === 'newer') {
      issues.push({
        code: 'invalid_document_version',
        severity: 'blocker',
        message:
          databaseVersion.kind === 'contradictory'
            ? databaseVersion.message
            : `database version ${databaseVersion.physicalVersion}/${databaseVersion.documentVersion} is newer than AgentCanvas supports`
      });
    }
    if (!integrity.every((value) => value === 'ok')) {
      issues.push({
        code: 'database_unreadable',
        severity: 'blocker',
        message: `SQLite integrity check failed: ${integrity.join('; ')}`
      });
    }
    if (foreignKeyViolations > 0) {
      issues.push({
        code: 'database_unreadable',
        severity: 'blocker',
        message: `SQLite foreign-key check found ${foreignKeyViolations} violation(s)`
      });
    }

    return {
      databasePath: absolutePath,
      intendedBackupPath: options.intendedBackupPath ?? intendedMigrationBackupPath(absolutePath, options.now),
      generatedAt,
      sourceVersion,
      targetVersion: 2,
      versions,
      checks: { integrity, foreignKeyViolations },
      counts: {
        canvases: tableCount(db, 'canvases'),
        elements,
        shareLinks: tableCount(db, 'canvas_share_links'),
        events: tableCount(db, 'canvas_events'),
        idempotencyRows: tableCount(db, 'canvas_idempotency_keys')
      },
      typeMappings: [...typeCounts.values()].sort((a, b) => a.legacyType.localeCompare(b.legacyType)),
      requiredPluginImporters: [...requiredImporters].sort(),
      runtimeFieldsToStrip,
      groupBlockers,
      issues,
      canApply: sourceVersion === 1 && !issues.some((issue) => issue.severity === 'blocker')
    };
  } finally {
    db.close();
  }
}
