import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { inspectMigrationDatabase } from '../src/migrations/inspect';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

function fixtureDatabase(canvases: Array<{ id: string; elements: unknown[] }>): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'agentcanvas-migration-'));
  temporaryDirectories.push(directory);
  const databasePath = path.join(directory, 'fixture.sqlite');
  const db = new DatabaseSync(databasePath);
  db.exec(`
    CREATE TABLE canvases (id TEXT PRIMARY KEY, elements_json TEXT NOT NULL);
    CREATE TABLE canvas_events (id TEXT PRIMARY KEY);
    CREATE TABLE canvas_share_links (id TEXT PRIMARY KEY);
    CREATE TABLE canvas_idempotency_keys (key TEXT PRIMARY KEY);
  `);
  const insert = db.prepare('INSERT INTO canvases (id, elements_json) VALUES (?, ?)');
  for (const canvas of canvases) insert.run(canvas.id, JSON.stringify(canvas.elements));
  db.prepare('INSERT INTO canvas_events (id) VALUES (?)').run('event_1');
  db.prepare('INSERT INTO canvas_share_links (id) VALUES (?)').run('share_1');
  db.prepare('INSERT INTO canvas_idempotency_keys (key) VALUES (?)').run('key_1');
  db.close();
  return databasePath;
}

describe('migration inspection', () => {
  it('is read-only and reports mappings, counts, importers, and fields to strip', () => {
    const databasePath = fixtureDatabase([
      {
        id: 'canvas_a',
        elements: [
          { id: 'a1', type: 'asset', x: 0, y: 0, assetRef: {}, resolvedUrl: 'runtime' },
          { id: 'm1', type: 'markdown', x: 1, y: 2, markdown: '# Hi' }
        ]
      }
    ]);
    const before = fs.statSync(databasePath).size;
    const report = inspectMigrationDatabase(databasePath, { now: new Date('2026-07-13T10:00:00.000Z') });
    expect(report.canApply).toBe(true);
    expect(report.counts).toEqual({ canvases: 1, elements: 2, shareLinks: 1, events: 1, idempotencyRows: 1 });
    expect(report.typeMappings).toEqual([
      { legacyType: 'asset', targetType: 'agentcanvas.assets2/asset', count: 1 },
      { legacyType: 'markdown', targetType: 'agentcanvas.markdown/document', count: 1 }
    ]);
    expect(report.requiredPluginImporters).toEqual(['agentcanvas.assets2', 'agentcanvas.markdown']);
    expect(report.runtimeFieldsToStrip).toHaveLength(1);
    expect(fs.statSync(databasePath).size).toBe(before);
  });

  it('refuses group, unknown type, duplicate id, and unexpected-field documents', () => {
    const databasePath = fixtureDatabase([
      {
        id: 'canvas_a',
        elements: [
          { id: 'same', type: 'group', x: 0, y: 0, children: [] },
          { id: 'same', type: 'future', x: 0, y: 0 },
          { id: 'text', type: 'text', x: 0, y: 0, text: 'hi', extra: true }
        ]
      }
    ]);
    const report = inspectMigrationDatabase(databasePath);
    expect(report.canApply).toBe(false);
    expect(new Set(report.issues.map((issue) => issue.code))).toEqual(
      new Set(['group_element_present', 'unknown_legacy_type', 'duplicate_element_id', 'unexpected_legacy_field'])
    );
    expect(report.groupBlockers).toEqual([{ canvasId: 'canvas_a', elementId: 'same' }]);
  });
});
