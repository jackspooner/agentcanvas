import fs from 'node:fs';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, expect, it } from 'vitest';
import { createMcpV2Server } from '../src/mcp-v2/server';
import { createV2App, createV2Runtime } from '../src/server-v2';

const cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const dispose of cleanup.splice(0).reverse()) await dispose();
});

async function harness(withOtherPlugin = false) {
  const tempRoot = path.resolve('tmp');
  fs.mkdirSync(tempRoot, { recursive: true });
  const root = fs.mkdtempSync(path.join(tempRoot, 'agentcanvas-contract-test-'));
  cleanup.push(() => {
    expect(path.dirname(root)).toBe(tempRoot);
    expect(path.basename(root)).toMatch(/^agentcanvas-contract-test-/);
    fs.rmSync(root, { recursive: true });
  });
  const pluginsRoot = path.join(root, 'plugins');
  for (const id of ['fixture.cards', ...(withOtherPlugin ? ['fixture.other'] : [])]) {
    const plugin = path.join(pluginsRoot, id);
    fs.mkdirSync(plugin, { recursive: true });
    fs.writeFileSync(
      path.join(plugin, 'agentcanvas.plugin.json'),
      JSON.stringify({
        apiVersion: 'agentcanvas.plugin/v1',
        id,
        version: '1.0.0',
        displayName: id,
        description: 'Contract regression fixture',
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
        dataSchema: { type: 'object', additionalProperties: false, required: ['title'], properties: { title: { type: 'string' } } }
      });
    } };`
    );
  }
  const options = { pluginsRoot, databasePath: path.join(root, 'canvas.sqlite') };
  const state = { runtime: await createV2Runtime(options) };
  cleanup.push(() => state.runtime.dispose());
  return {
    state,
    async removeCards() {
      state.runtime.dispose();
      fs.renameSync(path.join(pluginsRoot, 'fixture.cards'), path.join(pluginsRoot, '.fixture.cards'));
      state.runtime = await createV2Runtime(options);
    },
    async client() {
      const runtime = state.runtime;
      const { server } = createMcpV2Server({
        ...runtime,
        publicBaseUrl: runtime.config.publicBaseUrl,
        diagnostics: () => runtime.plugins.diagnostics.list()
      });
      const client = new Client({ name: 'contract-test', version: '1.0.0' });
      cleanup.push(async () => {
        await client.close();
        await server.close();
      });
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
      return client;
    }
  };
}

it.each([
  false,
  true
])('returns preserved elements through MCP after removal (other plugin: %s)', async (otherPlugin) => {
  const fixture = await harness(otherPlugin);
  const element = {
    id: 'card_1',
    type: 'fixture.cards/card',
    schemaVersion: 1,
    x: 1,
    y: 2,
    data: { title: 'Preserve me' }
  };
  const second = { ...element, id: 'card_2', x: 50 };
  const canvas = fixture.state.runtime.store.createCanvas({ title: 'Preservation' });
  fixture.state.runtime.store.applyOperations(canvas.id, {
    operations: [
      { op: 'upsertElement', element },
      { op: 'upsertElement', element: second }
    ]
  });
  await fixture.removeCards();
  const { store } = fixture.state.runtime;
  const client = await fixture.client();
  const get = await client.callTool({ name: 'canvas_get', arguments: { canvasId: canvas.id } });
  expect(get.isError).not.toBe(true);
  expect(get.structuredContent).toMatchObject({
    elements: [element, second],
    diagnostics: expect.arrayContaining([expect.objectContaining({ code: 'plugin_unavailable' })])
  });
  const list = await client.callTool({ name: 'canvas_list', arguments: {} });
  expect(list.isError).not.toBe(true);
  expect(list.structuredContent).toMatchObject({ canvases: [{ id: canvas.id, elements: [element, second] }] });
  const created = await client.callTool({ name: 'canvas_create', arguments: { title: 'Still available' } });
  expect(created.isError).not.toBe(true);
  expect(created.structuredContent).toMatchObject({ elements: [], revision: 1 });

  for (const [name, extra] of [
    ['canvas_patch_element_frame', { elementId: element.id, frame: { x: 42 } }],
    ['canvas_replace_element_metadata', { elementId: element.id, metadata: { note: 'Kept' } }],
    ['canvas_rename', { title: 'Renamed' }]
  ] as const) {
    const before = store.getCanvas(canvas.id);
    const result = await client.callTool({
      name,
      arguments: { canvasId: canvas.id, expectedRevision: before.revision, ...extra }
    });
    expect(result.isError).not.toBe(true);
    const persisted = store.getCanvas(canvas.id);
    expect(result.structuredContent).toMatchObject(persisted);
    expect(persisted.revision).toBe(before.revision + 1);
    expect(persisted.elements[0].data).toEqual(element.data);
  }
  expect(store.getCanvas(canvas.id).elements[0]).toMatchObject({ x: 42, metadata: { note: 'Kept' } });
  for (const [name, extra] of [
    ['canvas_upsert_element', { element }],
    ['canvas_replace_element_data', { elementId: element.id, data: { title: 'Rejected' } }]
  ] as const) {
    const before = store.getCanvas(canvas.id);
    const result = await client.callTool({ name, arguments: { canvasId: canvas.id, ...extra } });
    expect(result.isError).toBe(true);
    expect(store.getCanvas(canvas.id)).toEqual(before);
  }
  const beforeDelete = store.getCanvas(canvas.id);
  const deleted = await client.callTool({
    name: 'canvas_delete_element',
    arguments: { canvasId: canvas.id, elementId: element.id }
  });
  expect(deleted.isError).not.toBe(true);
  expect(deleted.structuredContent).toMatchObject(store.getCanvas(canvas.id));
  expect(store.getCanvas(canvas.id).revision).toBe(beforeDelete.revision + 1);
  expect(store.getCanvas(canvas.id).elements).toMatchObject([second]);
  const beforeClear = store.getCanvas(canvas.id);
  const cleared = await client.callTool({
    name: 'canvas_clear',
    arguments: { canvasId: canvas.id, expectedRevision: beforeClear.revision }
  });
  expect(cleared.isError).not.toBe(true);
  expect(cleared.structuredContent).toMatchObject({ elements: [], revision: beforeClear.revision + 1 });
  expect(cleared.structuredContent).toMatchObject(store.getCanvas(canvas.id));
});

it('validates list limits consistently before SQLite and preserves defaults and filters', async () => {
  const fixture = await harness();
  const runtime = fixture.state.runtime;
  const app = createV2App(runtime);
  const client = await fixture.client();
  for (let index = 0; index < 201; index++)
    runtime.store.createCanvas({ title: `Canvas ${index}`, project: index === 0 ? 'selected' : 'other' });
  for (const limit of [undefined, 1, 50, 200]) {
    const expected = limit ?? 50;
    expect(runtime.store.listCanvases({ limit })).toHaveLength(expected);
    const response = await app.request(`/api/v1/canvases${limit === undefined ? '' : `?limit=${limit}`}`);
    expect(response.status).toBe(200);
    expect((await response.json()).canvases).toHaveLength(expected);
    const result = await client.callTool({ name: 'canvas_list', arguments: limit === undefined ? {} : { limit } });
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toHaveProperty('canvases.length', expected);
  }
  for (const raw of ['', ' ', 'abc', '1.5', 'NaN', 'Infinity', '-Infinity', '0', '-1', '201']) {
    const response = await app.request(`/api/v1/canvases?limit=${encodeURIComponent(raw)}`, {
      headers: { 'x-request-id': 'req_limit_test' }
    });
    expect(response.status, raw).toBe(400);
    expect(response.headers.get('content-type')).toContain('application/problem+json');
    expect(await response.json()).toMatchObject({ code: 'validation_error', requestId: 'req_limit_test' });
    expect(() => runtime.store.listCanvases({ limit: Number(raw) }), raw).toThrow('limit');
    const result = await client.callTool({ name: 'canvas_list', arguments: { limit: raw } });
    expect(result.isError).toBe(true);
  }
  for (const limit of [0, -1, 1.5, 201]) {
    const result = await client.callTool({ name: 'canvas_list', arguments: { limit } });
    expect(result.structuredContent).toMatchObject({ problem: { code: 'validation_error' } });
  }
  const filtered = await app.request('/api/v1/canvases?project=selected');
  expect((await filtered.json()).canvases).toHaveLength(1);
});
