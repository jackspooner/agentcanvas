import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { applyMigration } from '../src/migrations/apply';
import { readBackupManifest, verifyBackupManifest } from '../src/migrations/backup';
import { restoreMigration } from '../src/migrations/restore';
import type { LegacyElementImporter } from '../src/migrations/types';
import { assertCanonicalElement, verifyMigrationDatabase } from '../src/migrations/verify';
import { V1_SCHEMA_SQL } from '../src/migrations/v1-schema';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

function createFixture(): { databasePath: string; originalElementsJson: string; eventJson: string } {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'agentcanvas-apply-'));
  temporaryDirectories.push(directory);
  const databasePath = path.join(directory, 'canvas.sqlite');
  const db = new DatabaseSync(databasePath);
  db.exec(`${V1_SCHEMA_SQL} PRAGMA user_version = 0;`);
  const originalElementsJson = JSON.stringify([
    {
      id: 'asset_1',
      type: 'asset',
      x: 10,
      y: 20,
      width: 300,
      height: 200,
      assetRef: { type: 'asset', project: 'fixtures', assetId: 'asset-a' },
      fit: 'contain',
      resolvedUrl: 'http://runtime.invalid/content',
      metadata: { fixture: true }
    },
    { id: 'text_1', type: 'text', x: -5, y: 9, text: 'Preserve me', style: { color: '#123456' } }
  ]);
  db.prepare(
    `INSERT INTO canvases
     (id, title, description, project, conversation_id, created_by, created_at, updated_at, width, height,
      bounds_json, background_json, elements_json, revision, metadata_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    'canvas_1',
    'Migration fixture',
    'description',
    'fixtures',
    'conversation_1',
    'agent',
    '2026-07-01T10:00:00.000Z',
    '2026-07-02T11:00:00.000Z',
    1600,
    1000,
    JSON.stringify({ mode: 'fixed', width: 1600, height: 1000 }),
    JSON.stringify({ color: '#ffffff' }),
    originalElementsJson,
    17,
    JSON.stringify({ keep: 'exactly' })
  );
  const eventJson = JSON.stringify({ op: 'legacyEvent', payload: { unchanged: true } });
  db.prepare(
    'INSERT INTO canvas_events (id, canvas_id, revision, operation_json, created_at, actor) VALUES (?, ?, ?, ?, ?, ?)'
  ).run('event_1', 'canvas_1', 17, eventJson, '2026-07-02T11:00:00.000Z', 'agent');
  db.prepare(
    `INSERT INTO canvas_share_links
     (id, canvas_id, token_hash, mode, label, expires_at, created_at, revoked_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run('share_1', 'canvas_1', 'hash', 'read', 'fixture', null, '2026-07-02T11:30:00.000Z', null);
  db.prepare(
    `INSERT INTO canvas_viewports
     (canvas_id, source, center_x, center_y, zoom, width, height, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run('canvas_1', 'user', 12, 34, 1.25, 1440, 900, '2026-07-02T12:00:00.000Z');
  db.prepare(
    'INSERT INTO agent_canvas_configuration (id, configuration_json, updated_at, actor) VALUES (1, ?, ?, ?)'
  ).run(JSON.stringify({ defaultCanvasSize: { mode: 'unlimited' } }), '2026-07-02T12:30:00.000Z', 'agent');
  const idempotency = db.prepare(
    'INSERT INTO canvas_idempotency_keys (key, canvas_id, request_hash, response_json, created_at) VALUES (?, ?, ?, ?, ?)'
  );
  idempotency.run('key_1', 'canvas_1', 'request-1', JSON.stringify({ revision: 16 }), '2026-07-02T10:00:00.000Z');
  idempotency.run('key_2', 'canvas_1', 'request-2', JSON.stringify({ revision: 17 }), '2026-07-02T11:00:00.000Z');
  db.close();
  return { databasePath, originalElementsJson, eventJson };
}

const importers: LegacyElementImporter[] = [
  {
    legacyType: 'asset',
    targetType: 'agentcanvas.assets2/asset',
    schemaVersion: 1,
    import: (element) => ({
      data: {
        assetRef: element.assetRef,
        ...(element.fit !== undefined ? { fit: element.fit } : {})
      }
    })
  },
  {
    legacyType: 'text',
    targetType: 'agentcanvas.primitives/text',
    schemaVersion: 1,
    import: (element) => ({ data: { text: element.text } })
  }
];

function validateFixtureElement(element: { type: string; data: Record<string, unknown> }): void {
  if (element.type === 'agentcanvas.assets2/asset' && !element.data.assetRef) throw new Error('assetRef is required');
  if (element.type === 'agentcanvas.primitives/text' && typeof element.data.text !== 'string') {
    throw new Error('text is required');
  }
}

describe('offline migration apply/verify/restore', () => {
  it('rejects importer values that JSON serialization would silently discard or coerce', () => {
    const base = {
      id: 'text_1',
      type: 'agentcanvas.primitives/text',
      schemaVersion: 1,
      x: 0,
      y: 0
    };
    expect(() => assertCanonicalElement({ ...base, data: { value: undefined } })).toThrow('non-JSON value');
    expect(() => assertCanonicalElement({ ...base, data: { value: new Date() } })).toThrow('not a plain JSON object');
    const symbolData = { value: 'visible', [Symbol('hidden')]: 'discarded' };
    expect(() => assertCanonicalElement({ ...base, data: symbolData })).toThrow('symbol properties');
  });

  it('backs up, migrates transactionally, preserves audit state, verifies, and restores', async () => {
    const fixture = createFixture();
    const result = await applyMigration({
      databasePath: fixture.databasePath,
      backupDir: path.join(path.dirname(fixture.databasePath), 'backups'),
      importers,
      validateElement: validateFixtureElement,
      toolVersion: '0.2.0-test',
      now: new Date('2026-07-13T10:00:00.000Z')
    });

    expect(result.verification.ok).toBe(true);
    expect(result.verification.summary).toMatchObject({
      countsBefore: { canvases: 1, elements: 2, shareLinks: 1, events: 1, idempotencyRows: 2 },
      countsAfter: { canvases: 1, elements: 2, shareLinks: 1, events: 1, idempotencyRows: 0 },
      strippedRuntimeFieldCount: 1,
      invalidatedIdempotencyRows: 2,
      preservedEventCount: 1,
      preservedShareLinkCount: 1
    });
    const manifest = readBackupManifest(result.manifestPath);
    expect(verifyBackupManifest(manifest)).toMatchObject({ ok: true, errors: [] });

    const migrated = new DatabaseSync(fixture.databasePath, { readOnly: true });
    const canvas = migrated.prepare('SELECT * FROM canvases WHERE id = ?').get('canvas_1') as Record<string, unknown>;
    expect(canvas).toMatchObject({
      title: 'Migration fixture',
      updated_at: '2026-07-02T11:00:00.000Z',
      revision: 17,
      document_version: 2
    });
    const elements = JSON.parse(canvas.elements_json as string) as Array<Record<string, unknown>>;
    expect(elements.map((element) => element.type)).toEqual([
      'agentcanvas.assets2/asset',
      'agentcanvas.primitives/text'
    ]);
    expect(elements[0]).not.toHaveProperty('resolvedUrl');
    expect(elements[0]).toMatchObject({ schemaVersion: 1, data: { fit: 'contain' } });
    expect(migrated.prepare('SELECT operation_json, document_version FROM canvas_events').get()).toEqual({
      operation_json: fixture.eventJson,
      document_version: 1
    });
    expect(migrated.prepare('SELECT COUNT(*) AS count FROM canvas_share_links').get()).toEqual({ count: 1 });
    expect(migrated.prepare('SELECT COUNT(*) AS count FROM canvas_idempotency_keys').get()).toEqual({ count: 0 });
    expect((migrated.prepare('PRAGMA user_version').get() as { user_version: number }).user_version).toBe(2);
    migrated.close();

    expect(
      verifyMigrationDatabase({ databasePath: fixture.databasePath, validateElement: validateFixtureElement })
    ).toMatchObject({ ok: true, errors: [] });

    const restored = await restoreMigration({
      databasePath: fixture.databasePath,
      backupPath: result.backupPath,
      now: new Date('2026-07-13T11:00:00.000Z')
    });
    expect(restored.failedDatabasePath).not.toBeNull();
    expect(verifyMigrationDatabase({ databasePath: restored.failedDatabasePath as string })).toMatchObject({
      ok: true
    });

    const v1 = new DatabaseSync(fixture.databasePath, { readOnly: true });
    expect((v1.prepare('SELECT elements_json FROM canvases').get() as { elements_json: string }).elements_json).toBe(
      fixture.originalElementsJson
    );
    expect(v1.prepare('SELECT COUNT(*) AS count FROM canvas_idempotency_keys').get()).toEqual({ count: 2 });
    expect((v1.prepare('PRAGMA user_version').get() as { user_version: number }).user_version).toBe(0);
    v1.close();
  });

  it('rolls back all database changes and retains backup diagnostics when validation fails', async () => {
    const fixture = createFixture();
    await expect(
      applyMigration({
        databasePath: fixture.databasePath,
        importers,
        validateElement: () => {
          throw new Error('fixture plugin schema rejected data');
        },
        toolVersion: '0.2.0-test',
        now: new Date('2026-07-13T12:00:00.000Z')
      })
    ).rejects.toThrow('fixture plugin schema rejected data');

    const directory = path.dirname(fixture.databasePath);
    const backupPath = path.join(directory, 'canvas.v0.1-backup-2026-07-13T12-00-00-000Z.sqlite');
    expect(fs.existsSync(backupPath)).toBe(true);
    expect(fs.existsSync(`${backupPath}.manifest.json`)).toBe(true);
    expect(fs.existsSync(`${backupPath}.failure.json`)).toBe(true);
    const db = new DatabaseSync(fixture.databasePath, { readOnly: true });
    expect((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version).toBe(0);
    expect(
      (
        db
          .prepare("SELECT COUNT(*) AS count FROM pragma_table_info('canvases') WHERE name = 'document_version'")
          .get() as {
          count: number;
        }
      ).count
    ).toBe(0);
    expect((db.prepare('SELECT elements_json FROM canvases').get() as { elements_json: string }).elements_json).toBe(
      fixture.originalElementsJson
    );
    expect(db.prepare('SELECT COUNT(*) AS count FROM canvas_idempotency_keys').get()).toEqual({ count: 2 });
    db.close();
  });

  it('refuses group-containing databases before creating a backup', async () => {
    const fixture = createFixture();
    const db = new DatabaseSync(fixture.databasePath);
    db.prepare('UPDATE canvases SET elements_json = ? WHERE id = ?').run(
      JSON.stringify([{ id: 'group_1', type: 'group', x: 0, y: 0, children: ['text_1'] }]),
      'canvas_1'
    );
    db.close();

    await expect(
      applyMigration({
        databasePath: fixture.databasePath,
        importers,
        validateElement: validateFixtureElement,
        toolVersion: '0.2.0-test',
        now: new Date('2026-07-13T13:00:00.000Z')
      })
    ).rejects.toThrow('removed group element prevents migration');
    expect(
      fs.existsSync(path.join(path.dirname(fixture.databasePath), 'canvas.v0.1-backup-2026-07-13T13-00-00-000Z.sqlite'))
    ).toBe(false);
  });

  it('rejects a tampered backup without replacing the current v0.2 database', async () => {
    const fixture = createFixture();
    const applied = await applyMigration({
      databasePath: fixture.databasePath,
      importers,
      validateElement: validateFixtureElement,
      toolVersion: '0.2.0-test',
      now: new Date('2026-07-13T14:00:00.000Z')
    });
    fs.appendFileSync(applied.backupPath, 'tampered');

    await expect(
      restoreMigration({
        databasePath: fixture.databasePath,
        backupPath: applied.backupPath,
        now: new Date('2026-07-13T15:00:00.000Z')
      })
    ).rejects.toThrow('backup manifest verification failed');
    expect(verifyMigrationDatabase({ databasePath: fixture.databasePath })).toMatchObject({ ok: true });
  });
});
