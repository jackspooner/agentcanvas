import {
  AGENTCANVAS_PLUGIN_API_VERSION,
  isLocalContributionName,
  isPluginId,
  type PluginElementContribution,
  type PluginManifest
} from '@agentcanvas/plugin-sdk';

export interface ExtensionCommandContribution {
  name: string;
  title: string;
  category?: string;
}

export interface ExtensionContributionDescriptor {
  elements?: readonly PluginElementContribution[];
  commands?: readonly ExtensionCommandContribution[];
  tools?: readonly string[];
  procedures?: readonly string[];
  migrations?: readonly string[];
}

export interface ExtensionDefinitionInput {
  manifest: Omit<PluginManifest, 'apiVersion' | 'contributes'>;
  contributes?: ExtensionContributionDescriptor;
}

export interface AgentCanvasExtensionDefinition {
  manifest: PluginManifest;
  contributes: Readonly<{
    elements: readonly PluginElementContribution[];
    commands: readonly ExtensionCommandContribution[];
    tools: readonly string[];
    procedures: readonly string[];
    migrations: readonly string[];
  }>;
}

function assertLocalName(name: string, label: string): void {
  if (!isLocalContributionName(name)) throw new TypeError(`${label} must be a valid local contribution name`);
}

function uniqueNames(values: readonly string[], label: string): void {
  const seen = new Set<string>();
  for (const value of values) {
    assertLocalName(value, label);
    if (seen.has(value)) throw new TypeError(`Duplicate ${label}: ${value}`);
    seen.add(value);
  }
}

export function defineElement<const T extends PluginElementContribution>(element: T): T {
  assertLocalName(element.name, 'element name');
  if (!Number.isSafeInteger(element.schemaVersion) || element.schemaVersion < 1) {
    throw new TypeError('element schemaVersion must be a positive safe integer');
  }
  return Object.freeze({ ...element });
}

export function defineCommand<const T extends ExtensionCommandContribution>(command: T): T {
  assertLocalName(command.name, 'command name');
  if (!command.title.trim()) throw new TypeError('command title must be non-empty');
  return Object.freeze({ ...command });
}

export function defineExtension(input: ExtensionDefinitionInput): AgentCanvasExtensionDefinition {
  if (!isPluginId(input.manifest.id)) throw new TypeError('extension id is invalid');
  const elements = Object.freeze([...(input.contributes?.elements ?? [])].map(defineElement));
  const commands = Object.freeze([...(input.contributes?.commands ?? [])].map(defineCommand));
  const tools = Object.freeze([...(input.contributes?.tools ?? [])]);
  const procedures = Object.freeze([...(input.contributes?.procedures ?? [])]);
  const migrations = Object.freeze([...(input.contributes?.migrations ?? [])]);
  uniqueNames(
    elements.map((element) => element.name),
    'element'
  );
  uniqueNames(
    commands.map((command) => command.name),
    'command'
  );
  uniqueNames(tools, 'tool');
  uniqueNames(procedures, 'procedure');
  uniqueNames(migrations, 'migration');
  if (commands.length > 0 && !input.manifest.entrypoints.browser) {
    throw new TypeError('browser commands require a browser entrypoint');
  }
  const manifest: PluginManifest = Object.freeze({
    ...input.manifest,
    apiVersion: AGENTCANVAS_PLUGIN_API_VERSION,
    contributes: Object.freeze({
      elements,
      commands: Object.freeze(commands.map((command) => command.name)),
      tools,
      procedures,
      migrations
    })
  });
  return Object.freeze({
    manifest,
    contributes: Object.freeze({ elements, commands, tools, procedures, migrations })
  });
}

export function serializeExtensionManifest(definition: AgentCanvasExtensionDefinition): string {
  return `${JSON.stringify(definition.manifest, null, 2)}\n`;
}
