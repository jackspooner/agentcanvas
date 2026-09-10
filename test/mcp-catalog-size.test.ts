import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createMcpV2ToolCatalog } from '../src/mcp-v2/server.js';
import { loadOfflinePluginRegistry } from '../src/plugin-runtime/offline.js';

describe('installed MCP catalog size', () => {
  it('stays below half the measured pre-receipt catalog and keeps generic upsert compact', async () => {
    const offline = await loadOfflinePluginRegistry({ pluginsRoot: path.resolve('dist', 'plugin-catalog') });
    try {
      const tools = createMcpV2ToolCatalog(offline.registry);
      const catalog = tools.map(({ name, title, description, inputSchema, outputSchema, annotations }) => ({
        name,
        title,
        description,
        inputSchema,
        outputSchema,
        ...(annotations ? { annotations } : {})
      }));
      const largest = catalog
        .map(
          (tool) =>
            [
              tool.name,
              JSON.stringify(tool).length,
              JSON.stringify(tool.inputSchema).length,
              JSON.stringify(tool.outputSchema).length
            ] as const
        )
        .sort((left, right) => right[1] - left[1])
        .slice(0, 12);
      expect(JSON.stringify(catalog).length, JSON.stringify(largest)).toBeLessThanOrEqual(227_015);
      expect(JSON.stringify(catalog.find((tool) => tool.name === 'canvas_upsert_element')).length).toBeLessThan(10_000);
    } finally {
      offline.resources.dispose();
    }
  });
});
