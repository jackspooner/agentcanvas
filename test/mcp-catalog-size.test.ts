import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createMcpV2ToolCatalog } from '../src/mcp-v2/server.js';
import { loadOfflinePluginRegistry } from '../src/plugin-runtime/offline.js';

describe('installed MCP catalog size', () => {
  it('keeps lean and full projections within their token budgets', async () => {
    const offline = await loadOfflinePluginRegistry({ pluginsRoot: path.resolve('dist', 'plugin-catalog') });
    try {
      const project = (profile: 'lean' | 'full') =>
        createMcpV2ToolCatalog(offline.registry, profile).map(
          ({ name, title, description, inputSchema, outputSchema, annotations }) => ({
            name,
            title,
            description,
            inputSchema,
            outputSchema,
            ...(annotations ? { annotations } : {})
          })
        );
      const catalog = project('lean');
      const full = project('full');
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
      expect(JSON.stringify(catalog).length, JSON.stringify(largest)).toBeLessThanOrEqual(90_000);
      expect(JSON.stringify(full).length).toBeLessThanOrEqual(155_000);
      expect(JSON.stringify(catalog.find((tool) => tool.name === 'canvas_upsert_element')).length).toBeLessThan(10_000);
    } finally {
      offline.resources.dispose();
    }
  });
});
