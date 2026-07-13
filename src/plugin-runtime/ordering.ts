import { deriveToolName } from '@agentcanvas/plugin-sdk';
import type { DiscoveredPlugin } from './discovery.js';
import { PluginRuntimeError } from './errors.js';
import { isVersion, isVersionRange, satisfies } from './semver.js';

export function orderPlugins(
  plugins: readonly DiscoveredPlugin[],
  hostApiVersion: string,
  hostCapabilities: Readonly<Record<string, string>> = {}
): readonly DiscoveredPlugin[] {
  if (!isVersion(hostApiVersion))
    throw new PluginRuntimeError('plugin_dependency_invalid', 'Host API version is invalid');
  const byId = new Map<string, DiscoveredPlugin>();
  const providers = new Map<string, { plugin?: DiscoveredPlugin; version: string }>(
    Object.entries(hostCapabilities).map(([name, version]) => [name, { version }])
  );
  const toolNames = new Map<string, string>();
  for (const plugin of plugins) {
    const { manifest } = plugin;
    if (byId.has(manifest.id))
      throw new PluginRuntimeError('plugin_dependency_invalid', `Duplicate plugin ID ${manifest.id}`);
    if (!satisfies(hostApiVersion, manifest.requires.hostApi))
      throw new PluginRuntimeError(
        'plugin_dependency_invalid',
        `${manifest.id} requires host API ${manifest.requires.hostApi}`
      );
    byId.set(manifest.id, plugin);
    for (const capability of Object.keys(manifest.provides.capabilities)) {
      const prior = providers.get(capability);
      if (prior)
        throw new PluginRuntimeError(
          'plugin_capability_invalid',
          `Capability ${capability} has multiple providers: ${prior.plugin?.manifest.id ?? 'host'}, ${manifest.id}`
        );
      providers.set(capability, { plugin, version: manifest.provides.capabilities[capability] });
    }
    for (const localName of manifest.contributes.tools) {
      const globalName = deriveToolName(manifest.id, localName);
      const prior = toolNames.get(globalName);
      if (prior)
        throw new PluginRuntimeError(
          'plugin_dependency_invalid',
          `Tool name collision ${globalName}: ${prior}, ${manifest.id}`
        );
      toolNames.set(globalName, manifest.id);
    }
  }
  const dependencies = new Map<string, Set<string>>([...byId.keys()].map((id) => [id, new Set()]));
  for (const plugin of plugins) {
    for (const [dependencyId, range] of Object.entries(plugin.manifest.requires.plugins)) {
      const dependency = byId.get(dependencyId);
      if (!dependency || !isVersionRange(range) || !satisfies(dependency.manifest.version, range)) {
        throw new PluginRuntimeError(
          'plugin_dependency_invalid',
          `${plugin.manifest.id} has unsatisfied plugin dependency ${dependencyId}@${range}`
        );
      }
      dependencies.get(plugin.manifest.id)?.add(dependencyId);
    }
    for (const [capability, range] of Object.entries(plugin.manifest.requires.capabilities)) {
      const provider = providers.get(capability);
      if (!provider || !isVersionRange(range) || !satisfies(provider.version, range)) {
        throw new PluginRuntimeError(
          'plugin_capability_invalid',
          `${plugin.manifest.id} has unsatisfied capability ${capability}@${range}`
        );
      }
      if (provider.plugin && provider.plugin.manifest.id !== plugin.manifest.id) {
        dependencies.get(plugin.manifest.id)?.add(provider.plugin.manifest.id);
      }
    }
  }
  const result: DiscoveredPlugin[] = [];
  const remaining = new Map([...dependencies].map(([id, set]) => [id, new Set(set)]));
  while (remaining.size) {
    const ready = [...remaining]
      .filter(([, deps]) => deps.size === 0)
      .map(([id]) => id)
      .sort();
    if (!ready.length) {
      const cycle = [...remaining.keys()].sort();
      throw new PluginRuntimeError('plugin_dependency_invalid', `Plugin dependency cycle: ${cycle.join(' -> ')}`, {
        cycle
      });
    }
    for (const id of ready) {
      result.push(byId.get(id) as DiscoveredPlugin);
      remaining.delete(id);
      for (const deps of remaining.values()) deps.delete(id);
    }
  }
  return Object.freeze(result);
}
