import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (process.argv.length > 3 || (process.argv[2] && !['full', 'docs'].includes(process.argv[2]))) {
  throw new Error('Usage: npm run setup:worktree -- [full|docs]');
}
const result = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['ci'], {
  cwd: root,
  stdio: 'inherit',
  env: process.env
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
