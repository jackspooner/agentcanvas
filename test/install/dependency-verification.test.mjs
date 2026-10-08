import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

const source = path.resolve(import.meta.dirname, '../..');

function verifyWithCli(output, exitCode = 0) {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'agentcanvas verification '));
  try {
    fs.mkdirSync(path.join(temporary, 'scripts'));
    fs.mkdirSync(path.join(temporary, '.cutlery'));
    fs.copyFileSync(path.join(source, 'scripts/internal-dependencies.mjs'), path.join(temporary, 'scripts/internal-dependencies.mjs'));
    fs.copyFileSync(path.join(source, '.cutlery/internal-deps.toml'), path.join(temporary, '.cutlery/internal-deps.toml'));
    const cli = path.join(temporary, 'owner cli.mjs');
    fs.writeFileSync(cli, `import assert from 'node:assert/strict';
assert.deepEqual(process.argv.slice(2), ['verify', '--repo', ${JSON.stringify(temporary)}]);
process.stdout.write(${JSON.stringify(output)});
process.exitCode = ${exitCode};\n`);
    return spawnSync(process.execPath, ['scripts/internal-dependencies.mjs', 'verify'], {
      cwd: temporary,
      env: { ...process.env, WORKSPACE2_INTERNAL_DEPS_CLI: cli },
      encoding: 'utf8',
      timeout: 10_000
    });
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

test('configured owner verifies an arbitrary checkout path with spaces', () => {
  const result = verifyWithCli(JSON.stringify({ ok: true, verified: [{ ok: true }] }));
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Verified 1 pinned internal dependency/);
});

for (const [name, result] of [
  ['exit-zero ok:false', { ok: false, verified: [{ ok: true }] }],
  ['truthy non-boolean ok', { ok: 'true', verified: [{ ok: true }] }],
  ['skipped verification', { ok: true, skipped: true, verified: [{ ok: true }] }],
  ['missing results', { ok: true }],
  ['malformed results', { ok: true, verified: { length: 1 } }],
  ['empty results', { ok: true, verified: [] }],
  ['failed package verification', { ok: true, verified: [{ ok: false }] }]
]) {
  test(`verification rejects ${name}`, () => {
    const execution = verifyWithCli(JSON.stringify(result));
    assert.equal(execution.status, 1);
    assert.match(execution.stderr, /Internal dependency verification failed/);
  });
}

test('verification rejects invalid JSON and owner CLI errors', () => {
  assert.equal(verifyWithCli('not JSON').status, 1);
  assert.equal(verifyWithCli(JSON.stringify({ ok: true, verified: [{ ok: true }] }), 7).status, 1);
});

test('verification rejects missing or relative configured CLI paths', () => {
  for (const cli of ['missing-owner.mjs', path.join(os.tmpdir(), 'agentcanvas-nonexistent-owner.mjs')]) {
    const result = spawnSync(process.execPath, ['scripts/internal-dependencies.mjs', 'verify'], {
      cwd: source,
      env: { ...process.env, WORKSPACE2_INTERNAL_DEPS_CLI: cli },
      encoding: 'utf8'
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /existing absolute Workspace2InternalDeps CLI path/);
  }
});
