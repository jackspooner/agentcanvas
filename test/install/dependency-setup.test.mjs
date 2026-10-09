import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

// Network-dependent installation proof, deliberately separate from the application suite.
test('clean setup loads the pinned dependency and verification rejects incomplete output', { timeout: 300_000 }, () => {
  const source = path.resolve(import.meta.dirname, '../..');
  assert.ok(process.env.npm_execpath, 'Run through npm run test:setup');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentcanvas-setup-test-'));
  try {
    const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], {
      cwd: source,
      encoding: 'utf8'
    })
      .split('\0')
      .filter(Boolean);
    for (const file of files) {
      const target = path.resolve(root, file);
      assert.ok(target.startsWith(root + path.sep));
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(path.join(source, file), target);
    }
    // DevTasks binds preparation receipts to committed Git inputs, as in a linked checkout.
    execFileSync('git', ['init', '--quiet', '--initial-branch=main'], { cwd: root });
    execFileSync('git', ['add', '.'], { cwd: root });
    execFileSync('git', ['-c', 'user.name=Setup fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '--quiet', '-m', 'Fixture inputs'], { cwd: root });
    assert.equal(fs.existsSync(path.join(root, '.cutlery/deps')), false);
    execFileSync(process.execPath, [process.env.npm_execpath, 'run', 'setup'], {
      cwd: root,
      timeout: 240_000,
      stdio: 'pipe'
    });
    const pinnedFiles = ['package-lock.json', '.cutlery/internal-deps.toml'];
    const prepared = pinnedFiles.map((file) => fs.readFileSync(path.join(root, file)));
    execFileSync(process.execPath, [process.env.npm_execpath, 'run', 'setup:worktree'], {
      cwd: root,
      timeout: 240_000,
      stdio: 'pipe'
    });
    for (let index = 0; index < pinnedFiles.length; index += 1) {
      assert.deepEqual(fs.readFileSync(path.join(root, pinnedFiles[index])), prepared[index]);
      assert.deepEqual(prepared[index], fs.readFileSync(path.join(source, pinnedFiles[index])));
    }
    const builtEntry = path.join(root, '.cutlery/deps/workspace2-api-contracts/dist/index.js');
    fs.unlinkSync(builtEntry);
    const verification = spawnSync(process.execPath, ['scripts/internal-dependencies.mjs', 'verify'], {
      cwd: root,
      timeout: 120_000,
      encoding: 'utf8'
    });
    assert.equal(verification.status, 1);
    assert.match(verification.stderr, /missing_build_output/);
  } finally {
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    fs.rmSync(root, { recursive: true, force: true });
  }
});
