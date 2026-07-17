import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DatabaseSync } from 'node:sqlite';
import { ResourceBroker } from '../resources/broker.js';
import { activatePlugins, type FrozenPluginRegistry } from './registry.js';
import { discoverPlugins } from './discovery.js';
import { orderPlugins } from './ordering.js';
import {
  createDeferredPluginRuntimeServices,
  createPluginRuntimeServices,
  type RuntimePluginDiagnostics
} from './services.js';
import { AGENTCANVAS_HOST_API_VERSION } from '../version.js';

export { AGENTCANVAS_HOST_API_VERSION } from '../version.js';

export interface LoadedPluginRuntime {
  registry: FrozenPluginRegistry;
  diagnostics: RuntimePluginDiagnostics;
  pluginsRoot: string;
  resources: ResourceBroker;
}

export interface PreparedPluginRuntime extends LoadedPluginRuntime {
  bindDatabase(db: DatabaseSync): void;
}

export function defaultPluginsRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'plugins');
}

export async function loadPluginRuntime(input: {
  db: DatabaseSync;
  pluginsRoot?: string;
}): Promise<LoadedPluginRuntime> {
  const pluginsRoot = path.resolve(input.pluginsRoot ?? defaultPluginsRoot());
  const discovered = await discoverPlugins({ pluginsRoot });
  const resources = new ResourceBroker();
  const ordered = orderPlugins(discovered, AGENTCANVAS_HOST_API_VERSION, {
    'agentcanvas.snapshot-resources': '1.0.0'
  });
  const services = createPluginRuntimeServices(input.db);
  const registry = await activatePlugins(ordered, services, [
    { name: 'agentcanvas.snapshot-resources', version: '1.0.0', value: resources }
  ]);
  return { registry, diagnostics: services.diagnosticsStore, pluginsRoot, resources };
}

export async function preparePluginRuntime(pluginsRoot = defaultPluginsRoot()): Promise<PreparedPluginRuntime> {
  const resolvedRoot = path.resolve(pluginsRoot);
  const discovered = await discoverPlugins({ pluginsRoot: resolvedRoot });
  const resources = new ResourceBroker();
  const ordered = orderPlugins(discovered, AGENTCANVAS_HOST_API_VERSION, {
    'agentcanvas.snapshot-resources': '1.0.0'
  });
  const services = createDeferredPluginRuntimeServices();
  const registry = await activatePlugins(ordered, services, [
    { name: 'agentcanvas.snapshot-resources', version: '1.0.0', value: resources }
  ]);
  return {
    registry,
    diagnostics: services.diagnosticsStore,
    pluginsRoot: resolvedRoot,
    resources,
    bindDatabase: services.bindDatabase
  };
}
