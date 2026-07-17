import { createHash } from 'node:crypto';
import { lstat, readFile, readdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import type { PluginManifest } from '@agentcanvas/plugin-sdk';
import type { FrozenPluginRegistry } from './registry.js';
import { PluginRuntimeError } from './errors.js';

export interface BrowserPluginCatalogEntry {
  id: string;
  version: string;
  displayName: string;
  description: string;
  hostApi: string;
  browserEntryUrl: string | null;
  browserBuildHash: string | null;
  elements: readonly { type: string; schemaVersion: number; browser: boolean; snapshot: string }[];
  commands: readonly string[];
  tools: readonly string[];
  procedures: readonly string[];
  requires: {
    plugins: Readonly<Record<string, string>>;
    capabilities: Readonly<Record<string, string>>;
  };
  provides: { capabilities: Readonly<Record<string, string>> };
}

interface BrowserModuleRecord {
  pluginId: string;
  root: string;
  entryRelativePath: string;
  buildHash: string;
}

export interface BrowserPluginCatalog {
  entries: readonly BrowserPluginCatalogEntry[];
  modules: ReadonlyMap<string, BrowserModuleRecord>;
}

async function listFiles(root: string, current = root): Promise<string[]> {
  const entries = await readdir(current, { withFileTypes: true });
  const result: string[] = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const candidate = path.join(current, entry.name);
    const stat = await lstat(candidate);
    if (stat.isSymbolicLink())
      throw new PluginRuntimeError('plugin_path_invalid', 'Browser bundle cannot contain links');
    if (entry.isDirectory()) result.push(...(await listFiles(root, candidate)));
    else if (entry.isFile()) result.push(path.relative(root, candidate).split(path.sep).join('/'));
  }
  return result;
}

async function browserRecord(pluginId: string, browserEntry: string): Promise<BrowserModuleRecord> {
  const root = await realpath(path.dirname(browserEntry));
  const entry = await realpath(browserEntry);
  const entryRelativePath = path.relative(root, entry).split(path.sep).join('/');
  const files = await listFiles(root);
  const hash = createHash('sha256');
  for (const relativePath of files) {
    const bytes = await readFile(path.join(root, ...relativePath.split('/')));
    hash.update(relativePath);
    hash.update('\0');
    hash.update(bytes);
  }
  return { pluginId, root, entryRelativePath, buildHash: hash.digest('hex').slice(0, 24) };
}

function sanitizedEntry(manifest: PluginManifest, record?: BrowserModuleRecord): BrowserPluginCatalogEntry {
  return Object.freeze({
    id: manifest.id,
    version: manifest.version,
    displayName: manifest.displayName,
    description: manifest.description,
    hostApi: manifest.requires.hostApi,
    browserEntryUrl: record
      ? `/api/v1/plugin-modules/${encodeURIComponent(manifest.id)}/${record.buildHash}/${record.entryRelativePath}`
      : null,
    browserBuildHash: record?.buildHash ?? null,
    elements: Object.freeze(
      manifest.contributes.elements.map((element) =>
        Object.freeze({
          type: `${manifest.id}/${element.name}`,
          schemaVersion: element.schemaVersion,
          browser: element.browser,
          snapshot: element.snapshot
        })
      )
    ),
    commands: Object.freeze([...(manifest.contributes.commands ?? [])]),
    tools: Object.freeze([...manifest.contributes.tools]),
    procedures: Object.freeze([...manifest.contributes.procedures]),
    requires: Object.freeze({
      plugins: Object.freeze({ ...manifest.requires.plugins }),
      capabilities: Object.freeze({ ...manifest.requires.capabilities })
    }),
    provides: Object.freeze({ capabilities: Object.freeze({ ...manifest.provides.capabilities }) })
  });
}

export async function createBrowserPluginCatalog(registry: FrozenPluginRegistry): Promise<BrowserPluginCatalog> {
  const modules = new Map<string, BrowserModuleRecord>();
  const entries: BrowserPluginCatalogEntry[] = [];
  for (const activated of registry.plugins) {
    const discovered = activated.plugin;
    const record = discovered.browserEntry
      ? await browserRecord(discovered.manifest.id, discovered.browserEntry)
      : undefined;
    if (record) modules.set(discovered.manifest.id, record);
    entries.push(sanitizedEntry(discovered.manifest, record));
  }
  return Object.freeze({
    entries: Object.freeze(entries),
    modules: modules as ReadonlyMap<string, BrowserModuleRecord>
  });
}

function contained(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

export async function resolveBrowserPluginModule(
  catalog: BrowserPluginCatalog,
  pluginId: string,
  buildHash: string,
  relativePath: string
): Promise<{ filePath: string; contentType: string }> {
  const record = catalog.modules.get(pluginId);
  if (!record || record.buildHash !== buildHash)
    throw new PluginRuntimeError('plugin_path_invalid', 'Browser plugin module was not found');
  if (
    !relativePath ||
    relativePath.includes('\\') ||
    relativePath.split('/').some((part) => !part || part === '.' || part === '..')
  )
    throw new PluginRuntimeError('plugin_path_invalid', 'Browser plugin module path is invalid');
  const candidate = path.resolve(record.root, ...relativePath.split('/'));
  const resolved = await realpath(candidate);
  if (!contained(record.root, resolved) || !(await lstat(resolved)).isFile())
    throw new PluginRuntimeError('plugin_path_invalid', 'Browser plugin module path escapes the bundle');
  const extension = path.extname(resolved).toLowerCase();
  const contentType =
    extension === '.mjs' || extension === '.js'
      ? 'text/javascript; charset=utf-8'
      : extension === '.css'
        ? 'text/css; charset=utf-8'
        : extension === '.json'
          ? 'application/json; charset=utf-8'
          : extension === '.svg'
            ? 'image/svg+xml'
            : extension === '.png'
              ? 'image/png'
              : extension === '.webp'
                ? 'image/webp'
                : extension === '.woff2'
                  ? 'font/woff2'
                  : 'application/octet-stream';
  return { filePath: resolved, contentType };
}
