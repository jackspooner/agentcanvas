import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createBackupManifest, sha256File, verifyBackupManifest } from '../src/migrations/backup';

describe('migration backup manifests', () => {
  it('records and verifies length and SHA-256, then detects mutation', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'agentcanvas-backup-'));
    try {
      const backupPath = path.join(directory, 'backup.sqlite');
      fs.writeFileSync(backupPath, 'sqlite-backup-fixture');
      const manifest = createBackupManifest({
        sourceDatabasePath: path.join(directory, 'source.sqlite'),
        backupPath,
        sourceVersion: 1,
        targetVersion: 2,
        createdAt: '2026-07-13T10:00:00.000Z',
        counts: { canvases: 1, elements: 2, shareLinks: 3, events: 4, idempotencyRows: 5 },
        toolVersion: '0.2.0'
      });
      expect(manifest.sha256).toBe(sha256File(backupPath));
      expect(verifyBackupManifest(manifest)).toMatchObject({ ok: true, errors: [] });
      fs.appendFileSync(backupPath, '-changed');
      expect(verifyBackupManifest(manifest)).toMatchObject({ ok: false });
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
});
