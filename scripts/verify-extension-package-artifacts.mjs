import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const node = process.execPath;
const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error('npm_execpath is required; run this check through npm run check:extension-packages');
const workRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agentcanvas-extension-artifacts-'));
const tarballDirectory = path.join(workRoot, 'tarballs');
const consumerDirectory = path.join(workRoot, 'consumer');

function run(command, args, cwd = root) {
  execFileSync(command, args, { cwd, stdio: 'inherit', env: process.env });
}

function runNpm(args, cwd = root) {
  run(node, [npmCli, ...args], cwd);
}

function packWorkspace(workspace) {
  const before = new Set(fs.readdirSync(tarballDirectory));
  runNpm(['pack', '--workspace', workspace, '--pack-destination', tarballDirectory, '--quiet']);
  const created = fs.readdirSync(tarballDirectory).filter((entry) => !before.has(entry));
  if (created.length !== 1) throw new Error(`expected one tarball for ${workspace}, found ${created.length}`);
  return path.join(tarballDirectory, created[0]);
}

function fileDependency(fromDirectory, tarballPath) {
  return `file:${path.relative(fromDirectory, tarballPath).replaceAll('\\', '/')}`;
}

try {
  fs.mkdirSync(tarballDirectory, { recursive: true });
  fs.mkdirSync(consumerDirectory, { recursive: true });

  const tarballs = new Map();
  for (const workspace of [
    '@agentcanvas/plugin-sdk',
    '@agentcanvas/plugin-testkit',
    'create-agentcanvas-plugin',
    '@agentcanvas/extension-sdk',
    '@agentcanvas/extension-testkit',
    'create-agentcanvas-extension'
  ]) {
    tarballs.set(workspace, packWorkspace(workspace));
  }

  const consumerDependencies = Object.fromEntries(
    [...tarballs].map(([name, tarball]) => [name, fileDependency(consumerDirectory, tarball)])
  );
  fs.writeFileSync(
    path.join(consumerDirectory, 'package.json'),
    `${JSON.stringify({ name: 'agentcanvas-extension-artifact-consumer', private: true, dependencies: consumerDependencies }, null, 2)}\n`
  );
  runNpm(['install', '--no-audit', '--no-fund'], consumerDirectory);
  run(node, [path.join(consumerDirectory, 'node_modules', 'create-agentcanvas-extension', 'dist', 'cli.js'), 'release-smoke'], consumerDirectory);

  const generatedDirectory = path.join(consumerDirectory, 'release-smoke');
  const generatedManifestPath = path.join(generatedDirectory, 'package.json');
  const generatedManifest = JSON.parse(fs.readFileSync(generatedManifestPath, 'utf8'));
  generatedManifest.dependencies['@agentcanvas/extension-sdk'] = fileDependency(
    generatedDirectory,
    tarballs.get('@agentcanvas/extension-sdk')
  );
  generatedManifest.dependencies['@agentcanvas/plugin-sdk'] = fileDependency(
    generatedDirectory,
    tarballs.get('@agentcanvas/plugin-sdk')
  );
  generatedManifest.devDependencies['@agentcanvas/extension-testkit'] = fileDependency(
    generatedDirectory,
    tarballs.get('@agentcanvas/extension-testkit')
  );
  generatedManifest.devDependencies['@agentcanvas/plugin-testkit'] = fileDependency(
    generatedDirectory,
    tarballs.get('@agentcanvas/plugin-testkit')
  );
  fs.writeFileSync(generatedManifestPath, `${JSON.stringify(generatedManifest, null, 2)}\n`);

  runNpm(['install', '--no-audit', '--no-fund'], generatedDirectory);
  runNpm(['test'], generatedDirectory);
  runNpm(['run', 'check'], generatedDirectory);
  runNpm(['run', 'pack:extension'], generatedDirectory);
  runNpm(['run', 'agentcanvas:verify'], generatedDirectory);
  process.stdout.write('Extension package artifact verification passed.\n');
} finally {
  fs.rmSync(workRoot, { recursive: true, force: true });
}
