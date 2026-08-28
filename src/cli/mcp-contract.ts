import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { JsonObject } from '@agentcanvas/plugin-sdk';
import { createMcpV2ToolCatalog, mcpErrorCodesForTool } from '../mcp-v2/server.js';
import { loadOfflinePluginRegistry } from '../plugin-runtime/offline.js';
import { STANDARD_PLUGINS } from './openapi.js';

function root(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, stable(entry)])
    );
  }
  return value;
}

export async function standardMcpContract(installationRoot = root()): Promise<JsonObject[]> {
  const { registry } = await loadOfflinePluginRegistry({
    pluginsRoot: path.join(installationRoot, 'dist', 'plugin-catalog'),
    pluginIds: STANDARD_PLUGINS
  });
  return createMcpV2ToolCatalog(registry).map((tool) => ({
    name: tool.name,
    title: tool.title,
    description: tool.description,
    inputSchema: tool.inputSchema,
    outputSchema: tool.outputSchema,
    annotations: {
      readOnlyHint: tool.annotations?.readOnlyHint ?? false,
      destructiveHint: tool.annotations?.destructiveHint ?? false,
      idempotentHint: tool.annotations?.idempotentHint ?? false,
      openWorldHint: tool.annotations?.openWorldHint ?? false
    },
    errorCodes: [...mcpErrorCodesForTool(tool)]
  })) as JsonObject[];
}

export async function generateStandardMcpContract(installationRoot = root()): Promise<string> {
  const output = path.join(installationRoot, 'docs', 'mcp-tools.standard.json');
  fs.writeFileSync(output, `${JSON.stringify(stable(await standardMcpContract(installationRoot)), null, 2)}\n`, 'utf8');
  return output;
}

export async function checkStandardMcpContract(installationRoot = root()): Promise<void> {
  const output = path.join(installationRoot, 'docs', 'mcp-tools.standard.json');
  const expected = `${JSON.stringify(stable(await standardMcpContract(installationRoot)), null, 2)}\n`;
  const actual = fs.existsSync(output) ? fs.readFileSync(output, 'utf8') : '';
  if (actual !== expected) throw new Error('docs/mcp-tools.standard.json is stale; run npm run generate:mcp-contract');
}

const command = process.argv[2];
if (command === 'generate') console.log(await generateStandardMcpContract());
else if (command === 'check') await checkStandardMcpContract();
