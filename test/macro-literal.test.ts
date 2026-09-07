import fs from 'node:fs';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { expect, it } from 'vitest';
import { createV2App, createV2Runtime } from '../src/server-v2';
import { createMcpV2Server } from '../src/mcp-v2/server';

it('preserves literal macro input through HTTP/MCP planning, execution and replay', async () => {
  fs.mkdirSync(path.join(process.cwd(), 'tmp'), { recursive: true });
  const root = fs.mkdtempSync(path.join(process.cwd(), 'tmp', 'agentcanvas-literal-'));
  const plugin = path.join(root, 'fixture.payload');
  fs.mkdirSync(plugin);
  fs.writeFileSync(
    path.join(plugin, 'agentcanvas.plugin.json'),
    JSON.stringify({
      apiVersion: 'agentcanvas.plugin/v1',
      id: 'fixture.payload',
      version: '1.0.0',
      displayName: 'Payload',
      description: 'Literal payload fixture',
      license: 'MIT',
      entrypoints: { server: 'server.mjs' },
      requires: { hostApi: '^1.0.0', plugins: {}, capabilities: {} },
      provides: { capabilities: {} },
      permissions: [],
      contributes: {
        elements: [{ name: 'card', schemaVersion: 1, browser: false, snapshot: 'unsupported' }],
        tools: [],
        procedures: [],
        migrations: []
      }
    })
  );
  fs.writeFileSync(
    path.join(plugin, 'server.mjs'),
    `export default { activate(host) {
    host.registerElementType({ name: 'card', schemaVersion: 1, browser: false, snapshot: 'unsupported',
      dataSchema: { type: 'object', required: ['payload'], additionalProperties: false, properties: { payload: { type: 'object' } } },
      summarize: () => ({ title: 'Literal payload' }) });
  } };`
  );
  const runtime = await createV2Runtime({ pluginsRoot: root, databasePath: ':memory:' });
  const mcp = createMcpV2Server({
    registry: runtime.registry,
    store: runtime.store,
    macros: runtime.macros,
    publicBaseUrl: runtime.config.publicBaseUrl,
    browserCatalog: runtime.browserCatalog,
    diagnostics: () => []
  });
  const client = new Client({ name: 'literal-input-test', version: '1.0.0' });
  try {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([client.connect(clientTransport), mcp.server.connect(serverTransport)]);
    const app = createV2App(runtime);
    const canvas = runtime.store.createCanvas({ title: 'Literal input' });
    const macro = runtime.macros.create({
      scope: 'installation',
      title: 'Literal card',
      inputSchema: {
        type: 'object',
        required: ['payload'],
        properties: { payload: { type: 'object' } },
        additionalProperties: false
      },
      elements: [
        {
          key: 'card',
          type: 'fixture.payload/card',
          schemaVersion: 1,
          x: 0,
          y: 0,
          width: 100,
          height: 100,
          data: { payload: { $macroRef: 'input', pointer: '/payload' } }
        }
      ]
    });
    const payload = { $macroRef: 'input', pointer: '/payload' };
    const body = { macroVersion: 1, anchor: { x: 0, y: 0 }, input: { payload } };
    const response = await app.request(`/api/v1/canvases/${canvas.id}/macros/${macro.definition.id}:plan`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    });
    expect(response.status).toBe(200);
    const httpPlan = await response.json();
    const mcpPlan = await client.callTool({
      name: 'macro_plan',
      arguments: { ...body, canvasId: canvas.id, macroId: macro.definition.id }
    });
    expect(mcpPlan.isError).not.toBe(true);
    expect(httpPlan.previewElements[0].data).toEqual({ payload });
    expect(mcpPlan.structuredContent).toMatchObject({
      planId: httpPlan.planId,
      previewElements: [{ data: { payload } }]
    });
    expect(runtime.store.getCanvas(canvas.id).revision).toBe(1);
    const args = {
      mode: 'plan',
      canvasId: canvas.id,
      planId: httpPlan.planId,
      expectedRevision: 1,
      idempotencyKey: 'literal-input'
    };
    const executed = await client.callTool({ name: 'canvas_run_macro', arguments: args });
    expect(executed.isError).not.toBe(true);
    expect(executed.structuredContent).toMatchObject({
      canvas: { revision: 2, elements: [{ data: { payload } }] },
      history: { affectedElementIds: [httpPlan.previewElements[0].id] }
    });
    expect((await client.callTool({ name: 'canvas_run_macro', arguments: args })).structuredContent).toEqual(
      executed.structuredContent
    );
    expect(runtime.store.getCanvas(canvas.id)).toMatchObject({ revision: 2, elements: [{ data: { payload } }] });
  } finally {
    await Promise.all([client.close(), mcp.server.close()]);
    runtime.dispose();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
