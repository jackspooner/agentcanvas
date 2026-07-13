import { readFile, realpath } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { assertContributionRegistrations, assertPluginManifestStructure, getManifestReferencedPaths } from '@agentcanvas/plugin-testkit';

const root = resolve(import.meta.dirname, '..');
const source = JSON.parse(await readFile(join(root, 'agentcanvas.plugin.json'), 'utf8'));
const distribution = join(root, 'plugin-dist', source.id);
const distributionReal = await realpath(distribution);
const manifest = JSON.parse(await readFile(join(distribution, 'agentcanvas.plugin.json'), 'utf8'));
assertPluginManifestStructure(manifest);
for (const path of getManifestReferencedPaths(manifest)) {
  const contained = relative(distributionReal, await realpath(join(distribution, path)));
  if (contained.startsWith('..') || isAbsolute(contained)) throw new Error(`Distribution path escapes: ${path}`);
}
const registrations = { elements: [], tools: [], procedures: [], migrations: [] };
const server = await import(pathToFileURL(join(distribution, manifest.entrypoints.server)).href);
await server.default.activate({
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
for (const path of ['src/server.mts', 'src/browser/entry.mts', 'src/contracts.ts']) {
  const content = await readFile(join(root, path), 'utf8');
  const imports = [...content.matchAll(/from\s+['\"]([^'\"]+)['\"]/g)].map((match) => match[1]);
  if (imports.some((specifier) => specifier.startsWith('..') || specifier.includes('/src/'))) {
    throw new Error(`Fixture uses a private or source-tree import in ${path}.`);
  }
}
process.stdout.write(`Verified external fixture ${manifest.id}\n`);
