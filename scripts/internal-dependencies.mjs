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

// Bootstrap the existing dependency owner without requiring an installed npm package.
const materializerRepository = 'https://github.com/jackspooner/workspace2-internal-deps.git';
const materializerCommit = 'f5f2b53cfc0300da646427ee03953dcd5829bf3b';
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
