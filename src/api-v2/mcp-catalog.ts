import {
  deriveToolName,
  type JsonSchema,
  type PluginToolAnnotations,
  type PluginToolDescriptor
} from '@agentcanvas/plugin-sdk';
import type { FrozenPluginRegistry } from '../plugin-runtime/index.js';

export interface CoreJsonSchemaTool {
  name: string;
  title: string;
  description: string;
  inputSchema: JsonSchema;
  outputSchema: JsonSchema;
  annotations?: PluginToolAnnotations;
}

export interface McpJsonSchemaTool extends CoreJsonSchemaTool {
  source: 'core' | 'plugin';
  pluginId?: string;
  localName?: string;
  descriptor?: PluginToolDescriptor;
}

export interface ToolCatalogParityResult {
  ok: boolean;
  missing: readonly string[];
  unexpected: readonly string[];
  schemaMismatches: readonly string[];
}

/** Derives globally namespaced MCP tools directly from the frozen registry plus kernel-owned core tool contracts. */
export function createMcpToolCatalog(
  registry: FrozenPluginRegistry,
  coreTools: readonly CoreJsonSchemaTool[] = []
): readonly McpJsonSchemaTool[] {
  const byName = new Map<string, McpJsonSchemaTool>();
  const add = (tool: McpJsonSchemaTool): void => {
    if (byName.has(tool.name)) throw new Error(`MCP tool name collision: ${tool.name}`);
    byName.set(tool.name, Object.freeze(tool));
  };
  for (const tool of coreTools) add({ ...tool, source: 'core' });
  for (const activated of registry.plugins) {
    const pluginId = activated.plugin.manifest.id;
    for (const descriptor of activated.tools) {
      add({
        name: deriveToolName(pluginId, descriptor.name),
        title: descriptor.title,
        description: descriptor.description,
        inputSchema: descriptor.inputSchema,
        outputSchema: descriptor.outputSchema,
        ...(descriptor.annotations ? { annotations: descriptor.annotations } : {}),
        source: 'plugin',
        pluginId,
        localName: descriptor.name,
        descriptor
      });
    }
  }
  return Object.freeze([...byName.values()].sort((left, right) => left.name.localeCompare(right.name)));
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

/** Compares the canonical JSON Schema surface exposed by resident HTTP MCP and a stdio bridge. */
export function compareMcpToolCatalogs(
  expected: readonly Pick<McpJsonSchemaTool, 'name' | 'inputSchema' | 'outputSchema'>[],
  actual: readonly Pick<McpJsonSchemaTool, 'name' | 'inputSchema' | 'outputSchema'>[]
): ToolCatalogParityResult {
  const expectedByName = new Map(expected.map((tool) => [tool.name, tool]));
  const actualByName = new Map(actual.map((tool) => [tool.name, tool]));
  const missing = [...expectedByName.keys()].filter((name) => !actualByName.has(name)).sort();
  const unexpected = [...actualByName.keys()].filter((name) => !expectedByName.has(name)).sort();
  const schemaMismatches = [...expectedByName]
    .filter(([name, tool]) => {
      const counterpart = actualByName.get(name);
      return (
        counterpart !== undefined &&
        (stableJson(tool.inputSchema) !== stableJson(counterpart.inputSchema) ||
          stableJson(tool.outputSchema) !== stableJson(counterpart.outputSchema))
      );
    })
    .map(([name]) => name)
    .sort();
  return Object.freeze({
    ok: missing.length === 0 && unexpected.length === 0 && schemaMismatches.length === 0,
    missing: Object.freeze(missing),
    unexpected: Object.freeze(unexpected),
    schemaMismatches: Object.freeze(schemaMismatches)
  });
}

export function assertMcpToolCatalogParity(
  expected: readonly Pick<McpJsonSchemaTool, 'name' | 'inputSchema' | 'outputSchema'>[],
  actual: readonly Pick<McpJsonSchemaTool, 'name' | 'inputSchema' | 'outputSchema'>[]
): void {
  const result = compareMcpToolCatalogs(expected, actual);
  if (!result.ok) {
    throw new Error(
      `MCP tool catalogs differ: missing=${result.missing.join(',') || '<none>'}; ` +
        `unexpected=${result.unexpected.join(',') || '<none>'}; schemas=${result.schemaMismatches.join(',') || '<none>'}`
    );
  }
}
