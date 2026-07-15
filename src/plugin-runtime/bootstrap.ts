import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DatabaseSync } from 'node:sqlite';
import { ResourceBroker } from '../resources/broker.js';
import { activatePlugins, type FrozenPluginRegistry } from './registry.js';
import { discoverPlugins } from './discovery.js';
import { PluginRuntimeError } from './errors.js';
import { orderPlugins } from './ordering.js';
import {
  createDeferredPluginRuntimeServices,
  createPluginRuntimeServices,
  type RuntimePluginDiagnostics
} from './services.js';
import { satisfies } from './semver.js';
import { AGENTCANVAS_HOST_API_VERSION } from '../version.js';

export { AGENTCANVAS_HOST_API_VERSION } from '../version.js';

export const REQUIRED_PLUGIN_CAPABILITIES = Object.freeze({
  'agentcanvas.assets': '^1.0.0'
});

export interface RequiredCapabilityReadinessOptions {
  timeoutMs: number;
  retryIntervalMs: number;
  now?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
}

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

export async function assertRequiredPluginCapabilities(
  registry: FrozenPluginRegistry,
  options: RequiredCapabilityReadinessOptions
): Promise<void> {
  if (!Number.isSafeInteger(options.timeoutMs) || options.timeoutMs < 0) {
    throw new Error('required capability readiness timeout must be a non-negative integer');
  }
  if (!Number.isSafeInteger(options.retryIntervalMs) || options.retryIntervalMs < 1) {
    throw new Error('required capability readiness retry interval must be a positive integer');
  }
  const now = options.now ?? Date.now;
  const sleep =
    options.sleep ?? ((milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  const startedAt = now();
  const deadline = startedAt + options.timeoutMs;
  for (const [name, range] of Object.entries(REQUIRED_PLUGIN_CAPABILITIES)) {
    const provider = registry.capabilities[name];
    if (!provider || !satisfies(provider.version, range)) {
      throw new PluginRuntimeError('plugin_capability_invalid', `AgentCanvas requires capability ${name}@${range}`);
    }
    let attempts = 0;
    while (true) {
      attempts += 1;
      const readiness = await provider.readiness?.();
      if (!readiness || readiness.ok) break;
      const currentTime = now();
      if (!readiness.retryable || currentTime >= deadline) {
        throw new PluginRuntimeError(
          'plugin_capability_invalid',
          readiness.message ?? `Required capability ${name} is not ready`,
          {
            name,
            range,
            code: readiness.code,
            retryable: readiness.retryable,
            attempts,
            waitedMs: Math.max(0, currentTime - startedAt)
          }
        );
      }
      await sleep(Math.min(options.retryIntervalMs, deadline - currentTime));
    }
  }
}
