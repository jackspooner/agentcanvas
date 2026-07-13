export const AGENTCANVAS_PLUGIN_API_VERSION = 'agentcanvas.plugin/v1' as const;

export type PluginSnapshotSupport = 'supported' | 'unsupported';

export type BuiltinPluginPermission = 'canvas.read' | 'canvas.mutate-own' | 'assets.read' | 'diagnostics.emit';

export type PluginPermission = BuiltinPluginPermission | (string & {});

export interface PluginEntrypoints {
  server: string;
  browser?: string;
}

export interface PluginRequirements {
  hostApi: string;
  plugins: Readonly<Record<string, string>>;
  capabilities: Readonly<Record<string, string>>;
}

export interface PluginProvidedCapabilities {
  capabilities: Readonly<Record<string, string>>;
}

export interface PluginElementContribution {
  name: string;
  schemaVersion: number;
  browser: boolean;
  snapshot: PluginSnapshotSupport;
}

export interface PluginContributions {
  elements: readonly PluginElementContribution[];
  tools: readonly string[];
  procedures: readonly string[];
  migrations: readonly string[];
}

export interface PluginConfigurationDeclaration {
  schema: string;
  file: string;
  environment: readonly string[];
}

export interface PluginManifest {
  apiVersion: typeof AGENTCANVAS_PLUGIN_API_VERSION;
  id: string;
  version: string;
  displayName: string;
  description: string;
  license: string;
  entrypoints: PluginEntrypoints;
  requires: PluginRequirements;
  provides: PluginProvidedCapabilities;
  permissions: readonly PluginPermission[];
  contributes: PluginContributions;
  configuration?: PluginConfigurationDeclaration;
}
