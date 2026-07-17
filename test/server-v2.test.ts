import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMcpV2Server } from '../src/mcp-v2/server';
import { createV2App, createV2Runtime } from '../src/server-v2';

const roots: string[] = [];

function fixturePlugins(): string {
  fs.mkdirSync(path.join(process.cwd(), 'tmp'), { recursive: true });
  const pluginsRoot = fs.mkdtempSync(path.join(process.cwd(), 'tmp', 'agentcanvas-v2-plugins-'));
  roots.push(pluginsRoot);
  const pluginRoot = path.join(pluginsRoot, 'fixture.cards');
  fs.mkdirSync(path.join(pluginRoot, 'dist', 'browser'), { recursive: true });
  fs.writeFileSync(
    path.join(pluginRoot, 'agentcanvas.plugin.json'),
    JSON.stringify({
      apiVersion: 'agentcanvas.plugin/v1',
      id: 'fixture.cards',
      version: '1.0.0',
      displayName: 'Fixture cards',
      description: 'Runtime integration fixture.',
      license: 'MIT',
      entrypoints: { server: 'dist/server.mjs', browser: 'dist/browser/entry.mjs' },
      requires: { hostApi: '^1.0.0', plugins: {}, capabilities: {} },
      provides: { capabilities: {} },
      permissions: ['canvas.read', 'canvas.mutate-own'],
      contributes: {
        elements: [{ name: 'card', schemaVersion: 1, browser: true, snapshot: 'supported' }],
        tools: [],
        procedures: ['echo'],
        migrations: []
      }
    })
  );
  fs.writeFileSync(
    path.join(pluginRoot, 'dist', 'server.mjs'),
    `export default { activate(host) {
      host.registerElementType({
        name: 'card', schemaVersion: 1, browser: true, snapshot: 'supported',
        dataSchema: { type: 'object', additionalProperties: false, required: ['title'], properties: { title: { type: 'string' } } },
        summarize: (element) => ({ title: element.data.title }),
        renderSnapshot: (element) => ({ space: 'frame', layer: 'content', nodes: [
          { kind: 'rect', x: 0, y: 0, width: element.width ?? 100, height: element.height ?? 50, fill: '#ffffff', stroke: '#000000' },
          { kind: 'text', x: 8, y: 22, text: element.data.title, fill: '#000000' }
        ] })
      });
      host.registerProcedure({
        name: 'echo', description: 'Echo a value.',
        inputSchema: { type: 'object', additionalProperties: false, required: ['value'], properties: { value: { type: 'string' } } },
        outputSchema: { type: 'object', additionalProperties: false, required: ['value'], properties: { value: { type: 'string' } } },
        invoke: async (input) => ({ value: input.value })
      });
    } };`
  );
  fs.writeFileSync(
    path.join(pluginRoot, 'dist', 'browser', 'entry.mjs'),
    `export default { activate(host) { host.registerRenderer({ type: 'fixture.cards/card', schemaVersions: [1], placement: 'node', mount(root, context) { root.textContent = context.element.data.title; return { update(next) { root.textContent = next.element.data.title; }, dispose() { root.textContent = ''; } }; } }); } };`
  );
  return pluginsRoot;
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe('v0.2 assembled runtime', () => {
  it('uses one frozen registry across HTTP, OpenAPI, browser modules, procedures, storage, and snapshots', async () => {
    const runtime = await createV2Runtime({
      pluginsRoot: fixturePlugins(),
      databasePath: ':memory:',
      config: {
        publicBaseUrl: 'http://127.0.0.1:23003'
      }
    });
    const app = createV2App(runtime);
    const health = await app.request('/health');
    expect(health.status).toBe(200);
    expect(await health.json()).toMatchObject({ ok: true, dependencies: {} });
    expect(await (await app.request('/whoami')).json()).toMatchObject({ dependencies: {} });

    const plugins = await (await app.request('/api/v1/plugins')).json();
    expect(plugins.plugins[0]).toMatchObject({
      id: 'fixture.cards',
      buildHash: expect.stringMatching(/^[a-f0-9]{24}$/),
      elements: [{ type: 'fixture.cards/card', schemaVersion: 1 }]
    });
    expect(JSON.stringify(plugins)).not.toContain(runtime.registry.plugins[0].plugin.root);

    const created = await (
      await app.request('/api/v1/canvases', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'Plugin canvas' })
      })
    ).json();
    const canvasId = created.canvas.id as string;
    const mutated = await app.request(`/api/v1/canvases/${canvasId}/elements:batch`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        operations: [
          {
            op: 'upsertElement',
            element: {
              id: 'card_1',
              type: 'fixture.cards/card',
              schemaVersion: 1,
              x: 10,
              y: 20,
              width: 180,
              height: 80,
              data: { title: 'Hello plugin' }
            }
          }
        ]
      })
    });
    expect(mutated.status).toBe(200);

    const procedure = await app.request('/api/v1/plugins/fixture.cards/procedures/echo', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ value: 'registry' })
    });
    expect(await procedure.json()).toEqual({ value: 'registry' });

    const snapshotResponse = await app.request(`/api/v1/canvases/${canvasId}/snapshot`, { method: 'POST' });
    const snapshot = await snapshotResponse.json();
    expect(snapshot.snapshot).toMatchObject({ mimeType: 'image/svg+xml', width: expect.any(Number) });
    expect(JSON.stringify(snapshot)).not.toContain('data:');
    const content = await app.request(snapshot.snapshot.url);
    expect(content.headers.get('content-type')).toBe('image/svg+xml');
    expect(await content.text()).toContain('Hello plugin');

    const openapi = await (await app.request('/openapi.json')).json();
    expect(openapi.paths['/api/v1/plugins/fixture.cards/procedures/echo']).toBeDefined();
    expect(openapi.components.schemas.Element_fixture_cards_card).toBeDefined();

    const moduleResponse = await app.request(plugins.plugins[0].browserEntryUrl);
    expect(moduleResponse.status).toBe(200);
    expect(moduleResponse.headers.get('cache-control')).toContain('immutable');

    const mcp = createMcpV2Server({
      registry: runtime.registry,
      store: runtime.store,
      browserCatalog: runtime.browserCatalog,
      diagnostics: () => runtime.plugins.diagnostics.list()
    });
    const client = new Client({ name: 'test-client', version: '1.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([mcp.server.connect(serverTransport), client.connect(clientTransport)]);
    const listedTools = await client.listTools();
    expect(listedTools.tools.map((tool) => tool.name)).toEqual(mcp.tools.map((tool) => tool.name));
    expect(listedTools.tools.map((tool) => tool.name)).toContain('canvas_rename');
    expect(listedTools.tools.map((tool) => tool.name)).toContain('canvas_upsert_element');
    const renameCall = await client.callTool({
      name: 'canvas_rename',
      arguments: { canvasId, title: 'Renamed by agent', expectedRevision: 2 }
    });
    expect(renameCall.structuredContent).toMatchObject({
      id: canvasId,
      title: 'Renamed by agent',
      revision: 3
    });
    const pluginCall = await client.callTool({ name: 'canvas_list_plugins', arguments: {} });
    expect(pluginCall.structuredContent).toMatchObject({ plugins: [{ id: 'fixture.cards' }] });
    await Promise.all([client.close(), mcp.server.close()]);
    runtime.store.close();
  });
});
