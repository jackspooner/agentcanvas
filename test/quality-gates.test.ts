import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { expect, it } from 'vitest';

it('includes editor TSX and rejects missing hook dependencies through the installed Biome', () => {
  const require = createRequire(import.meta.url);
  const binary = path.join(path.dirname(require.resolve('@biomejs/biome/package.json')), 'bin/biome');
  const file = 'packages/editor/src/AgentCanvasEditor.tsx';
  const actual = spawnSync(process.execPath, [binary, 'lint', '--diagnostic-level=error', file], { encoding: 'utf8' });
  expect(actual.status, actual.stderr).toBe(0);
  expect(actual.stdout).toContain('Checked 1 file');
  const invalid = spawnSync(process.execPath, [binary, 'lint', `--stdin-file-path=${file}`], {
    encoding: 'utf8',
    input:
      "import { useEffect } from 'react'; export function Probe({ value }: { value: string }) { useEffect(() => { document.title = value; }, []); return <span>{value}</span>; }"
  });
  expect(invalid.status).not.toBe(0);
  // Biome 2.5 stdin check reports a generic failure. Its stdin-only fix output proves
  // the active hook rule identified the missing dependency; --write here only emits stdout.
  const repaired = spawnSync(process.execPath, [binary, 'lint', '--write', '--unsafe', `--stdin-file-path=${file}`], {
    encoding: 'utf8',
    input:
      "import { useEffect } from 'react'; export function Probe({ value }: { value: string }) { useEffect(() => { document.title = value; }, []); return <span>{value}</span>; }"
  });
  expect(repaired.status, repaired.stderr).toBe(0);
  expect(repaired.stdout).toContain('[value]');
});
