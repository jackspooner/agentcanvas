import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, expect, it } from 'vitest';
import { repairCreatedBy, restoreMigration, verifyMigrationDatabase } from '../src/migrations/index.js';
import { createV2Runtime } from '../src/runtime.js';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

it('repairs five noncanonical creators once, preserves provenance, and restores the verified backup', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentcanvas-created-by-'));
  roots.push(root);
  const databasePath = path.join(root, 'canvas.sqlite');
  fs.mkdirSync(path.join(root, 'plugins'));
  const runtime = await createV2Runtime({ pluginsRoot: path.join(root, 'plugins'), databasePath });
  for (let index = 0; index < 5; index++) runtime.store.createCanvas({ title: `Legacy ${index}` });
  runtime.dispose();
  const db = new DatabaseSync(databasePath);
  db.prepare("UPDATE canvases SET created_by = 'system-prompt-dev' WHERE 1").run();
  db.close();

  expect(verifyMigrationDatabase({ databasePath }).errors).toContain(
    '5 canvas(es) use a noncanonical created_by value'
  );
  const repaired = await repairCreatedBy({ databasePath, backupDir: root, toolVersion: 'test' });
  expect(repaired).toMatchObject({ ok: true, repaired: 5, noOp: false });
  expect(repaired.backupPath && fs.existsSync(repaired.backupPath)).toBe(true);
  expect(repaired.manifestPath && fs.existsSync(repaired.manifestPath)).toBe(true);
  expect(verifyMigrationDatabase({ databasePath })).toMatchObject({ ok: true, errors: [] });

  const checked = new DatabaseSync(databasePath, { readOnly: true });
  const rows = checked.prepare('SELECT created_by, metadata_json FROM canvases').all() as unknown as Array<{
    created_by: string;
    metadata_json: string;
  }>;
  checked.close();
  expect(rows).toHaveLength(5);
  expect(rows.every((row) => row.created_by === 'system')).toBe(true);
  expect(rows.every((row) => JSON.parse(row.metadata_json).legacyCreatedBy === 'system-prompt-dev')).toBe(true);

  const backupCount = fs
    .readdirSync(root)
    .filter((name) => name.includes('.created-by-') && name.endsWith('.bak')).length;
  await expect(repairCreatedBy({ databasePath, backupDir: root, toolVersion: 'test' })).resolves.toMatchObject({
    repaired: 0,
    noOp: true
  });
  expect(fs.readdirSync(root).filter((name) => name.includes('.created-by-') && name.endsWith('.bak'))).toHaveLength(
    backupCount
  );

  await restoreMigration({ databasePath, backupPath: repaired.backupPath as string });
  expect(verifyMigrationDatabase({ databasePath }).errors).toContain(
    '5 canvas(es) use a noncanonical created_by value'
  );
});

it('refuses to overwrite conflicting legacy creator provenance', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentcanvas-created-by-conflict-'));
  roots.push(root);
  const databasePath = path.join(root, 'canvas.sqlite');
  fs.mkdirSync(path.join(root, 'plugins'));
  const runtime = await createV2Runtime({ pluginsRoot: path.join(root, 'plugins'), databasePath });
  const canvas = runtime.store.createCanvas({ title: 'Conflict' });
  runtime.dispose();
  const db = new DatabaseSync(databasePath);
  db.prepare('UPDATE canvases SET created_by=?, metadata_json=? WHERE id=?').run(
    'system-prompt-dev',
    JSON.stringify({ legacyCreatedBy: 'another-value' }),
    canvas.id
  );
  db.close();
  await expect(repairCreatedBy({ databasePath, backupDir: root, toolVersion: 'test' })).rejects.toThrow('conflicting');
  expect(fs.readdirSync(root).some((name) => name.includes('.created-by-'))).toBe(false);
});
