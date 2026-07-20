import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DatabaseSync } from 'node:sqlite';
import type { ResourceBroker } from '../resources/broker.js';
import { activatePlugins, type FrozenPluginRegistry } from './registry.js';
import { discoverPlugins } from './discovery.js';
import { orderPlugins } from './ordering.js';
import {
  createDeferredPluginRuntimeServices,
  createPluginRuntimeServices,
  type RuntimePluginDiagnostics
} from './services.js';
import { AGENTCANVAS_HOST_API_VERSION } from '../version.js';
import { createHostCapabilitySet, HOST_CAPABILITY_VERSIONS } from './host-capabilities.js';

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
  const host = createHostCapabilitySet();
  const ordered = orderPlugins(discovered, AGENTCANVAS_HOST_API_VERSION, HOST_CAPABILITY_VERSIONS);
  const services = createPluginRuntimeServices(input.db);
  const registry = await activatePlugins(ordered, services, host.providers);
  host.imageSources.seal();
  return { registry, diagnostics: services.diagnosticsStore, pluginsRoot, resources: host.resources };
}

export async function preparePluginRuntime(pluginsRoot = defaultPluginsRoot()): Promise<PreparedPluginRuntime> {
  const resolvedRoot = path.resolve(pluginsRoot);
  const discovered = await discoverPlugins({ pluginsRoot: resolvedRoot });
  const host = createHostCapabilitySet();
  const ordered = orderPlugins(discovered, AGENTCANVAS_HOST_API_VERSION, HOST_CAPABILITY_VERSIONS);
  const services = createDeferredPluginRuntimeServices();
  const registry = await activatePlugins(ordered, services, host.providers);
  host.imageSources.seal();
  return {
    registry,
    diagnostics: services.diagnosticsStore,
    pluginsRoot: resolvedRoot,
    resources: host.resources,
    bindDatabase: services.bindDatabase
  };
}
