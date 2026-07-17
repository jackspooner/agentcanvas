import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { JsonObject } from '@agentcanvas/plugin-sdk';
import { createRegistryOpenApiDocument } from '../api-v2/openapi.js';
import { loadOfflinePluginRegistry } from '../plugin-runtime/offline.js';
import { coreOpenApiPaths } from '../server-v2.js';
import { AGENTCANVAS_VERSION } from '../version.js';

const STANDARD_PLUGINS = ['agentcanvas.primitives', 'agentcanvas.markdown', 'agentcanvas.table'] as const;

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

export async function standardOpenApiDocument(installationRoot = root()): Promise<JsonObject> {
  const { registry } = await loadOfflinePluginRegistry({
    pluginsRoot: path.join(installationRoot, 'dist', 'plugin-catalog'),
    pluginIds: STANDARD_PLUGINS
  });
  return createRegistryOpenApiDocument(registry, {
    title: 'AgentCanvas API',
    version: AGENTCANVAS_VERSION,
    description: 'Standard AgentCanvas distribution contract. Runtime OpenAPI reflects the exact active extension set.',
    corePaths: coreOpenApiPaths()
  });
}

export async function generateStandardOpenApi(installationRoot = root()): Promise<string> {
  const output = path.join(installationRoot, 'docs', 'openapi.standard.json');
  const document = await standardOpenApiDocument(installationRoot);
  fs.writeFileSync(output, `${JSON.stringify(stable(document), null, 2)}\n`, 'utf8');
  return output;
}

export async function checkStandardOpenApi(installationRoot = root()): Promise<void> {
  const output = path.join(installationRoot, 'docs', 'openapi.standard.json');
  const expected = `${JSON.stringify(stable(await standardOpenApiDocument(installationRoot)), null, 2)}\n`;
  const actual = fs.existsSync(output) ? fs.readFileSync(output, 'utf8') : '';
  if (actual !== expected) throw new Error('docs/openapi.standard.json is stale; run npm run generate:openapi');
}

const command = process.argv[2];
if (command === 'generate') console.log(await generateStandardOpenApi());
else if (command === 'check') await checkStandardOpenApi();
