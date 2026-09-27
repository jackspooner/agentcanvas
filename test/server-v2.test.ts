import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMcpV2Server } from '../src/mcp-v2/server';
import { createV2App, createV2Runtime } from '../src/server-v2';
import { MACRO_CREATE_REQUEST_SCHEMA, MACRO_PLAN_REQUEST_SCHEMA, CANVAS_RUN_MACRO_REQUEST_SCHEMA } from '../src/macros';
import { TEST_CANVAS_THEME } from './fixtures/canvas-theme';

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
    `import { PluginValidationError } from '@agentcanvas/plugin-sdk';
    export default { activate(host) {
      host.registerElementType({
        name: 'card', schemaVersion: 1, browser: true, snapshot: 'supported',
        dataSchema: { type: 'object', additionalProperties: false, required: ['title'], properties: { title: { type: 'string' } } },
        summarize: (element) => ({ title: element.data.title }),
        inspect: (element) => element.height < 60 ? [{ code: 'card_content_may_clip', path: '/height', message: 'Increase height to at least 60.' }] : [],
        renderSnapshot: (element) => ({ space: 'frame', layer: 'content', nodes: [
          { kind: 'rect', x: 0, y: 0, width: element.width ?? 100, height: element.height ?? 50, fill: '#ffffff', stroke: '#000000' },
          { kind: 'text', x: 8, y: 22, text: element.data.title, fill: '#000000' }
        ] })
      });
      host.registerProcedure({
        name: 'echo', description: 'Echo a value.',
        inputSchema: { type: 'object', additionalProperties: false, required: ['value'], properties: { value: { type: 'string' } } },
        outputSchema: { type: 'object', additionalProperties: false, required: ['value'], properties: { value: { type: 'string' } } },
        invoke: async (input) => {
          if (input.value === 'reject') throw new PluginValidationError('Use a different value.');
          if (input.value === 'crash') throw new Error('secret-token private-path');
          return { value: input.value };
        }
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
  it('maps SDK validation errors for HTTP procedures without persisting', async () => {
    const runtime = await createV2Runtime({ pluginsRoot: fixturePlugins(), databasePath: ':memory:' });
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      const app = createV2App(runtime);
      const canvas = runtime.store.createCanvas({ title: 'Unchanged' });
      for (const [value, status, code, detail] of [
        ['reject', 400, 'validation_error', 'Use a different value.'],
        ['crash', 500, 'internal_error', 'AgentCanvas could not complete the request.']
      ] as const) {
        const response = await app.request('/api/v1/plugins/fixture.cards/procedures/echo', {
          method: 'POST',
          body: JSON.stringify({ value })
        });
        expect(response.status).toBe(status);
        expect(response.headers.get('content-type')).toContain('application/problem+json');
        const problem = await response.json();
        expect(problem).toMatchObject({ code, status, detail, retryable: false, requestId: expect.any(String) });
        expect(JSON.stringify(problem)).not.toMatch(/secret-token|private-path/);
        expect(runtime.store.getCanvas(canvas.id)).toMatchObject({ revision: canvas.revision, elements: [] });
      }
    } finally {
      stderr.mockRestore();
      runtime.dispose();
    }
  });

  it('persists diagnostics independently of size and applies changes to HTTP, MCP, shares, embeds and snapshots', async () => {
    const pluginsRoot = fixturePlugins();
    const databasePath = path.join(pluginsRoot, 'settings.sqlite');
    const runtime = await createV2Runtime({ pluginsRoot, databasePath });
    const mcp = createMcpV2Server({ ...runtime, publicBaseUrl: runtime.config.publicBaseUrl, diagnostics: () => [] });
    const client = new Client({ name: 'diagnostics-test', version: '1.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    try {
      await Promise.all([mcp.server.connect(serverTransport), client.connect(clientTransport)]);
      const app = createV2App(runtime);
      const created = runtime.store.createCanvas({ title: 'Overlapping cards' });
      const canvas = runtime.store.applyOperations(created.id, {
        operations: Array.from({ length: 3 }, (_, index) => ({
          op: 'upsertElement',
          element: {
            id: `card_${index}`,
            type: 'fixture.cards/card',
            schemaVersion: 1,
            x: 0,
            y: 0,
            width: 100,
            height: 80,
            data: { title: 'Card' }
          }
        }))
      });
      const share = runtime.store.createShareLink(canvas.id, {});
      const embed = runtime.embedSessions.create(
        { canvasIds: [canvas.id], parentOrigin: 'https://host.example', mode: 'read', expiresInSeconds: 300 },
        () => {}
      );
      const embedToken = new URL(embed.url).pathname.split('/').at(-1);
      const patch = (body: unknown) =>
        app.request('/api/v1/configuration', { method: 'PATCH', body: JSON.stringify(body) });
      const size = { mode: 'fixed', width: 800, height: 600 };
      expect((await patch({ defaultCanvasSize: size })).status).toBe(200);
      expect(runtime.store.getConfiguration().diagnostics).toEqual({ overlapMode: 'bounded', maxOverlapWarnings: 100 });
      for (const [overlapMode, expected] of [
        ['off', 0],
        ['bounded', 2],
        ['all', 3]
      ] as const) {
        const response = await patch({ diagnostics: { overlapMode, maxOverlapWarnings: 1 } });
        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({
          configuration: { defaultCanvasSize: size, diagnostics: { overlapMode, maxOverlapWarnings: 1 } }
        });
        for (const [url, method] of [
          [`/api/v1/canvases/${canvas.id}`, 'GET'],
          [`/api/v1/share/${share.token}`, 'GET'],
          [`/api/v1/embed-sessions/${embedToken}`, 'GET'],
          [`/api/v1/canvases/${canvas.id}/snapshot`, 'POST']
        ]) {
          const result = await app.request(url, { method });
          expect(result.status).toBe(200);
          expect((await result.json()).diagnostics).toHaveLength(expected);
        }
        for (const name of ['canvas_get', 'canvas_inspect']) {
          const result = await client.callTool({
            name,
            arguments: { canvasId: canvas.id }
          });
          expect(result.isError).not.toBe(true);
          expect(result.structuredContent).toMatchObject({ diagnostics: expect.any(Array) });
          expect((result.structuredContent as { diagnostics: unknown[] }).diagnostics).toHaveLength(expected);
        }
        const renamed = await client.callTool({
          name: 'canvas_rename',
          arguments: { canvasId: canvas.id, title: canvas.title }
        });
        expect(renamed.structuredContent).toMatchObject({ canvasId: canvas.id, revision: canvas.revision });
        const summary = (renamed.structuredContent as { inspectionSummary: Record<string, number> }).inspectionSummary;
        expect(summary.errorCount + summary.warningCount + summary.infoCount).toBe(expected);
        expect(runtime.store.getCanvas(canvas.id).revision).toBe(canvas.revision);
      }
      for (const body of [
        {},
        { actor: 'test' },
        { diagnostics: null },
        { diagnostics: {} },
        { diagnostics: { overlapMode: 'unknown', maxOverlapWarnings: 1 } },
        ...[0, -1, 1.5, 10001, '10'].map((maxOverlapWarnings) => ({
          diagnostics: { overlapMode: 'bounded', maxOverlapWarnings }
        })),
        { diagnostics: { overlapMode: 'off', maxOverlapWarnings: 1, extra: true } }
      ])
        expect((await patch(body)).status).toBe(400);
      expect(runtime.store.getConfiguration().diagnostics.overlapMode).toBe('all');
      const firstElements = await client.callTool({
        name: 'canvas_list_elements',
        arguments: { canvasId: canvas.id, limit: 2 }
      });
      expect(firstElements.structuredContent).toMatchObject({
        canvasId: canvas.id,
        revision: canvas.revision,
        items: [
          { id: 'card_0', frame: { x: 0, y: 0, width: 100, height: 80 }, summary: { title: 'Card' } },
          { id: 'card_1' }
        ],
        nextCursor: expect.any(String)
      });
      const firstElement = await client.callTool({
        name: 'canvas_get_element',
        arguments: { canvasId: canvas.id, elementId: 'card_0' }
      });
      expect(firstElement.structuredContent).toMatchObject({
        canvasId: canvas.id,
        revision: canvas.revision,
        element: { id: 'card_0', data: { title: 'Card' } }
      });
      const firstInspection = await client.callTool({
        name: 'canvas_inspect',
        arguments: { canvasId: canvas.id, severity: ['warning'], code: ['element_frames_overlap'], limit: 1 }
      });
      expect(firstInspection.structuredContent).toMatchObject({
        diagnostics: [expect.objectContaining({ code: 'element_frames_overlap' })],
        summary: { warningCount: 3 },
        nextCursor: expect.any(String)
      });
      runtime.store.applyOperations(canvas.id, {
        expectedRevision: canvas.revision,
        operations: [
          {
            op: 'upsertElement',
            element: {
              id: 'card_3',
              type: 'fixture.cards/card',
              schemaVersion: 1,
              x: 300,
              y: 0,
              width: 100,
              height: 80,
              data: { title: 'Later' }
            }
          }
        ]
      });
      const stale = await client.callTool({
        name: 'canvas_list_elements',
        arguments: {
          canvasId: canvas.id,
          limit: 2,
          cursor: (firstElements.structuredContent as { nextCursor: string }).nextCursor
        }
      });
      expect(stale.structuredContent).toMatchObject({ problem: { code: 'revision_conflict' } });
      expect((await patch({ defaultCanvasSize: { mode: 'unlimited' } })).status).toBe(200);
      expect(runtime.store.getConfiguration().diagnostics.overlapMode).toBe('all');
    } finally {
      await Promise.all([client.close(), mcp.server.close()]);
      runtime.dispose();
    }
    const reopened = await createV2Runtime({ pluginsRoot, databasePath });
    try {
      expect(reopened.store.getConfiguration()).toMatchObject({
        defaultCanvasSize: { mode: 'unlimited' },
        diagnostics: { overlapMode: 'all', maxOverlapWarnings: 1 }
      });
      reopened.store.db
        .prepare('UPDATE agent_canvas_configuration SET configuration_json=? WHERE id=1')
        .run(JSON.stringify({ defaultCanvasSize: { mode: 'unlimited' } }));
      expect(reopened.store.getConfiguration().diagnostics).toEqual({
        overlapMode: 'bounded',
        maxOverlapWarnings: 100
      });
    } finally {
      reopened.dispose();
    }
  });
  it('validates core requests before writes and correlates sanitized internal failures', async () => {
    const runtime = await createV2Runtime({ pluginsRoot: fixturePlugins(), databasePath: ':memory:' });
    try {
      const app = createV2App(runtime);
      const canvas = runtime.store.createCanvas({ title: 'Validation' });
      for (const body of [
        '{',
        '',
        'null',
        '[]',
        '{"title":"Test","createdBy":"invalid"}',
        '{"title":"Test","background":"invalid"}',
        '{"title":"Test","unexpected":true}'
      ]) {
        expect((await app.request('/api/v1/canvases', { method: 'POST', body })).status).toBe(400);
      }
      const writes = [
        ['PATCH', '/api/v1/configuration'],
        ['PATCH', `/api/v1/canvases/${canvas.id}`],
        ['PATCH', `/api/v1/canvases/${canvas.id}/title`],
        ['PATCH', `/api/v1/canvases/${canvas.id}/theme`],
        ['POST', `/api/v1/canvases/${canvas.id}/elements:batch`],
        ['POST', `/api/v1/canvases/${canvas.id}/share-links`],
        ['POST', `/api/v1/canvases/${canvas.id}/viewport`],
        ['POST', `/api/v1/canvases/${canvas.id}/viewport/focus`]
      ];
      for (const [method, url] of writes) {
        for (const body of ['{', '', 'null', '{"unexpected":true}']) {
          const response = await app.request(url, { method, body });
          expect(response.status, `${method} ${url} ${body}`).toBe(400);
          expect(await response.json()).toMatchObject({ code: 'validation_error', status: 400 });
        }
      }
      expect(runtime.store.listCanvases()).toHaveLength(1);
      expect(runtime.store.getCanvas(canvas.id)).toEqual(canvas);
      expect(runtime.store.listShareLinks(canvas.id)).toEqual([]);
      expect(
        (await app.request(`/api/v1/canvases/${canvas.id}/share-links`, { method: 'POST', body: '{}' })).status
      ).toBe(201);

      const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
      const failure = vi.spyOn(runtime.store, 'getCanvas').mockImplementation(() => {
        throw new Error('secret-token private-path');
      });
      try {
        const response = await app.request('/api/v1/canvases/secret-token', {
          headers: { 'x-request-id': 'req_failure' }
        });
        const problem = await response.json();
        expect(response.status).toBe(500);
        expect(problem).toMatchObject({ requestId: 'req_failure', code: 'internal_error' });
        expect(stderr).toHaveBeenCalledTimes(1);
        const log = String(stderr.mock.calls[0][0]);
        expect(JSON.parse(log)).toMatchObject({
          requestId: 'req_failure',
          route: '/api/v1/canvases/:canvasId',
          status: 500
        });
        expect(log).not.toMatch(/secret-token|private-path/);
      } finally {
        failure.mockRestore();
        stderr.mockRestore();
      }
    } finally {
      runtime.dispose();
    }
  });

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
    expect(await (await app.request('/whoami')).json()).toMatchObject({
      dependencies: {},
      mcp: {
        endpoint: 'http://127.0.0.1:23003/mcp',
        fullEndpoint: 'http://127.0.0.1:23003/mcp/full',
        defaultProfile: 'lean'
      },
      macros: { version: 1, maxTemplates: 100, maxCanvasElements: 2000, maxPlans: 500, planTtlMs: 300000 }
    });

    const plugins = await (await app.request('/api/v1/plugins')).json();
    expect(plugins.plugins[0]).toMatchObject({
      id: 'fixture.cards',
      buildHash: expect.stringMatching(/^[a-f0-9]{24}$/),
      elements: [{ type: 'fixture.cards/card', schemaVersion: 1 }]
    });
    expect(JSON.stringify(plugins)).not.toContain(runtime.registry.plugins[0].plugin.root);

    const invalid = await app.request('/api/v1/canvases', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-request-id': 'req_contract_test' },
      body: JSON.stringify({ title: '' })
    });
    expect(invalid.status).toBe(400);
    expect(invalid.headers.get('content-type')).toContain('application/problem+json');
    expect(invalid.headers.get('x-request-id')).toBe('req_contract_test');
    expect(await invalid.json()).toEqual({
      type: 'urn:workspace2:problem:validation_error',
      title: 'Request validation failed',
      status: 400,
      detail: 'Request body/title must NOT have fewer than 1 characters',
      code: 'validation_error',
      category: 'validation',
      retryable: false,
      requestId: 'req_contract_test',
      instance: '/api/v1/canvases'
    });

    const created = await (
      await app.request('/api/v1/canvases', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'Plugin canvas' })
      })
    ).json();
    const canvasId = created.canvas.id as string;
    expect(created.url).toBe(`http://127.0.0.1:23003/canvases/${canvasId}`);
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

    const themed = await app.request(`/api/v1/canvases/${canvasId}/theme`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ theme: TEST_CANVAS_THEME, expectedRevision: 2, actor: 'test' })
    });
    expect(themed.status).toBe(200);
    expect(await themed.json()).toMatchObject({ canvas: { revision: 3, theme: { name: 'Forest report' } } });

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
    const snapshotSvg = await content.text();
    expect(snapshotSvg).toContain('Hello plugin');
    expect(snapshotSvg).toContain('fill="#f0fdf4"');

    const openapi = await (await app.request('/openapi.json')).json();
    expect(openapi.paths['/api/v1/plugins/fixture.cards/procedures/echo']).toBeDefined();
    expect(openapi.components.schemas.Element_fixture_cards_card).toBeDefined();
    expect(openapi.paths['/api/v1/macros'].post.operationId).toBe('macroCreate');
    for (const path of [
      '/api/v1/macros',
      '/api/v1/macros/{macroId}/versions/{version}',
      '/api/v1/macros/{macroId}/versions',
      '/api/v1/macros/{macroId}',
      '/api/v1/canvases/{canvasId}/macros/{macroId}:plan',
      '/api/v1/canvases/{canvasId}/macros:execute'
    ]) {
      const operation = openapi.paths[path].get ?? openapi.paths[path].post ?? openapi.paths[path].patch;
      expect(operation.operationId).toBeTruthy();
      expect(operation.tags).toEqual(['Macros']);
      expect(operation.summary).toBeTruthy();
      expect(operation['x-agent-notes']).toBeDefined();
      expect(
        Object.values(operation.responses).some((response: any) => response.content?.['application/json']?.example)
      ).toBe(true);
    }
    expect(openapi.components.schemas.MacroDefinitionV1).not.toHaveProperty('$defs');
    expect(openapi.components.schemas.MacroHttpPlanRequest).toBeDefined();
    expect(openapi.components.schemas.MacroPlanRequest).toBeDefined();
    expect(
      openapi.paths['/api/v1/canvases/{canvasId}/macros/{macroId}:plan'].post.requestBody.content['application/json']
        .schema.$ref
    ).toBe('#/components/schemas/MacroHttpPlanRequest');
    expect(openapi.paths['/api/v1/macros/{macroId}/versions'].post.responses['403']).toBeDefined();
    expect(openapi.paths['/api/v1/canvases/{canvasId}/macros:execute'].post.responses['410']).toBeDefined();
    expect(openapi.paths['/api/v1/canvases/{canvasId}/macros:execute'].post['x-agent-notes']).toBeDefined();

    const moduleResponse = await app.request(plugins.plugins[0].browserEntryUrl);
    expect(moduleResponse.status).toBe(200);
    expect(moduleResponse.headers.get('cache-control')).toContain('immutable');

    const mcp = createMcpV2Server({
      publicBaseUrl: runtime.config.publicBaseUrl,
      registry: runtime.registry,
      store: runtime.store,
      browserCatalog: runtime.browserCatalog,
      viewerPresence: runtime.viewerPresence,
      diagnostics: () => runtime.plugins.diagnostics.list()
    });
    const client = new Client({ name: 'test-client', version: '1.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([mcp.server.connect(serverTransport), client.connect(clientTransport)]);
    const listedTools = await client.listTools();
    expect(listedTools.tools.map((tool) => tool.name)).toEqual(mcp.tools.map((tool) => tool.name));
    expect(listedTools.tools.map((tool) => tool.name)).toContain('canvas_rename');
    expect(listedTools.tools.map((tool) => tool.name)).toContain('canvas_get_guidance');
    expect(listedTools.tools.map((tool) => tool.name)).toContain('canvas_inspect');
    expect(listedTools.tools.map((tool) => tool.name)).toContain('canvas_get_url');
    expect(listedTools.tools.map((tool) => tool.name)).toContain('canvas_set_theme');
    expect(listedTools.tools.map((tool) => tool.name)).toContain('canvas_clear_theme');
    expect(listedTools.tools.map((tool) => tool.name)).toContain('canvas_upsert_element');
    expect(JSON.stringify(listedTools.tools.find((tool) => tool.name === 'canvas_upsert_element')).length).toBeLessThan(
      10_000
    );
    const guidanceCall = await client.callTool({ name: 'canvas_get_guidance', arguments: {} });
    expect(guidanceCall.structuredContent).toMatchObject({
      schemaVersion: 1,
      layout: expect.arrayContaining([expect.stringContaining('do not auto-grow after creation')]),
      truth: expect.arrayContaining([expect.stringContaining('persisted data only')]),
      mcpCatalog: { coreToolCount: 30, pluginToolCount: 0, totalToolCount: 30 }
    });
    const invalidMcp = await client.callTool({ name: 'canvas_get', arguments: {} });
    expect(invalidMcp.isError).toBe(true);
    expect(invalidMcp.structuredContent).toMatchObject({
      problem: {
        type: 'urn:workspace2:problem:validation_error',
        status: 400,
        code: 'validation_error',
        category: 'validation',
        retryable: false,
        requestId: expect.stringMatching(/^mcp_/),
        instance: 'mcp://tool/canvas_get'
      }
    });
    const mcpCreated = await client.callTool({ name: 'canvas_create', arguments: { title: 'MCP created canvas' } });
    expect(mcpCreated.structuredContent).toMatchObject({
      canvasId: expect.stringMatching(/^canvas_/),
      revision: 1,
      url: expect.stringMatching(/^http:\/\/127\.0\.0\.1:23003\/canvases\/canvas_/),
      inspectionSummary: { errorCount: 0, warningCount: 0, infoCount: 0 }
    });
    expect(mcpCreated.structuredContent).not.toHaveProperty('elements');
    expect(mcpCreated.structuredContent).not.toHaveProperty('title');
    const canvasUrl = await client.callTool({ name: 'canvas_get_url', arguments: { canvasId } });
    expect(canvasUrl.structuredContent).toEqual({
      canvasId,
      url: `http://127.0.0.1:23003/canvases/${canvasId}`
    });
    const inspectCall = await client.callTool({ name: 'canvas_inspect', arguments: { canvasId } });
    expect(inspectCall.structuredContent).toMatchObject({
      canvasId,
      revision: 3,
      diagnostics: [],
      summary: { errorCount: 0, warningCount: 0, infoCount: 0 }
    });
    const clearThemeCall = await client.callTool({
      name: 'canvas_clear_theme',
      arguments: { canvasId, expectedRevision: 3 }
    });
    expect(clearThemeCall.structuredContent).toEqual({
      canvasId,
      revision: 4,
      inspectionSummary: { errorCount: 0, warningCount: 0, infoCount: 0 }
    });
    const setThemeCall = await client.callTool({
      name: 'canvas_set_theme',
      arguments: { canvasId, theme: TEST_CANVAS_THEME, expectedRevision: 4 }
    });
    expect(setThemeCall.structuredContent).toMatchObject({
      canvasId,
      revision: 5,
      inspectionSummary: { errorCount: 0, warningCount: 0, infoCount: 0 }
    });
    const renameCall = await client.callTool({
      name: 'canvas_rename',
      arguments: { canvasId, title: 'Renamed by agent', expectedRevision: 5 }
    });
    expect(renameCall.structuredContent).toMatchObject({
      canvasId,
      revision: 6,
      inspectionSummary: { errorCount: 0, warningCount: 0, infoCount: 0 }
    });
    const clippingMutation = await client.callTool({
      name: 'canvas_patch_element_frame',
      arguments: { canvasId, elementId: 'card_1', frame: { height: 40 }, expectedRevision: 6 }
    });
    expect(clippingMutation.structuredContent).toMatchObject({
      canvasId,
      revision: 7,
      inspectionSummary: { errorCount: 0, warningCount: 1, infoCount: 0 }
    });
    expect(clippingMutation.structuredContent).not.toHaveProperty('diagnostics');
    expect(clippingMutation.structuredContent).not.toHaveProperty('elements');
    const clippingInspection = await client.callTool({ name: 'canvas_inspect', arguments: { canvasId } });
    expect(clippingInspection.structuredContent).toMatchObject({
      canvasId,
      revision: 7,
      diagnostics: [expect.objectContaining({ code: 'card_content_may_clip', elementId: 'card_1' })],
      summary: { errorCount: 0, warningCount: 1, infoCount: 0 }
    });
    const pluginCall = await client.callTool({ name: 'canvas_list_plugins', arguments: {} });
    expect(pluginCall.structuredContent).toMatchObject({ plugins: [{ id: 'fixture.cards' }] });
    await Promise.all([client.close(), mcp.server.close()]);
    runtime.dispose();
  });

  it('persists macro CRUD, plans purely, and atomically replays the complete result', async () => {
    const runtime = await createV2Runtime({
      pluginsRoot: fixturePlugins(),
      databasePath: ':memory:',
      config: { publicBaseUrl: 'http://127.0.0.1:23003' }
    });
    const app = createV2App(runtime);
    const mcp = createMcpV2Server({
      publicBaseUrl: runtime.config.publicBaseUrl,
      registry: runtime.registry,
      store: runtime.store,
      macros: runtime.macros,
      browserCatalog: runtime.browserCatalog,
      viewerPresence: runtime.viewerPresence,
      diagnostics: () => []
    });
    const catalogBeforeMutations = structuredClone(mcp.tools);
    const canvas = await (
      await app.request('/api/v1/canvases', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'Macro canvas' })
      })
    ).json();
    const canvasId = canvas.canvas.id as string;
    const authoring = {
      scope: 'installation',
      title: 'Insert card',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['title'],
        properties: { title: { type: 'string' } }
      },
      elements: [
        {
          key: 'card',
          type: 'fixture.cards/card',
          schemaVersion: 1,
          x: 0,
          y: 0,
          width: 240,
          height: 80,
          data: { title: { $macroRef: 'input', pointer: '/title' } }
        }
      ]
    };
    const createdResponse = await app.request('/api/v1/macros', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(authoring)
    });
    expect(createdResponse.status).toBe(201);
    const created = await createdResponse.json();
    expect(created.definition.id).toMatch(/^macro_/);
    expect((MACRO_CREATE_REQUEST_SCHEMA as Record<string, unknown>).$id).toContain('MacroCreateRequest');
    const versionResponse = await app.request(`/api/v1/macros/${created.definition.id}/versions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...authoring, expectedCurrentVersion: 1 })
    });
    expect(versionResponse.status).toBe(201);
    const version = await versionResponse.json();
    expect(version.definition.version).toBe(2);
    const exact = await (await app.request(`/api/v1/macros/${created.definition.id}/versions/2`)).json();
    expect(exact.definition.version).toBe(2);
    expect((await (await app.request('/api/v1/macros')).json()).items).toHaveLength(1);
    const planBody = { macroVersion: 2, anchor: { x: 10, y: 20 }, input: { title: 'Hello' } };
    const contradictoryPlan = await app.request(`/api/v1/canvases/${canvasId}/macros/${created.definition.id}:plan`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...planBody, canvasId, macroId: 'other/macro' })
    });
    expect(contradictoryPlan.status).toBe(400);
    expect(
      (
        await (
          await app.request(`/api/v1/macros/${created.definition.id}`, {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ archived: true })
          })
        ).json()
      ).archived
    ).toBe(true);
    const archivedPlan = await app.request(`/api/v1/canvases/${canvasId}/macros/${created.definition.id}:plan`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(planBody)
    });
    expect(archivedPlan.status).toBe(409);
    expect(
      (
        await app.request(`/api/v1/canvases/${canvasId}/macros/${created.definition.id}:wrong`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(planBody)
        })
      ).status
    ).toBe(400);
    await app.request(`/api/v1/macros/${created.definition.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ archived: false })
    });
    expect((MACRO_PLAN_REQUEST_SCHEMA as Record<string, unknown>).$id).toContain('MacroPlanRequest');
    const planResponse = await app.request(`/api/v1/canvases/${canvasId}/macros/${created.definition.id}:plan`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(planBody)
    });
    expect(planResponse.status).toBe(200);
    const plan = await planResponse.json();
    expect(plan.canvasRevision).toBe(1);
    const persisted = await (await app.request(`/api/v1/canvases/${canvasId}`)).json();
    expect(persisted).toMatchObject({ canvas: { revision: 1, elements: [] } });
    const executeBody = { planId: plan.planId, expectedRevision: 1, idempotencyKey: 'macro-replay-1' };
    const firstResponse = await app.request(`/api/v1/canvases/${canvasId}/macros:execute`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(executeBody)
    });
    expect(firstResponse.status).toBe(200);
    const first = await firstResponse.json();
    runtime.macros.plans.clear();
    const replayResponse = await app.request(`/api/v1/canvases/${canvasId}/macros:execute`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(executeBody)
    });
    expect(replayResponse.status).toBe(200);
    expect(await replayResponse.json()).toEqual(first);
    expect(
      (
        await app.request(`/api/v1/canvases/${canvasId}/macros:execute`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ ...executeBody, expectedRevision: 2 })
        })
      ).status
    ).toBe(409);
    expect(runtime.store.db.prepare('SELECT COUNT(*) AS count FROM macro_invocations').get()).toEqual({ count: 1 });
    const invocation = runtime.store.db
      .prepare('SELECT safe_summary_json, outputs_json FROM macro_invocations')
      .get() as { safe_summary_json: string; outputs_json: string };
    const safeSummary = JSON.parse(invocation.safe_summary_json) as Record<string, unknown>;
    expect(safeSummary).toEqual({
      operationCount: 1,
      generatedElementCount: 1,
      affectedElementIds: [expect.any(String)]
    });
    expect(invocation.safe_summary_json).not.toContain('Hello');
    expect(invocation.safe_summary_json).not.toContain('forward');
    expect(invocation.safe_summary_json).not.toContain('upsertElement');
    expect(invocation.outputs_json).not.toContain('Hello');
    expect(runtime.store.getCanvas(canvasId).revision).toBe(2);
    expect(mcp.tools).toEqual(catalogBeforeMutations);
    expect(mcp.tools.map((tool) => tool.name)).toEqual(
      expect.arrayContaining([
        'macro_list',
        'macro_get',
        'macro_create',
        'macro_create_version',
        'macro_archive',
        'macro_plan',
        'canvas_run_macro'
      ])
    );
    expect(mcp.tools.find((tool) => tool.name === 'canvas_run_macro')?.inputSchema).toBe(
      CANVAS_RUN_MACRO_REQUEST_SCHEMA
    );
    const mcpClient = new Client({ name: 'macro-test-client', version: '1.0.0' });
    const [mcpClientTransport, mcpServerTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([mcp.server.connect(mcpServerTransport), mcpClient.connect(mcpClientTransport)]);
    expect((await mcpClient.callTool({ name: 'macro_list', arguments: {} })).structuredContent).toMatchObject({
      items: [{ id: created.definition.id }]
    });
    const createdByMcp = await mcpClient.callTool({
      name: 'macro_create',
      arguments: { ...authoring, title: 'Created through MCP' }
    });
    expect(createdByMcp.structuredContent).toEqual({
      macroId: expect.stringMatching(/^macro_/),
      currentVersion: 1,
      archived: false
    });
    expect(createdByMcp.structuredContent).not.toHaveProperty('definition');
    const versionedByMcp = await mcpClient.callTool({
      name: 'macro_create_version',
      arguments: { ...authoring, macroId: created.definition.id, expectedCurrentVersion: 2 }
    });
    expect(versionedByMcp.structuredContent).toEqual({
      macroId: created.definition.id,
      currentVersion: 3,
      archived: false
    });
    const secondCanvas = await (
      await app.request('/api/v1/canvases', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'MCP plan canvas' })
      })
    ).json();
    const secondPlan = await mcpClient.callTool({
      name: 'macro_plan',
      arguments: { ...planBody, canvasId: secondCanvas.canvas.id, macroId: created.definition.id }
    });
    const planned = secondPlan.structuredContent as { planId: string };
    const planMode = await mcpClient.callTool({
      name: 'canvas_run_macro',
      arguments: {
        mode: 'plan',
        canvasId: secondCanvas.canvas.id,
        planId: planned.planId,
        expectedRevision: 1,
        idempotencyKey: 'mcp-plan-mode'
      }
    });
    expect(planMode.structuredContent).toMatchObject({
      canvasId: secondCanvas.canvas.id,
      revision: 2,
      provenance: { planId: planned.planId },
      affectedElementIds: [expect.any(String)],
      inspectionSummary: { errorCount: 0, warningCount: 0, infoCount: 0 }
    });
    expect(planMode.structuredContent).not.toHaveProperty('canvas');
    expect(planMode.structuredContent).not.toHaveProperty('history');
    const thirdCanvas = await (
      await app.request('/api/v1/canvases', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'MCP direct canvas' })
      })
    ).json();
    const direct = await mcpClient.callTool({
      name: 'canvas_run_macro',
      arguments: {
        mode: 'direct',
        canvasId: thirdCanvas.canvas.id,
        macroId: created.definition.id,
        macroVersion: 2,
        anchor: { x: 0, y: 0 },
        input: { title: 'Direct' },
        expectedRevision: 1,
        idempotencyKey: 'mcp-direct-mode'
      }
    });
    expect(direct.structuredContent).toMatchObject({
      canvasId: thirdCanvas.canvas.id,
      revision: 2,
      provenance: { macroId: created.definition.id, macroVersion: 2 },
      inspectionSummary: { errorCount: 0, warningCount: 0, infoCount: 0 }
    });
    expect(direct.structuredContent).not.toHaveProperty('canvas');
    expect(direct.structuredContent).not.toHaveProperty('history');
    await Promise.all([mcpClient.close(), mcp.server.close()]);
    runtime.dispose();
  });

  it('restricts canvas-scoped macros and distinguishes exact missing versions', async () => {
    const runtime = await createV2Runtime({
      pluginsRoot: fixturePlugins(),
      databasePath: ':memory:',
      config: { publicBaseUrl: 'http://127.0.0.1:23004' }
    });
    const app = createV2App(runtime);
    const canvas1 = (
      await (
        await app.request('/api/v1/canvases', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ title: 'One' })
        })
      ).json()
    ).canvas;
    const canvas2 = (
      await (
        await app.request('/api/v1/canvases', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ title: 'Two' })
        })
      ).json()
    ).canvas;
    const authoring = {
      scope: 'canvas',
      canvasId: canvas1.id,
      title: 'Canvas macro',
      inputSchema: { type: 'object', additionalProperties: false },
      elements: []
    };
    const created = await (
      await app.request('/api/v1/macros', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(authoring)
      })
    ).json();
    expect((await (await app.request(`/api/v1/macros?canvasId=${canvas1.id}`)).json()).items).toHaveLength(1);
    expect((await (await app.request(`/api/v1/macros?canvasId=${canvas2.id}`)).json()).items).toHaveLength(0);
    expect(
      (await app.request(`/api/v1/macros/${created.definition.id}/versions/1?canvasId=${canvas1.id}`)).status
    ).toBe(200);
    expect((await app.request(`/api/v1/macros/${created.definition.id}/versions/1`)).status).toBe(404);
    expect(
      (await app.request(`/api/v1/macros/${created.definition.id}/versions/1?canvasId=${canvas2.id}`)).status
    ).toBe(404);
    const missingVersion = await app.request(
      `/api/v1/macros/${created.definition.id}/versions/9?canvasId=${canvas1.id}`
    );
    expect(missingVersion.status).toBe(404);
    expect((await missingVersion.json()).code).toBe('macro_version_not_found');
    const missingMacro = await app.request('/api/v1/macros/macro_missing/versions/1?canvasId=canvas-1');
    expect(missingMacro.status).toBe(404);
    expect((await missingMacro.json()).code).toBe('macro_not_found');
    expect(
      (
        await app.request(`/api/v1/canvases/${canvas2.id}/macros/${created.definition.id}:plan`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ macroVersion: 1, anchor: { x: 0, y: 0 }, input: {} })
        })
      ).status
    ).toBe(404);
    runtime.dispose();
  });

  it('rolls back every macro write stage when SQLite abort triggers fire', async () => {
    const stages = [
      ['macro_canvas_update_abort', 'BEFORE UPDATE ON canvases'],
      ['macro_canvas_event_abort', 'BEFORE INSERT ON canvas_events'],
      ['macro_invocation_abort', 'BEFORE INSERT ON macro_invocations'],
      ['macro_idempotency_abort', 'BEFORE INSERT ON canvas_idempotency_keys']
    ] as const;
    for (const [trigger, target] of stages) {
      const runtime = await createV2Runtime({
        pluginsRoot: fixturePlugins(),
        databasePath: ':memory:',
        config: { publicBaseUrl: 'http://127.0.0.1:23005' }
      });
      const app = createV2App(runtime);
      const canvasId = (
        await (
          await app.request('/api/v1/canvases', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ title: trigger })
          })
        ).json()
      ).canvas.id as string;
      const authoring = {
        scope: 'installation',
        title: 'Atomic card',
        inputSchema: {
          type: 'object',
          additionalProperties: false,
          required: ['title'],
          properties: { title: { type: 'string' } }
        },
        elements: [
          {
            key: 'card',
            type: 'fixture.cards/card',
            schemaVersion: 1,
            x: 0,
            y: 0,
            width: 240,
            height: 80,
            data: { title: { $macroRef: 'input', pointer: '/title' } }
          }
        ]
      };
      const macro = await (
        await app.request('/api/v1/macros', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(authoring)
        })
      ).json();
      const plan = await (
        await app.request(`/api/v1/canvases/${canvasId}/macros/${macro.definition.id}:plan`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ macroVersion: 1, anchor: { x: 0, y: 0 }, input: { title: 'private input' } })
        })
      ).json();
      runtime.store.db.exec(`CREATE TRIGGER ${trigger} ${target} BEGIN SELECT RAISE(ABORT, '${trigger}'); END;`);
      const failed = await app.request(`/api/v1/canvases/${canvasId}/macros:execute`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ planId: plan.planId, expectedRevision: 1, idempotencyKey: `rollback-${trigger}` })
      });
      expect(failed.status, await failed.clone().text()).toBe(500);
      expect(runtime.store.getCanvas(canvasId)).toMatchObject({ revision: 1, elements: [] });
      for (const table of ['canvas_events', 'macro_invocations', 'canvas_idempotency_keys'])
        expect(runtime.store.db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get()).toEqual({ count: 0 });
      runtime.store.db.exec(`DROP TRIGGER ${trigger}`);
      runtime.dispose();
    }
  });
});
