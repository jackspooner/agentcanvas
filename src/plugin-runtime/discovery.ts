import { lstat, readdir, readFile, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import type { JsonObject, PluginManifest } from '@agentcanvas/plugin-sdk';
import { PluginRuntimeError } from './errors.js';
import { deepFreeze } from './freeze.js';
import { validatePluginConfig, validatePluginManifest } from './manifest.js';

export interface DiscoveredPlugin {
  readonly manifest: PluginManifest;
  readonly root: string;
  readonly serverEntry: string;
  readonly browserEntry?: string;
  readonly config: Readonly<JsonObject>;
}

async function readBoundedJson(path: string, maxBytes: number): Promise<unknown> {
  const bytes = await readFile(path);
  if (bytes.byteLength > maxBytes)
    throw new PluginRuntimeError('plugin_manifest_invalid', `JSON file exceeds ${maxBytes} byte limit`);
  try {
    return JSON.parse(bytes.toString('utf8'));
  } catch {
    throw new PluginRuntimeError('plugin_manifest_invalid', 'Plugin JSON is malformed');
  }
}

function isContained(root: string, target: string): boolean {
  const rel = relative(root, target);
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel));
}

async function containedFile(root: string, declared: string): Promise<string> {
  if (
    declared.includes('\\') ||
    isAbsolute(declared) ||
    declared.split('/').some((part) => part === '..' || part === '.')
  ) {
    throw new PluginRuntimeError(
      'plugin_path_invalid',
      'Plugin path must be a contained slash-separated relative path'
    );
  }
  const candidate = resolve(root, ...declared.split('/'));
  let resolved: string;
  try {
    resolved = await realpath(candidate);
  } catch {
    throw new PluginRuntimeError('plugin_path_invalid', `Declared plugin file does not exist: ${declared}`);
  }
  if (!isContained(root, resolved) || !(await lstat(resolved)).isFile()) {
    throw new PluginRuntimeError('plugin_path_invalid', `Declared plugin file escapes its plugin root: ${declared}`);
  }
  return resolved;
}

export interface DiscoverPluginsOptions {
  pluginsRoot: string;
  maxManifestBytes?: number;
  maxConfigBytes?: number;
}

export async function discoverPluginDirectory(
  lexicalRoot: string,
  limits: Pick<DiscoverPluginsOptions, 'maxManifestBytes' | 'maxConfigBytes'> = {}
): Promise<DiscoveredPlugin> {
  const rootStat = await lstat(lexicalRoot);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    throw new PluginRuntimeError('plugin_path_invalid', 'Plugin root must be a real directory');
  }
  const root = await realpath(lexicalRoot);
  const manifestPath = await containedFile(root, 'agentcanvas.plugin.json');
  const manifest = validatePluginManifest(await readBoundedJson(manifestPath, limits.maxManifestBytes ?? 256 * 1024));
  const serverEntry = await containedFile(root, manifest.entrypoints.server);
  const browserEntry = manifest.entrypoints.browser
    ? await containedFile(root, manifest.entrypoints.browser)
    : undefined;
  let config: JsonObject = {};
  if (manifest.configuration) {
    const schemaPath = await containedFile(root, manifest.configuration.schema);
    const configPath = await containedFile(root, manifest.configuration.file);
    const schema = await readBoundedJson(schemaPath, limits.maxConfigBytes ?? 256 * 1024);
    const rawConfig = await readBoundedJson(configPath, limits.maxConfigBytes ?? 256 * 1024);
    config = validatePluginConfig(schema as JsonObject, rawConfig, manifest.id);
  }
  return Object.freeze({
    manifest: deepFreeze(manifest),
    root,
    serverEntry,
    browserEntry,
    config: deepFreeze(config)
  });
}

export async function discoverPlugins(options: DiscoverPluginsOptions): Promise<readonly DiscoveredPlugin[]> {
  const pluginsRoot = await realpath(options.pluginsRoot);
  const entries = (await readdir(pluginsRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules')
    .sort((left, right) => left.name.localeCompare(right.name));
  const discovered: DiscoveredPlugin[] = [];
  for (const entry of entries) {
    const lexicalRoot = resolve(pluginsRoot, entry.name);
    const rootStat = await lstat(lexicalRoot);
    const root = await realpath(lexicalRoot);
    if (rootStat.isSymbolicLink() || !isContained(pluginsRoot, root) || dirname(root) !== pluginsRoot) {
      throw new PluginRuntimeError(
        'plugin_path_invalid',
        `Plugin root ${entry.name} must be a direct, non-linked child`
      );
    }
    discovered.push(
      await discoverPluginDirectory(root, {
        maxManifestBytes: options.maxManifestBytes,
        maxConfigBytes: options.maxConfigBytes
      })
    );
  }
  return Object.freeze(discovered);
}
