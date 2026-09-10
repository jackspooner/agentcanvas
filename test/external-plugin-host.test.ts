import fs from 'node:fs';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, describe, expect, it } from 'vitest';
import { createMcpV2Server } from '../src/mcp-v2/server.js';
import { createV2App, createV2Runtime } from '../src/server-v2.js';

const roots: string[] = [];

function runtimePluginsRoot(): { root: string; externalSource: string } {
  fs.mkdirSync(path.join(process.cwd(), 'tmp'), { recursive: true });
  const root = fs.mkdtempSync(path.join(process.cwd(), 'tmp', 'external-plugin-host-'));
  roots.push(root);
  const provider = path.join(root, 'fixture.assets-provider');
  fs.mkdirSync(path.join(provider, 'dist'), { recursive: true });
  fs.writeFileSync(
    path.join(provider, 'agentcanvas.plugin.json'),
    JSON.stringify({
      apiVersion: 'agentcanvas.plugin/v1',
      id: 'fixture.assets-provider',
      version: '1.0.0',
      displayName: 'Fixture Assets Provider',
      description: 'Test-only required capability provider.',
      license: 'MIT',
      entrypoints: { server: 'dist/server.mjs' },
      requires: { hostApi: '^1.0.0', plugins: {}, capabilities: {} },
      provides: { capabilities: { 'agentcanvas.assets': '1.0.0' } },
      permissions: [],
      contributes: { elements: [], tools: [], procedures: [], migrations: [] }
    })
  );
  fs.writeFileSync(
    path.join(provider, 'dist', 'server.mjs'),
    `export default { activate(host) { host.provideCapability({
      name: 'agentcanvas.assets', version: '1.0.0',
      value: { providerStatus: async () => ({ ok: true, identity: 'asset-service', capabilities: ['asset_crud','asset_refs'] }) },
      readiness: async () => ({ ok: true })
    }); } };`
  );
  const externalSource = path.resolve('test', 'external-plugin-fixture', 'plugin-dist', 'external.signal-card');
  if (!fs.existsSync(externalSource)) {
    throw new Error('external fixture distribution is missing; run npm run test:external-plugin first');
  }
  fs.cpSync(externalSource, path.join(root, 'external.signal-card'), { recursive: true });
  return { root, externalSource };
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe('external plugin host proof', () => {
  it('installs, restarts missing, preserves data, and reinstalls without rebuilding the host', async () => {
    const { root, externalSource } = runtimePluginsRoot();
    const databasePath = path.join(path.dirname(root), `${path.basename(root)}.sqlite`);
    roots.push(databasePath);
    let runtime = await createV2Runtime({ pluginsRoot: root, databasePath });
    let app = createV2App(runtime);
    const pluginStatus = await (await app.request('/api/v1/plugins/external.signal-card')).json();
    expect(pluginStatus).toMatchObject({
      id: 'external.signal-card',
      elements: [{ type: 'external.signal-card/signal-card', schemaVersion: 1 }]
    });
    const moduleResponse = await app.request(pluginStatus.browserEntryUrl as string);
    expect(moduleResponse.status).toBe(200);
    expect(await moduleResponse.text()).toContain('registerRenderer');
    const openapi = await (await app.request('/openapi.json')).json();
    expect(openapi.paths).toHaveProperty('/api/v1/plugins/external.signal-card/procedures/summarize-signal');
    expect(openapi.components.schemas).toHaveProperty('Element_external_signal_card_signal_card');

    const created = await (
      await app.request('/api/v1/canvases', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'External plugin proof' })
      })
    ).json();
    const canvasId = created.canvas.id as string;
    const mcpRuntime = {
      publicBaseUrl: runtime.config.publicBaseUrl,
      registry: runtime.registry,
      store: runtime.store,
      browserCatalog: runtime.browserCatalog,
      diagnostics: () => []
    };
    const { server } = createMcpV2Server(mcpRuntime);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'external-proof', version: '1.0.0' });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    const tools = await client.listTools();
    expect(tools.tools.map((tool) => tool.name)).not.toContain('external_signal_card__add_signal_card');
    expect(tools.tools.map((tool) => tool.name)).toContain('canvas_mutate_extension_tool');
    const plugins = await client.callTool({ name: 'canvas_list_plugins', arguments: {} });
    const pluginRows = (plugins.structuredContent as { plugins: Array<Record<string, unknown>> }).plugins;
    expect(pluginRows.find((plugin) => plugin.id === 'external.signal-card')).toMatchObject({
      id: 'external.signal-card',
      tools: [{ name: 'add-signal-card', directName: null }],
      diagnosticCounts: { errorCount: 0, warningCount: 0, infoCount: 0 }
    });
    expect(JSON.stringify(plugins.structuredContent)).not.toContain('description');
    expect(JSON.stringify(plugins.structuredContent)).not.toContain('permissions');
    const descriptor = await client.callTool({
      name: 'canvas_get_extension_tool',
      arguments: { pluginId: 'external.signal-card', toolName: 'add-signal-card' }
    });
    expect(descriptor.structuredContent).toMatchObject({
      pluginId: 'external.signal-card',
      toolName: 'add-signal-card',
      dispatcher: 'canvas_mutate_extension_tool',
      inputSchema: runtime.registry.getPlugin('external.signal-card')?.tools[0].inputSchema
    });
    const wrongDispatcher = await client.callTool({
      name: 'canvas_read_extension_tool',
      arguments: {
        pluginId: 'external.signal-card',
        toolName: 'add-signal-card',
        arguments: { canvasId, id: 'signal-1', label: 'Build', status: 'active' }
      }
    });
    expect(wrongDispatcher.structuredContent).toMatchObject({ problem: { code: 'validation_error' } });
    const generic = await client.callTool({
      name: 'canvas_mutate_extension_tool',
      arguments: {
        pluginId: 'external.signal-card',
        toolName: 'add-signal-card',
        arguments: { canvasId, id: 'signal-1', label: 'Build', status: 'active' }
      }
    });
    expect(generic.structuredContent).toMatchObject({ receipt: { canvasId, revision: 2 } });
    expect((generic.content as Array<{ text: string }>)[0].text).toBe('ok; result in structuredContent');
    await client.close();
    await server.close();

    const full = createMcpV2Server(mcpRuntime, 'full');
    const [fullClientTransport, fullServerTransport] = InMemoryTransport.createLinkedPair();
    const fullClient = new Client({ name: 'external-full-proof', version: '1.0.0' });
    await Promise.all([full.server.connect(fullServerTransport), fullClient.connect(fullClientTransport)]);
    expect((await fullClient.listTools()).tools.map((tool) => tool.name)).toContain(
      'external_signal_card__add_signal_card'
    );
    const named = await fullClient.callTool({
      name: 'external_signal_card__add_signal_card',
      arguments: { canvasId, id: 'signal-2', label: 'Ship', status: 'idle' }
    });
    expect(named.structuredContent).toMatchObject({ receipt: { canvasId, revision: 3 } });
    await Promise.all([fullClient.close(), full.server.close()]);

    expect(
      await (
        await app.request('/api/v1/plugins/external.signal-card/procedures/summarize-signal', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ label: 'Build', status: 'active' })
        })
      ).json()
    ).toEqual({ summary: 'Build is active' });
    expect(await (await app.request(`/api/v1/canvases/${canvasId}/snapshot`, { method: 'POST' })).json()).toMatchObject(
      { snapshot: { mimeType: 'image/svg+xml' } }
    );
    const before = runtime.store.getCanvas(canvasId);
    runtime.dispose();

    fs.rmSync(path.join(root, 'external.signal-card'), { recursive: true, force: true });
    runtime = await createV2Runtime({ pluginsRoot: root, databasePath });
    app = createV2App(runtime);
    const missing = await (await app.request(`/api/v1/canvases/${canvasId}`)).json();
    expect(missing.canvas.elements).toEqual(before.elements);
    expect(missing.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'plugin_unavailable', elementId: 'signal-1' })
    );
    runtime.dispose();

    fs.cpSync(externalSource, path.join(root, 'external.signal-card'), { recursive: true });
    runtime = await createV2Runtime({ pluginsRoot: root, databasePath });
    app = createV2App(runtime);
    const restored = await (await app.request(`/api/v1/canvases/${canvasId}`)).json();
    expect(restored.canvas.elements).toEqual(before.elements);
    expect(restored.diagnostics).not.toContainEqual(expect.objectContaining({ code: 'plugin_unavailable' }));
    expect(await (await app.request('/api/v1/plugins/external.signal-card')).json()).toMatchObject({
      id: 'external.signal-card'
    });
    runtime.dispose();
  });
});
