import fs from 'node:fs';
import path from 'node:path';
import { assertContributionRegistrations, assertDistributionArtifacts } from '@agentcanvas/extension-testkit';
import type { JsonObject } from '@agentcanvas/extension-sdk';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, describe, expect, it } from 'vitest';
import { createMcpToolCatalog } from '../src/api-v2/mcp-catalog.js';
import { mcpOutputSchema } from '../src/api-v2/problem-contract.js';
import { createRegistryElementSchemas } from '../src/api-v2/openapi.js';
import { STANDARD_PLUGINS } from '../src/cli/openapi.js';
import { createMcpV2Server } from '../src/mcp-v2/server.js';
import { loadOfflinePluginRegistry } from '../src/plugin-runtime/offline.js';
import { createV2App, createV2Runtime } from '../src/server-v2.js';

const roots: string[] = [];
const cleanup: (() => void | Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function installDistributions(): string {
  const temporary = path.resolve('tmp');
  fs.mkdirSync(temporary, { recursive: true });
  const root = fs.mkdtempSync(path.join(temporary, 'diagrams-contracts-'));
  roots.push(root);
  for (const id of [...STANDARD_PLUGINS, 'agentcanvas.diagrams']) {
    const distribution = path.resolve('dist', 'plugin-catalog', id);
    if (!fs.existsSync(distribution)) throw new Error(`Build the extension catalog before contract tests: ${id}`);
    if (id === 'agentcanvas.diagrams')
      assertDistributionArtifacts(fs.readdirSync(distribution), { requireThirdPartyNotices: true });
    fs.cpSync(distribution, path.join(root, id), { recursive: true });
  }
  return root;
}

async function openRuntime(pluginsRoot = installDistributions(), databasePath = ':memory:') {
  const runtime = await createV2Runtime({ pluginsRoot, databasePath });
  cleanup.push(() => runtime.dispose());
  const app = createV2App(runtime);
  const mcp = createMcpV2Server({ ...runtime, publicBaseUrl: runtime.config.publicBaseUrl, diagnostics: () => [] });
  const client = new Client({ name: 'diagrams-contracts', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([mcp.server.connect(serverTransport), client.connect(clientTransport)]);
  cleanup.push(async () => {
    await client.close();
    await mcp.server.close();
  });
  return { runtime, app, client };
}

function data(): JsonObject {
  return {
    title: 'Account model',
    entities: [
      {
        id: 'account',
        name: 'Account',
        x: 0,
        y: 0,
        attributes: [{ id: 'id', name: 'id', dataType: 'uuid', keys: ['PK'], nullable: null }]
      },
      { id: 'invoice', name: 'Invoice', x: 500, y: 0, attributes: [] }
    ],
    relationships: [
      {
        id: 'invoices',
        source: { entityId: 'account', attributeId: 'id', cardinality: 'one' },
        target: { entityId: 'invoice', cardinality: 'zero-or-many' },
        label: 'receives',
        identifying: false
      }
    ]
  };
}

const nativeElement = (payload = data()) => ({
  id: 'diagram',
  type: 'agentcanvas.diagrams/erd',
  schemaVersion: 1,
  x: 10,
  y: 20,
  width: 960,
  height: 640,
  data: payload
});
const post = (body: unknown) => ({
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body)
});
const name = (local: string) => `agentcanvas_diagrams__${local.replaceAll('-', '_')}`;

describe('installed Diagrams public contracts', () => {
  it('loads offline and shares exact schemas across the installed registry, HTTP and all seven MCP tools', async () => {
    const root = installDistributions();
    const offline = await loadOfflinePluginRegistry({ pluginsRoot: root });
    cleanup.push(() => offline.resources.dispose());
    const standard = await loadOfflinePluginRegistry({ pluginsRoot: root, pluginIds: STANDARD_PLUGINS });
    cleanup.push(() => standard.resources.dispose());
    expect(standard.registry.getPlugin('agentcanvas.diagrams')).toBeUndefined();
    expect(standard.registry.plugins.map((item) => item.plugin.manifest.id).sort()).toEqual(
      [...STANDARD_PLUGINS].sort()
    );
    const extension = offline.registry.getPlugin('agentcanvas.diagrams');
    expect(extension).toBeDefined();
    if (!extension) throw new Error('Diagrams registration missing');
    assertContributionRegistrations(extension.plugin.manifest.contributes, {
      elements: extension.elements.map((item) => item.name),
      tools: extension.tools.map((item) => item.name),
      procedures: extension.procedures.map((item) => item.name),
      migrations: extension.migrations.map((item) => item.name)
    });
    expect(extension.tools.map((item) => item.name).sort()).toEqual([
      'convert-mermaid-erd',
      'create-erd',
      'create-mermaid',
      'edit-erd',
      'export-mermaid',
      'update-mermaid',
      'validate-mermaid'
    ]);
    const { runtime, app, client } = await openRuntime(root);
    const expected = createMcpToolCatalog(offline.registry).filter((tool) => tool.pluginId === 'agentcanvas.diagrams');
    const listed = (await client.listTools()).tools;
    for (const tool of expected) {
      const wire = listed.find((item) => item.name === tool.name);
      expect(wire?.inputSchema).toEqual(tool.inputSchema);
      expect(wire?.outputSchema).toEqual(mcpOutputSchema(tool.outputSchema));
    }
    const openapi = await (await app.request('/openapi.json')).json();
    const schemas = createRegistryElementSchemas(offline.registry);
    for (const type of ['erd', 'mermaid']) {
      const component = schemas.componentForType[`agentcanvas.diagrams/${type}`];
      expect(openapi.components.schemas[component]).toEqual(schemas.schemas[component]);
      expect(runtime.registry.getElementType(`agentcanvas.diagrams/${type}`)?.dataSchema).toEqual(
        offline.registry.getElementType(`agentcanvas.diagrams/${type}`)?.dataSchema
      );
    }
    const status = await (await app.request('/api/v1/plugins/agentcanvas.diagrams')).json();
    expect(status.elements.map((element: { type: string }) => element.type).sort()).toEqual([
      'agentcanvas.diagrams/erd',
      'agentcanvas.diagrams/mermaid'
    ]);
    const module = await app.request(status.browserEntryUrl);
    expect(module.status).toBe(200);
  });

  it('validates generic HTTP/MCP and macro writes with the installed native semantic validator', async () => {
    const { runtime, app, client } = await openRuntime();
    const canvas = runtime.store.createCanvas({ title: 'Generic native writes' });
    const valid = nativeElement();
    const write = await app.request(
      `/api/v1/canvases/${canvas.id}/elements:batch`,
      post({ expectedRevision: canvas.revision, operations: [{ op: 'upsertElement', element: valid }] })
    );
    expect(write.status).toBe(200);
    const persisted = runtime.store.getCanvas(canvas.id);
    const invalid = data();
    invalid.relationships = [
      {
        id: 'bad',
        source: { entityId: 'missing', cardinality: 'one' },
        target: { entityId: 'invoice', cardinality: 'one' },
        label: '',
        identifying: true
      }
    ];
    const rejected = await app.request(
      `/api/v1/canvases/${canvas.id}/elements:batch`,
      post({
        expectedRevision: persisted.revision,
        operations: [{ op: 'upsertElement', element: nativeElement(invalid) }]
      })
    );
    expect(rejected.status).toBe(400);
    const mcpRejected = await client.callTool({
      name: 'canvas_upsert_element',
      arguments: { canvasId: canvas.id, element: nativeElement(invalid), expectedRevision: persisted.revision }
    });
    expect(mcpRejected.isError).toBe(true);
    expect(runtime.store.getCanvas(canvas.id)).toEqual(persisted);
    const definition = runtime.macros.create({
      scope: 'installation',
      title: 'Native ERD template',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['diagram'],
        properties: { diagram: { type: 'object' } }
      },
      elements: [
        {
          key: 'erd',
          type: valid.type,
          schemaVersion: 1,
          x: 0,
          y: 0,
          width: 960,
          height: 640,
          data: { $macroRef: 'input', pointer: '/diagram' }
        }
      ]
    });
    const request = {
      canvasId: canvas.id,
      macroId: definition.definition.id,
      macroVersion: 1,
      anchor: { x: 50, y: 60 },
      input: { diagram: invalid }
    };
    expect(() => runtime.macros.plan(request)).toThrow(/canonical validation/);
    const plan = runtime.macros.plan({ ...request, input: { diagram: data() } });
    expect(plan.previewElements[0].data).toEqual(data());
    expect(runtime.store.getCanvas(canvas.id)).toEqual(persisted);
    const snapshot = await (await app.request(`/api/v1/canvases/${canvas.id}/snapshot`, { method: 'POST' })).json();
    expect(snapshot.diagnostics.filter((issue: { severity: string }) => issue.severity === 'error')).toEqual([]);
    expect(snapshot.snapshot).toMatchObject({
      mimeType: 'image/svg+xml',
      handle: expect.any(String),
      byteLength: expect.any(Number)
    });
    expect(JSON.stringify(snapshot)).not.toMatch(/data:|base64|[A-Z]:\\/);
    const svg = await (await app.request(snapshot.snapshot.url)).text();
    expect(svg).toContain('Account');
    expect(svg).toContain('stroke-dasharray');
    expect(svg).not.toMatch(/<image|<foreignObject|data:/);
  });

  it('creates once and applies an atomic revision-checked native edit with precise cascade results', async () => {
    const { runtime, client } = await openRuntime();
    const canvas = runtime.store.createCanvas({ title: 'Native tools' });
    const create = {
      canvasId: canvas.id,
      id: 'diagram',
      x: 0,
      y: 0,
      data: data(),
      layout: 'preserve',
      expectedRevision: canvas.revision
    };
    const created = await client.callTool({ name: name('create-erd'), arguments: create });
    expect(created.isError).not.toBe(true);
    expect(created.structuredContent).toMatchObject({ ok: true, elementId: 'diagram', revision: canvas.revision + 1 });
    const before = runtime.store.getCanvas(canvas.id);
    const duplicate = await client.callTool({
      name: name('create-erd'),
      arguments: { ...create, expectedRevision: before.revision }
    });
    expect(duplicate.isError).toBe(true);
    const target = { canvasId: canvas.id, elementId: 'diagram', expectedRevision: before.revision };
    const stale = await client.callTool({
      name: name('edit-erd'),
      arguments: { ...target, expectedRevision: canvas.revision, operations: [{ op: 'set-title', title: 'stale' }] }
    });
    expect(stale.structuredContent).toMatchObject({ problem: { code: 'revision_conflict', status: 409 } });
    const atomic = await client.callTool({
      name: name('edit-erd'),
      arguments: {
        ...target,
        operations: [
          { op: 'set-title', title: 'should rollback' },
          { op: 'delete-entity', entityId: 'missing' }
        ]
      }
    });
    expect(atomic.isError).toBe(true);
    expect(runtime.store.getCanvas(canvas.id)).toEqual(before);
    const edited = await client.callTool({
      name: name('edit-erd'),
      arguments: { ...target, operations: [{ op: 'delete-attribute', entityId: 'account', attributeId: 'id' }] }
    });
    expect(edited.structuredContent).toMatchObject({
      ok: true,
      revision: before.revision + 1,
      removedRelationshipIds: ['invoices']
    });
    const after = runtime.store.getCanvas(canvas.id);
    expect(after.elements[0].data.relationships).toEqual([]);
    runtime.store.applyOperations(canvas.id, {
      expectedRevision: after.revision,
      operations: [{ op: 'upsertElement', element: { ...after.elements[0], locked: true } }]
    });
    const locked = runtime.store.getCanvas(canvas.id);
    const denied = await client.callTool({
      name: name('edit-erd'),
      arguments: { ...target, expectedRevision: locked.revision, operations: [{ op: 'set-title', title: 'locked' }] }
    });
    expect(denied.isError).toBe(true);
    expect(runtime.store.getCanvas(canvas.id)).toEqual(locked);
    const unsafe = await client.callTool({
      name: name('validate-mermaid'),
      arguments: { source: '%%{init: {securityLevel: "loose"}}%%\nflowchart LR\nA-->B' }
    });
    expect(unsafe.structuredContent).toMatchObject({ ok: false });
    expect(runtime.store.getCanvas(canvas.id)).toEqual(locked);
  });

  it('preserves exact diagrams when the optional extension is absent after restart', async () => {
    const root = installDistributions();
    const databasePath = path.join(root, 'canvas.sqlite');
    let runtime = await createV2Runtime({ pluginsRoot: root, databasePath });
    const canvas = runtime.store.createCanvas({ title: 'Optional extension' });
    runtime.store.applyOperations(canvas.id, { operations: [{ op: 'upsertElement', element: nativeElement() }] });
    const before = runtime.store.getCanvas(canvas.id);
    runtime.dispose();
    fs.renameSync(path.join(root, 'agentcanvas.diagrams'), path.join(root, '.disabled-diagrams'));
    runtime = await createV2Runtime({ pluginsRoot: root, databasePath });
    cleanup.push(() => runtime.dispose());
    const app = createV2App(runtime);
    const response = await (await app.request(`/api/v1/canvases/${canvas.id}`)).json();
    expect(response.canvas.elements).toEqual(before.elements);
    expect(response.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'plugin_unavailable', elementId: 'diagram' })
    );
    expect(runtime.registry.getElementType('agentcanvas.diagrams/erd')).toBeUndefined();
  });
});
