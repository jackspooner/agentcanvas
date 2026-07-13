import type { PluginProcedureDescriptor } from '@agentcanvas/plugin-sdk';
import type { FrozenPluginRegistry } from '../plugin-runtime/index.js';

export interface RegistryProcedureContract {
  pluginId: string;
  name: string;
  operationId: string;
  path: string;
  descriptor: PluginProcedureDescriptor;
}

export interface RegistryProcedureCatalog {
  procedures: readonly RegistryProcedureContract[];
  get(pluginId: string, procedureName: string): RegistryProcedureContract | undefined;
}

function procedureKey(pluginId: string, name: string): string {
  return `${pluginId}\0${name}`;
}

/** Builds the only procedure lookup needed by HTTP execution and OpenAPI generation. */
export function createProcedureCatalog(registry: FrozenPluginRegistry): RegistryProcedureCatalog {
  const procedures: RegistryProcedureContract[] = [];
  const byKey = new Map<string, RegistryProcedureContract>();
  for (const activated of registry.plugins) {
    const pluginId = activated.plugin.manifest.id;
    for (const descriptor of activated.procedures) {
      const contract = Object.freeze({
        pluginId,
        name: descriptor.name,
        operationId: `plugin_${pluginId.replace(/[.-]/g, '_')}__${descriptor.name.replace(/-/g, '_')}`,
        path: `/api/v1/plugins/${encodeURIComponent(pluginId)}/procedures/${encodeURIComponent(descriptor.name)}`,
        descriptor
      });
      const key = procedureKey(pluginId, descriptor.name);
      if (byKey.has(key)) throw new Error(`duplicate plugin procedure contract: ${pluginId}/${descriptor.name}`);
      byKey.set(key, contract);
      procedures.push(contract);
    }
  }
  const frozen = Object.freeze(procedures);
  return Object.freeze({
    procedures: frozen,
    get: (pluginId: string, name: string) => byKey.get(procedureKey(pluginId, name))
  });
}
