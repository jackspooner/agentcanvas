import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = path.resolve(import.meta.dirname, '..');
const action = process.argv[2];
if (!['materialize', 'verify'].includes(action) || process.argv.length !== 3) {
  throw new Error('Usage: node scripts/internal-dependencies.mjs <materialize|verify>');
}
fs.accessSync(path.join(root, '.cutlery', 'internal-deps.toml'));

// Nested first-party pins can exceed Win32's legacy path limit in linked worktrees.
// Scope Git's supported long-path option to this setup process and its children.
if (process.platform === 'win32') {
  const index = Number(process.env.GIT_CONFIG_COUNT ?? 0);
  if (!Number.isSafeInteger(index) || index < 0) throw new Error('Invalid GIT_CONFIG_COUNT');
  process.env[`GIT_CONFIG_KEY_${index}`] = 'core.longpaths';
  process.env[`GIT_CONFIG_VALUE_${index}`] = 'true';
  process.env.GIT_CONFIG_COUNT = String(index + 1);
}

// Bootstrap the existing dependency owner without requiring an installed npm package.
const materializerRepository = 'https://github.com/jackspooner/workspace2-internal-deps.git';
const materializerCommit = '64e9ae122fd764c655df2fcf5513c022842780fe';
const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agentcanvas-internal-deps-'));
const checkout = path.join(temporaryRoot, 'materializer');
try {
  execFileSync('git', ['clone', '--quiet', '--no-checkout', materializerRepository, checkout], {
    stdio: 'inherit',
    windowsHide: true,
    timeout: 120_000
  });
  execFileSync('git', ['-C', checkout, 'checkout', '--quiet', '--detach', materializerCommit], {
    stdio: 'inherit',
    windowsHide: true,
    timeout: 120_000
  });
  const { materializeRepoDependencies, verifyRepoDependencies } = await import(
    pathToFileURL(path.join(checkout, 'src', 'index.mjs')).href
  );
  if (action === 'materialize') {
    console.log('Preparing pinned internal dependencies…');
    await materializeRepoDependencies(root);
  }
  const result = await verifyRepoDependencies(root);
  if (!result.ok || result.skipped || !result.verified.length) {
    throw new Error(`Internal dependency verification failed: ${JSON.stringify(result)}`);
  }
  console.log(`Verified ${result.verified.length} pinned internal dependency package(s).`);
} finally {
  if (path.dirname(temporaryRoot) !== path.resolve(os.tmpdir())) throw new Error('Unexpected temporary directory');
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
}
