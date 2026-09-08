import { existsSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
const sourceRoot = join(root, 'plugin-packages');
const catalogRoot = join(root, 'dist', 'plugin-catalog');
const glbPluginId = 'agentcanvas.glb-viewer';
const requiredRootArtifacts = ['agentcanvas.plugin.json', 'README.md', 'LICENSE'];

async function visibleDirectories(directory) {
  if (!existsSync(directory)) throw new Error(`Required directory does not exist: ${relative(root, directory)}`);
  return (await readdir(directory, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules')
    .map((entry) => join(directory, entry.name))
    .sort();
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

async function assertReadableArtifact(directory, artifact) {
  const path = join(directory, artifact);
  if (!existsSync(path)) throw new Error(`${relative(root, directory)} is missing ${artifact}`);
  if ((await readFile(path, 'utf8')).trim().length === 0) {
    throw new Error(`${relative(root, path)} must not be empty`);
  }
}

async function assertPluginArtifacts(directory, requireThirdPartyNotices) {
  const manifest = await readJson(join(directory, 'agentcanvas.plugin.json'));
  for (const artifact of requiredRootArtifacts) await assertReadableArtifact(directory, artifact);
  if (requireThirdPartyNotices) await assertReadableArtifact(directory, 'THIRD_PARTY_NOTICES.md');
  const license = await readFile(join(directory, 'LICENSE'), 'utf8');
  if (manifest.license === 'MIT' && !license.includes('MIT License')) {
    throw new Error(`${relative(root, directory)} declares MIT but LICENSE does not contain the MIT License`);
  }
  return manifest;
}

function resolveInstalledPackageJson(name, fromPackageJson) {
  let directory = dirname(fromPackageJson);
  const packageSegments = name.split('/');
  while (true) {
    const candidate = join(directory, 'node_modules', ...packageSegments, 'package.json');
    if (existsSync(candidate)) return candidate;
    const parent = dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  throw new Error(`Cannot resolve installed dependency ${name} from ${relative(root, fromPackageJson)}`);
}

async function productionDependencyClosure(rootDependency, fromPackageJson) {
  const pending = [{ name: rootDependency, packageJson: resolveInstalledPackageJson(rootDependency, fromPackageJson) }];
  const packages = new Map();
  while (pending.length > 0) {
    const next = pending.pop();
    const metadata = await readJson(next.packageJson);
    const identity = `${metadata.name}@${metadata.version}`;
    if (packages.has(identity)) continue;
    packages.set(identity, {
      name: metadata.name,
      version: metadata.version,
      license: metadata.license,
      packageJson: next.packageJson
    });
    const dependencies = {
      ...metadata.dependencies,
      ...metadata.optionalDependencies,
      ...metadata.peerDependencies
    };
    for (const dependencyName of Object.keys(dependencies).sort().reverse()) {
      pending.push({
        name: dependencyName,
        packageJson: resolveInstalledPackageJson(dependencyName, next.packageJson)
      });
    }
  }
  return [...packages.values()].sort((left, right) => left.name.localeCompare(right.name));
}

const requiredNoticeMarkers = new Map([
  ['@google/model-viewer', 'Apache License'],
  ['@lit/reactive-element', 'Copyright (c) 2017 Google LLC'],
  ['@lit-labs/ssr-dom-shim', 'Copyright (c) 2017 Google LLC'],
  ['@monogrid/gainmap-js', 'Copyright (c) 2023 MONOGRID'],
  ['@types/trusted-types', 'Copyright (c) Microsoft Corporation'],
  ['immediate', 'Copyright (c) 2012 Barnesandnoble.com'],
  ['is-promise', 'Copyright (c) 2014 Forbes Lindesay'],
  ['lie', 'Copyright (c) 2014-2018 Calvin Metcalf'],
  ['lit', 'Copyright (c) 2017 Google LLC'],
  ['lit-element', 'Copyright (c) 2017 Google LLC'],
  ['lit-html', 'Copyright (c) 2017 Google LLC'],
  ['promise-worker-transferable', 'Apache License'],
  ['three', 'Copyright © 2010-2026 three.js authors']
]);

async function assertThirdPartyNotice(directory, dependencies) {
  const noticePath = join(directory, 'THIRD_PARTY_NOTICES.md');
  const notice = await readFile(noticePath, 'utf8');
  for (const dependency of dependencies) {
    const tableRow = `| \`${dependency.name}\` | ${dependency.version} | ${dependency.license} |`;
    if (!notice.includes(tableRow)) {
      throw new Error(`${relative(root, noticePath)} is missing dependency row: ${tableRow}`);
    }
    const marker = requiredNoticeMarkers.get(dependency.name);
    if (!marker) {
      throw new Error(`No third-party license marker is defined for bundled dependency ${dependency.name}`);
    }
    if (!notice.includes(marker)) {
      throw new Error(`${relative(root, noticePath)} is missing license text for ${dependency.name}`);
    }
  }
}

const sourceDirectories = await visibleDirectories(sourceRoot);
const sourceById = new Map();
for (const directory of sourceDirectories) {
  const manifest = await assertPluginArtifacts(directory, false);
  if (sourceById.has(manifest.id)) throw new Error(`Duplicate source plugin ID ${manifest.id}`);
  sourceById.set(manifest.id, directory);
}

const glbSource = sourceById.get(glbPluginId);
if (!glbSource) throw new Error(`Missing source plugin ${glbPluginId}`);
await assertPluginArtifacts(glbSource, true);
const glbPackageJson = join(glbSource, 'package.json');
const glbPackage = await readJson(glbPackageJson);
if (!glbPackage.dependencies?.['@google/model-viewer']) {
  throw new Error('GLB viewer no longer declares @google/model-viewer; update third-party verification ownership');
}
const bundledDependencies = await productionDependencyClosure('@google/model-viewer', glbPackageJson);
await assertThirdPartyNotice(glbSource, bundledDependencies);

const catalogDirectories = await visibleDirectories(catalogRoot);
execFileSync(process.execPath, [join(sourceRoot, 'diagrams', 'scripts', 'generate-notices.mjs'), '--check'], { stdio: 'inherit' });
const catalogIds = new Set();
for (const directory of catalogDirectories) {
  const manifest = await assertPluginArtifacts(directory, false);
  catalogIds.add(manifest.id);
  if (!sourceById.has(manifest.id)) throw new Error(`Catalog contains unknown first-party plugin ${manifest.id}`);
  if (manifest.id === glbPluginId) {
    await assertPluginArtifacts(directory, true);
    await assertThirdPartyNotice(directory, bundledDependencies);
  }
  if (manifest.id === 'agentcanvas.diagrams') {
    await assertPluginArtifacts(directory, true);
    if (await readFile(join(directory, 'THIRD_PARTY_NOTICES.md'), 'utf8') !== await readFile(join(sourceRoot, 'diagrams', 'THIRD_PARTY_NOTICES.md'), 'utf8'))
      throw new Error('Catalog Diagrams notices differ from source notices. Rebuild the catalog.');
  }
}
for (const pluginId of sourceById.keys()) {
  if (!catalogIds.has(pluginId)) throw new Error(`Catalog is missing first-party plugin ${pluginId}`);
}

process.stdout.write(
  `Verified licenses for ${sourceById.size} plugin sources, ${catalogIds.size} catalog distributions, and ${bundledDependencies.length} bundled GLB dependencies.\n`
);
