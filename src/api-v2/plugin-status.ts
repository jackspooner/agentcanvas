import type { JsonSchema, PluginDiagnostic } from '@agentcanvas/plugin-sdk';
import type { BrowserPluginCatalogEntry, FrozenPluginRegistry } from '../plugin-runtime/index.js';
import { PLUGIN_DIAGNOSTIC_SCHEMA } from './schemas.js';

export interface SafeCapabilityStatus {
  ok: boolean;
  code?: string;
  retryable?: boolean;
}

export interface PluginStatusProjectionContext {
  browserEntries?: readonly Pick<BrowserPluginCatalogEntry, 'id' | 'browserEntryUrl' | 'browserBuildHash'>[];
  diagnostics?: readonly PluginDiagnostic[];
  capabilityStatus?: Readonly<Record<string, SafeCapabilityStatus>>;
}

export interface SanitizedPluginStatus {
  id: string;
  version: string;
  displayName: string;
  description: string;
  license: string;
  hostApi: string;
  permissions: readonly string[];
  buildHash: string | null;
  browserEntryUrl: string | null;
  elements: readonly { type: string; schemaVersion: number }[];
  contributions: {
    elements: readonly { type: string; schemaVersion: number; browser: boolean; snapshot: string }[];
    commands: readonly string[];
    tools: readonly string[];
    procedures: readonly string[];
    migrations: readonly string[];
  };
  dependencies: {
    plugins: Readonly<Record<string, string>>;
    capabilities: Readonly<Record<string, string>>;
  };
  capabilities: readonly {
    name: string;
    relationship: 'required' | 'provided';
    version: string | null;
    range: string | null;
    providerPluginId: string | null;
    status: SafeCapabilityStatus;
  }[];
  diagnostics: readonly PluginDiagnostic[];
}

export interface PluginStatusCatalog {
  plugins: readonly SanitizedPluginStatus[];
  diagnostics: readonly PluginDiagnostic[];
}

function safeDiagnostic(diagnostic: PluginDiagnostic): PluginDiagnostic {
  return Object.freeze({
    code: diagnostic.code,
    severity: diagnostic.severity,
    message: diagnostic.message,
    retryable: diagnostic.retryable,
    ...(diagnostic.pluginId ? { pluginId: diagnostic.pluginId } : {}),
    ...(diagnostic.elementId ? { elementId: diagnostic.elementId } : {})
  });
}

function safeStatus(status: SafeCapabilityStatus | undefined, fallbackOk: boolean): SafeCapabilityStatus {
  return Object.freeze({
    ok: status?.ok ?? fallbackOk,
    ...(status?.code ? { code: status.code } : {}),
    ...(status?.retryable !== undefined ? { retryable: status.retryable } : {})
  });
}

/** Produces plugin API responses without manifest paths, configuration declarations/values, environment names, or capability values. */
export function createPluginStatusCatalog(
  registry: FrozenPluginRegistry,
  context: PluginStatusProjectionContext = {}
): PluginStatusCatalog {
  const browserEntries = new Map(context.browserEntries?.map((entry) => [entry.id, entry]));
  const diagnostics = Object.freeze((context.diagnostics ?? []).map(safeDiagnostic));
  const providers = new Map<string, { pluginId: string; version: string }>();
  for (const activated of registry.plugins) {
    for (const [name, version] of Object.entries(activated.plugin.manifest.provides.capabilities)) {
      providers.set(name, { pluginId: activated.plugin.manifest.id, version });
    }
  }

  const plugins = registry.plugins.map((activated): SanitizedPluginStatus => {
    const manifest = activated.plugin.manifest;
    const capabilities: SanitizedPluginStatus['capabilities'][number][] = [];
    for (const [name, range] of Object.entries(manifest.requires.capabilities).sort(([a], [b]) => a.localeCompare(b))) {
      const provider = registry.capabilities[name];
      const providerPlugin = providers.get(name);
      capabilities.push(
        Object.freeze({
          name,
          relationship: 'required',
          version: provider?.version ?? null,
          range,
          providerPluginId: providerPlugin?.pluginId ?? null,
          status: safeStatus(context.capabilityStatus?.[name], Boolean(provider))
        })
      );
    }
    for (const [name, version] of Object.entries(manifest.provides.capabilities).sort(([a], [b]) =>
      a.localeCompare(b)
    )) {
      capabilities.push(
        Object.freeze({
          name,
          relationship: 'provided',
          version,
          range: null,
          providerPluginId: manifest.id,
          status: safeStatus(context.capabilityStatus?.[name], Boolean(registry.capabilities[name]))
        })
      );
    }
    return Object.freeze({
      id: manifest.id,
      version: manifest.version,
      displayName: manifest.displayName,
      description: manifest.description,
      license: manifest.license,
      hostApi: manifest.requires.hostApi,
      permissions: Object.freeze([...manifest.permissions]),
      buildHash: browserEntries.get(manifest.id)?.browserBuildHash ?? null,
      browserEntryUrl: browserEntries.get(manifest.id)?.browserEntryUrl ?? null,
      elements: Object.freeze(
        manifest.contributes.elements
          .filter((element) => element.browser)
          .map((element) =>
            Object.freeze({ type: `${manifest.id}/${element.name}`, schemaVersion: element.schemaVersion })
          )
      ),
      contributions: Object.freeze({
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
        migrations: Object.freeze([...manifest.contributes.migrations])
      }),
      dependencies: Object.freeze({
        plugins: Object.freeze({ ...manifest.requires.plugins }),
        capabilities: Object.freeze({ ...manifest.requires.capabilities })
      }),
      capabilities: Object.freeze(capabilities),
      diagnostics: Object.freeze(diagnostics.filter((item) => item.pluginId === manifest.id))
    });
  });
  return Object.freeze({ plugins: Object.freeze(plugins), diagnostics });
}

export function getPluginStatus(catalog: PluginStatusCatalog, pluginId: string): SanitizedPluginStatus | undefined {
  return catalog.plugins.find((plugin) => plugin.id === pluginId);
}

const CAPABILITY_STATUS_SCHEMA: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['name', 'relationship', 'version', 'range', 'providerPluginId', 'status'],
  properties: {
    name: { type: 'string' },
    relationship: { type: 'string', enum: ['required', 'provided'] },
    version: { type: ['string', 'null'] },
    range: { type: ['string', 'null'] },
    providerPluginId: { type: ['string', 'null'] },
    status: {
      type: 'object',
      additionalProperties: false,
      required: ['ok'],
      properties: { ok: { type: 'boolean' }, code: { type: 'string' }, retryable: { type: 'boolean' } }
    }
  }
};

export const PLUGIN_STATUS_SCHEMA: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'id',
    'version',
    'displayName',
    'description',
    'license',
    'hostApi',
    'permissions',
    'buildHash',
    'browserEntryUrl',
    'elements',
    'contributions',
    'dependencies',
    'capabilities',
    'diagnostics'
  ],
  properties: {
    id: { type: 'string' },
    version: { type: 'string' },
    displayName: { type: 'string' },
    description: { type: 'string' },
    license: { type: 'string' },
    hostApi: { type: 'string' },
    permissions: { type: 'array', items: { type: 'string' } },
    buildHash: { type: ['string', 'null'] },
    browserEntryUrl: { type: ['string', 'null'] },
    elements: { type: 'array' },
    contributions: {
      type: 'object',
      additionalProperties: false,
      required: ['elements', 'commands', 'tools', 'procedures', 'migrations'],
      properties: {
        elements: { type: 'array' },
        commands: { type: 'array', items: { type: 'string' } },
        tools: { type: 'array', items: { type: 'string' } },
        procedures: { type: 'array', items: { type: 'string' } },
        migrations: { type: 'array', items: { type: 'string' } }
      }
    },
    dependencies: { type: 'object' },
    capabilities: { type: 'array', items: CAPABILITY_STATUS_SCHEMA },
    diagnostics: { type: 'array', items: PLUGIN_DIAGNOSTIC_SCHEMA }
  }
};

export const PLUGIN_STATUS_CATALOG_SCHEMA: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['plugins', 'diagnostics'],
  properties: {
    plugins: { type: 'array', items: PLUGIN_STATUS_SCHEMA },
    diagnostics: { type: 'array', items: PLUGIN_DIAGNOSTIC_SCHEMA }
  }
};
