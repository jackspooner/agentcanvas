import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { discoverPluginDirectory, discoverPlugins, orderPlugins } from '../plugin-runtime/index.js';
import { AGENTCANVAS_HOST_API_VERSION } from '../version.js';

const HOST_CAPABILITIES = { 'agentcanvas.snapshot-resources': '1.0.0' } as const;
const DEFAULT_PLUGIN_IDS = ['agentcanvas.primitives', 'agentcanvas.markdown', 'agentcanvas.table'] as const;

export async function assertAgentCanvasStopped(
  fetcher: typeof fetch = globalThis.fetch,
  publicBaseUrl = process.env.AGENT_CANVAS_PUBLIC_BASE_URL ??
    `http://127.0.0.1:${process.env.AGENT_CANVAS_PORT ?? '23003'}`
): Promise<void> {
  try {
    const response = await fetcher(new URL('/whoami', publicBaseUrl), { signal: AbortSignal.timeout(750) });
    if (!response.ok) return;
    const identity = (await response.json()) as { service?: unknown };
    if (identity.service === 'AgentCanvas') {
      throw new Error('AgentCanvas must be stopped before disabling or replacing a runtime plugin');
    }
  } catch (error) {
    if (
      error instanceof TypeError ||
      (error instanceof DOMException && ['AbortError', 'TimeoutError'].includes(error.name))
    ) {
      return;
    }
    throw error;
  }
}

function installationRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
}

function assertDirectChild(parent: string, child: string): void {
  const resolvedParent = path.resolve(parent);
  const resolvedChild = path.resolve(child);
  if (path.dirname(resolvedChild) !== resolvedParent)
    throw new Error(`path is not a direct child of ${resolvedParent}`);
}

function visibleDirectories(root: string): string[] {
  if (!fs.existsSync(root)) return [];
  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules')
    .map((entry) => path.join(root, entry.name))
    .sort();
}

async function copyDistribution(source: string, destination: string): Promise<void> {
  const sourcePlugin = await discoverPluginDirectory(source);
  if (fs.existsSync(destination)) throw new Error(`plugin is already installed: ${sourcePlugin.manifest.id}`);
  const parent = path.dirname(destination);
  fs.mkdirSync(parent, { recursive: true });
  const stage = path.join(parent, `.staging-${sourcePlugin.manifest.id}-${randomUUID()}`);
  assertDirectChild(parent, stage);
  try {
    fs.cpSync(sourcePlugin.root, stage, { recursive: true, dereference: false, errorOnExist: true });
    const stagedPlugin = await discoverPluginDirectory(stage);
    if (
      stagedPlugin.manifest.id !== sourcePlugin.manifest.id ||
      stagedPlugin.manifest.version !== sourcePlugin.manifest.version
    ) {
      throw new Error('staged plugin identity changed during installation');
    }
    fs.renameSync(stage, destination);
  } catch (error) {
    if (fs.existsSync(stage)) fs.rmSync(stage, { recursive: true, force: true });
    throw error;
  }
}

export async function buildPluginCatalog(root = installationRoot()): Promise<readonly string[]> {
  const sourceRoot = path.join(root, 'plugin-packages');
  const catalogRoot = path.join(root, 'dist', 'plugin-catalog');
  fs.mkdirSync(catalogRoot, { recursive: true });
  const built: string[] = [];
  for (const source of visibleDirectories(sourceRoot)) {
    const plugin = await discoverPluginDirectory(source);
    const destination = path.join(catalogRoot, plugin.manifest.id);
    assertDirectChild(catalogRoot, destination);
    if (fs.existsSync(destination)) fs.rmSync(destination, { recursive: true, force: true });
    fs.mkdirSync(destination, { recursive: false });
    fs.copyFileSync(path.join(source, 'agentcanvas.plugin.json'), path.join(destination, 'agentcanvas.plugin.json'));
    fs.cpSync(path.join(source, 'dist'), path.join(destination, 'dist'), { recursive: true });
    for (const optional of [
      'README.md',
      'LICENSE',
      'LICENSE.md',
      'THIRD_PARTY_NOTICES.md',
      'plugin.config.json',
      'schemas'
    ]) {
      const candidate = path.join(source, optional);
      if (!fs.existsSync(candidate)) continue;
      const target = path.join(destination, optional);
      const stat = fs.statSync(candidate);
      if (stat.isDirectory()) fs.cpSync(candidate, target, { recursive: true });
      else fs.copyFileSync(candidate, target);
    }
    await discoverPluginDirectory(destination);
    built.push(plugin.manifest.id);
  }
  const catalog = await discoverPlugins({ pluginsRoot: catalogRoot });
  orderPlugins(catalog, AGENTCANVAS_HOST_API_VERSION, HOST_CAPABILITIES);
  return Object.freeze(built.sort());
}

export async function installPluginDistribution(sourcePath: string, root = installationRoot()): Promise<string> {
  const source = path.resolve(sourcePath);
  const plugin = await discoverPluginDirectory(source);
  const pluginsRoot = path.join(root, 'plugins');
  const destination = path.join(pluginsRoot, plugin.manifest.id);
  assertDirectChild(pluginsRoot, destination);
  await copyDistribution(source, destination);
  orderPlugins(await discoverPlugins({ pluginsRoot }), AGENTCANVAS_HOST_API_VERSION, HOST_CAPABILITIES);
  return plugin.manifest.id;
}

export async function materializeDefaultPlugins(root = installationRoot()): Promise<readonly string[]> {
  const catalogRoot = path.join(root, 'dist', 'plugin-catalog');
  const pluginsRoot = path.join(root, 'plugins');
  fs.mkdirSync(pluginsRoot, { recursive: true });
  const installed: string[] = [];
  for (const id of DEFAULT_PLUGIN_IDS) {
    const source = path.join(catalogRoot, id);
    if (!fs.existsSync(source)) throw new Error(`default plugin is missing from the catalog: ${id}`);
    const existing = path.join(pluginsRoot, id);
    if (fs.existsSync(existing)) {
      const [catalogPlugin, activePlugin] = await Promise.all([
        discoverPluginDirectory(source),
        discoverPluginDirectory(existing)
      ]);
      if (catalogPlugin.manifest.version !== activePlugin.manifest.version) {
        throw new Error(
          `${id} is already active at ${activePlugin.manifest.version}; disable it before materializing ${catalogPlugin.manifest.version}`
        );
      }
      continue;
    }
    await copyDistribution(source, existing);
    installed.push(id);
  }
  orderPlugins(await discoverPlugins({ pluginsRoot }), AGENTCANVAS_HOST_API_VERSION, HOST_CAPABILITIES);
  return Object.freeze(installed);
}

export async function disablePlugin(pluginId: string, root = installationRoot()): Promise<string> {
  await assertAgentCanvasStopped();
  if (!/^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/.test(pluginId)) throw new Error('invalid plugin ID');
  const pluginsRoot = path.join(root, 'plugins');
  const source = path.join(pluginsRoot, pluginId);
  assertDirectChild(pluginsRoot, source);
  const plugin = await discoverPluginDirectory(source);
  if (plugin.manifest.id !== pluginId) throw new Error(`runtime folder ${pluginId} contains ${plugin.manifest.id}`);
  const disabledRoot = path.join(root, 'plugins-disabled');
  fs.mkdirSync(disabledRoot, { recursive: true });
  const destination = path.join(disabledRoot, `${pluginId}.${new Date().toISOString().replaceAll(':', '-')}`);
  assertDirectChild(disabledRoot, destination);
  fs.renameSync(source, destination);
  return destination;
}

export async function verifyPlugins(root = installationRoot()): Promise<{
  active: readonly string[];
  catalog: readonly string[];
}> {
  const pluginsRoot = path.join(root, 'plugins');
  const catalogRoot = path.join(root, 'dist', 'plugin-catalog');
  const active = await discoverPlugins({ pluginsRoot });
  const catalog = await discoverPlugins({ pluginsRoot: catalogRoot });
  orderPlugins(active, AGENTCANVAS_HOST_API_VERSION, HOST_CAPABILITIES);
  orderPlugins(catalog, AGENTCANVAS_HOST_API_VERSION, HOST_CAPABILITIES);
  return {
    active: Object.freeze(active.map((plugin) => `${plugin.manifest.id}@${plugin.manifest.version}`)),
    catalog: Object.freeze(catalog.map((plugin) => `${plugin.manifest.id}@${plugin.manifest.version}`))
  };
}

export async function runPluginCli(args: string[], stdout: (value: string) => void = console.log): Promise<void> {
  const [command, ...rest] = args;
  if (command === 'catalog') stdout(JSON.stringify(await buildPluginCatalog(), null, 2));
  else if (command === 'list') stdout(JSON.stringify((await verifyPlugins()).active, null, 2));
  else if (command === 'materialize' && rest.includes('--defaults')) {
    stdout(JSON.stringify(await materializeDefaultPlugins(), null, 2));
  } else if (command === 'install' && rest[0]) stdout(await installPluginDistribution(rest[0]));
  else if (command === 'disable' && rest[0]) stdout(await disablePlugin(rest[0]));
  else if (command === 'verify') stdout(JSON.stringify(await verifyPlugins(), null, 2));
  else {
    throw new Error(
      'Usage: plugins <catalog|list|materialize --defaults|install <distribution>|disable <plugin-id>|verify>'
    );
  }
}
