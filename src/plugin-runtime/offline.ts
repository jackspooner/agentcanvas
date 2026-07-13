import path from 'node:path';
import type { JsonValue, NamespacedPluginKv, PluginDiagnostics } from '@agentcanvas/plugin-sdk';
import { isJsonValue } from '@agentcanvas/plugin-sdk';
import { ResourceBroker } from '../resources/broker.js';
import { AGENTCANVAS_HOST_API_VERSION, defaultPluginsRoot } from './bootstrap.js';
import { discoverPlugins } from './discovery.js';
import { orderPlugins } from './ordering.js';
import { activatePlugins, type FrozenPluginRegistry, type PluginRuntimeServices } from './registry.js';

function offlineServices(): PluginRuntimeServices {
  const values = new Map<string, Map<string, JsonValue>>();
  return {
    kv: (pluginId): NamespacedPluginKv => {
      const entries = values.get(pluginId) ?? new Map<string, JsonValue>();
      values.set(pluginId, entries);
      return {
        get: async (key) => entries.get(key),
        set: async (key, value) => {
          if (!isJsonValue(value)) throw new Error('offline plugin KV accepts JSON values only');
          entries.set(key, structuredClone(value));
        },
        delete: async (key) => entries.delete(key),
        list: async (options = {}) => {
          const limit = Math.min(Math.max(options.limit ?? 50, 1), 100);
          const selected = [...entries]
            .filter(([key]) => key.startsWith(options.prefix ?? '') && key > (options.cursor ?? ''))
            .sort(([left], [right]) => left.localeCompare(right));
          const page = selected.slice(0, limit);
          return {
            entries: page.map(([key, value]) => ({ key, value: structuredClone(value) })),
            ...(selected.length > limit && page.length ? { nextCursor: page[page.length - 1][0] } : {})
          };
        }
      };
    },
    diagnostics: (): PluginDiagnostics => ({ emit: () => undefined })
  };
}

export async function loadOfflinePluginRegistry(
  options: { pluginsRoot?: string; pluginIds?: readonly string[] } = {}
): Promise<{ registry: FrozenPluginRegistry; resources: ResourceBroker }> {
  const root = path.resolve(options.pluginsRoot ?? defaultPluginsRoot());
  const all = await discoverPlugins({ pluginsRoot: root });
  const selected = options.pluginIds ? all.filter((plugin) => options.pluginIds?.includes(plugin.manifest.id)) : all;
  if (options.pluginIds) {
    const present = new Set(selected.map((plugin) => plugin.manifest.id));
    const missing = options.pluginIds.filter((id) => !present.has(id));
    if (missing.length) throw new Error(`offline plugin registry is missing: ${missing.join(', ')}`);
  }
  const resources = new ResourceBroker();
  const ordered = orderPlugins(selected, AGENTCANVAS_HOST_API_VERSION, {
    'agentcanvas.snapshot-resources': '1.0.0'
  });
  const registry = await activatePlugins(ordered, offlineServices(), [
    { name: 'agentcanvas.snapshot-resources', version: '1.0.0', value: resources }
  ]);
  return { registry, resources };
}
