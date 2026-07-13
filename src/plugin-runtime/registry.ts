import { pathToFileURL } from 'node:url';
import type {
  AgentCanvasServerPlugin,
  CapabilityHandle,
  CapabilityProvider,
  ElementTypeDescriptor,
  NamespacedPluginKv,
  PluginDiagnostics,
  PluginMigrationDescriptor,
  PluginProcedureDescriptor,
  PluginToolDescriptor,
  ServerPluginHost
} from '@agentcanvas/plugin-sdk';
import type { DiscoveredPlugin } from './discovery.js';
import { PluginRuntimeError } from './errors.js';
import { deepFreeze } from './freeze.js';
import { satisfies } from './semver.js';

export interface PluginRuntimeServices {
  kv(pluginId: string): NamespacedPluginKv;
  diagnostics(pluginId: string): PluginDiagnostics;
}

export interface ActivatedPlugin {
  plugin: DiscoveredPlugin;
  elements: readonly ElementTypeDescriptor[];
  tools: readonly PluginToolDescriptor[];
  procedures: readonly PluginProcedureDescriptor[];
  migrations: readonly PluginMigrationDescriptor[];
}

export class FrozenPluginRegistry {
  readonly plugins: readonly ActivatedPlugin[];
  readonly capabilities: Readonly<Record<string, CapabilityProvider<unknown>>>;
  constructor(plugins: ActivatedPlugin[], capabilities: Map<string, CapabilityProvider<unknown>>) {
    this.plugins = deepFreeze(plugins);
    this.capabilities = Object.freeze(
      Object.fromEntries([...capabilities].map(([name, provider]) => [name, Object.freeze({ ...provider })]))
    );
    Object.freeze(this);
  }
  getPlugin(id: string): ActivatedPlugin | undefined {
    return this.plugins.find((item) => item.plugin.manifest.id === id);
  }
  getElementType(type: string): ElementTypeDescriptor | undefined {
    const split = type.lastIndexOf('/');
    if (split < 1) return undefined;
    return this.getPlugin(type.slice(0, split))?.elements.find((item) => item.name === type.slice(split + 1));
  }
}

function assertNames(
  kind: string,
  declared: readonly string[],
  actual: readonly { name: string }[],
  pluginId: string
): void {
  const expected = [...declared].sort();
  const received = actual.map((item) => item.name).sort();
  if (JSON.stringify(expected) !== JSON.stringify(received)) {
    throw new PluginRuntimeError(
      'plugin_activation_invalid',
      `${pluginId} ${kind} registrations do not match its manifest`,
      { expected, received }
    );
  }
}

export async function activatePlugins(
  ordered: readonly DiscoveredPlugin[],
  services: PluginRuntimeServices,
  initialCapabilities: readonly CapabilityProvider<unknown>[] = []
): Promise<FrozenPluginRegistry> {
  const capabilities = new Map<string, CapabilityProvider<unknown>>(
    initialCapabilities.map((provider) => [provider.name, provider])
  );
  const activated: ActivatedPlugin[] = [];
  for (const plugin of ordered) {
    const elements: ElementTypeDescriptor[] = [];
    const tools: PluginToolDescriptor[] = [];
    const procedures: PluginProcedureDescriptor[] = [];
    const migrations: PluginMigrationDescriptor[] = [];
    const host: ServerPluginHost = {
      config: plugin.config,
      kv: services.kv(plugin.manifest.id),
      diagnostics: services.diagnostics(plugin.manifest.id),
      registerElementType: (descriptor) => elements.push(descriptor),
      registerTool: (descriptor) => tools.push(descriptor),
      registerProcedure: (descriptor) => procedures.push(descriptor),
      registerMigration: (descriptor) => migrations.push(descriptor),
      provideCapability: <T>(descriptor: CapabilityProvider<T>) => {
        const declared = plugin.manifest.provides.capabilities[descriptor.name];
        if (declared !== descriptor.version || capabilities.has(descriptor.name)) {
          throw new PluginRuntimeError(
            'plugin_activation_invalid',
            `${plugin.manifest.id} provided undeclared or mismatched capability ${descriptor.name}`
          );
        }
        capabilities.set(descriptor.name, descriptor as CapabilityProvider<unknown>);
      },
      consumeCapability: <T>(name: string, range: string): CapabilityHandle<T> => {
        const declared = plugin.manifest.requires.capabilities[name];
        const provider = capabilities.get(name);
        if (declared !== range || !provider || !satisfies(provider.version, range)) {
          throw new PluginRuntimeError(
            'plugin_activation_invalid',
            `${plugin.manifest.id} cannot consume capability ${name}@${range}`
          );
        }
        return Object.freeze({
          name,
          range,
          get: () => provider.value as T,
          readiness: () => provider.readiness?.() ?? Promise.resolve({ ok: true })
        });
      }
    };
    const module = (await import(pathToFileURL(plugin.serverEntry).href)) as { default?: AgentCanvasServerPlugin };
    if (!module.default || typeof module.default.activate !== 'function') {
      throw new PluginRuntimeError(
        'plugin_activation_invalid',
        `${plugin.manifest.id} server entry must default-export a plugin`
      );
    }
    await module.default.activate(host);
    assertNames(
      'element',
      plugin.manifest.contributes.elements.map((item) => item.name),
      elements,
      plugin.manifest.id
    );
    assertNames('tool', plugin.manifest.contributes.tools, tools, plugin.manifest.id);
    assertNames('procedure', plugin.manifest.contributes.procedures, procedures, plugin.manifest.id);
    assertNames('migration', plugin.manifest.contributes.migrations, migrations, plugin.manifest.id);
    for (const [name, version] of Object.entries(plugin.manifest.provides.capabilities)) {
      if (capabilities.get(name)?.version !== version)
        throw new PluginRuntimeError(
          'plugin_activation_invalid',
          `${plugin.manifest.id} did not register capability ${name}@${version}`
        );
    }
    activated.push({
      plugin,
      elements: deepFreeze(elements),
      tools: deepFreeze(tools),
      procedures: deepFreeze(procedures),
      migrations: deepFreeze(migrations)
    });
  }
  return new FrozenPluginRegistry(activated, capabilities);
}
