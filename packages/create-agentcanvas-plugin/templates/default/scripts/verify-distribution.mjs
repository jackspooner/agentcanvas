import { lstat, readFile, realpath, readdir } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  assertContributionRegistrations,
  assertDistributionArtifacts,
  assertPluginManifestStructure,
  getManifestReferencedPaths
} from '@agentcanvas/extension-testkit';

const root = resolve(import.meta.dirname, '..');
const sourceManifest = JSON.parse(await readFile(join(root, 'agentcanvas.plugin.json'), 'utf8'));
const distribution = join(root, 'plugin-dist', sourceManifest.id);
const manifestPath = join(distribution, 'agentcanvas.plugin.json');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
assertPluginManifestStructure(manifest);

async function distributionFiles(directory, base = directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await distributionFiles(path, base));
    else if (entry.isFile()) result.push(relative(base, path).replaceAll('\\', '/'));
  }
  return result;
}

assertDistributionArtifacts(await distributionFiles(distribution));

const distributionRealPath = await realpath(distribution);
for (const declaredPath of getManifestReferencedPaths(manifest)) {
  if (isAbsolute(declaredPath)) throw new Error(`Absolute manifest path: ${declaredPath}`);
  const candidate = join(distribution, declaredPath);
  const candidateRealPath = await realpath(candidate);
  const containment = relative(distributionRealPath, candidateRealPath);
  if (containment.startsWith('..') || isAbsolute(containment)) throw new Error(`Manifest path escapes distribution: ${declaredPath}`);
  if (!(await lstat(candidateRealPath)).isFile()) throw new Error(`Manifest path is not a file: ${declaredPath}`);
}

const registrations = { elements: [], tools: [], procedures: [], migrations: [] };
const serverModule = await import(pathToFileURL(join(distribution, manifest.entrypoints.server)).href);
await serverModule.default.activate({
  registerElementType(value) { registrations.elements.push(value.name); },
  registerTool(value) { registrations.tools.push(value.name); },
  registerProcedure(value) { registrations.procedures.push(value.name); },
  registerMigration(value) { registrations.migrations.push(value.name); },
  provideCapability() { throw new Error('Unexpected capability provider.'); },
  consumeCapability() { throw new Error('Unexpected capability consumer.'); },
  config: JSON.parse(await readFile(join(distribution, manifest.configuration.file), 'utf8')),
  kv: { get: async () => undefined, set: async () => {}, delete: async () => false, list: async () => ({ entries: [] }) },
  diagnostics: { emit() {} }
});
assertContributionRegistrations(manifest.contributes, registrations);

const browserModule = await import(pathToFileURL(join(distribution, manifest.entrypoints.browser)).href);
const commands = [];
await browserModule.default.activate({
  registerRenderer() {},
  registerCommand(value) { commands.push(value.name); }
});
assertContributionRegistrations(manifest.contributes, { ...registrations, commands });

async function sourceFiles(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await sourceFiles(path));
    else if (entry.isFile() && /\.(?:m?js|m?ts)$/.test(entry.name)) result.push(path);
  }
  return result;
}

for (const directory of [join(root, 'src'), join(distribution, 'dist')]) {
  for (const path of await sourceFiles(directory)) {
    const text = await readFile(path, 'utf8');
    if (/from\s+['\"](?:\.\.\/)+(?:src|packages|plugin-packages)\//.test(text) || text.includes('/src/private/')) {
      throw new Error(`Private AgentCanvas import in ${path}`);
    }
  }
}
process.stdout.write(`Verified ${manifest.id} ${manifest.version}\n`);
