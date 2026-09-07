import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { expect, it } from 'vitest';

it('processes editor TSX with the installed formatter and linter', () => {
  const require = createRequire(import.meta.url);
  const binary = path.join(path.dirname(require.resolve('@biomejs/biome/package.json')), 'bin/biome');
  for (const command of ['format', 'lint']) {
    const result = spawnSync(
      process.execPath,
      [binary, command, '--diagnostic-level=error', 'packages/editor/src/AgentCanvasEditor.tsx'],
      { encoding: 'utf8' }
    );
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('Checked 1 file');
  }
});
