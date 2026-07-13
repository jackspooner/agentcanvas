import { describe, expect, it, vi } from 'vitest';
import { runMigrationCli } from '../src/cli/migrate';

describe('migration CLI dispatch', () => {
  it('dispatches apply arguments through an integration hook', async () => {
    const apply = vi.fn(() => ({ ok: true }));
    const stdout = vi.fn();
    const code = await runMigrationCli(
      ['migrate', 'apply', '--database', 'canvas.sqlite', '--backup-dir', 'backups', '--plugins', 'plugins'],
      { stdout, stderr: vi.fn() },
      { inspect: vi.fn(), apply }
    );
    expect(code).toBe(0);
    expect(apply).toHaveBeenCalledWith({
      databasePath: 'canvas.sqlite',
      backupDir: 'backups',
      pluginsPath: 'plugins'
    });
    expect(stdout).toHaveBeenCalledWith(JSON.stringify({ ok: true }, null, 2));
  });

  it('fails closed when a mutating integration hook is absent', async () => {
    const stderr = vi.fn();
    const code = await runMigrationCli(
      ['migrate', 'restore', '--database', 'canvas.sqlite', '--backup', 'backup.sqlite'],
      { stdout: vi.fn(), stderr },
      { inspect: vi.fn() }
    );
    expect(code).toBe(1);
    expect(stderr).toHaveBeenCalledWith('migration restore integration is not available in this build');
  });
});
