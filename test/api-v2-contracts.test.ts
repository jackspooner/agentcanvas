import type {
  CapabilityProvider,
  ElementTypeDescriptor,
  JsonObject,
  PluginDiagnostic,
  PluginManifest,
  PluginProcedureDescriptor,
  PluginToolDescriptor
} from '@agentcanvas/plugin-sdk';
import { describe, expect, it } from 'vitest';
import {
  assertMcpToolCatalogParity,
  CANVAS_ELEMENT_SCHEMA,
  compareMcpToolCatalogs,
  createMcpToolCatalog,
  createPluginStatusCatalog,
  createProcedureCatalog,
  createRegistryOpenApiDocument,
  getPluginStatus
} from '../src/api-v2/index.js';
import { FrozenPluginRegistry, type ActivatedPlugin } from '../src/plugin-runtime/index.js';

const dataSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['message'],
  properties: { message: { type: 'string' } }
} as const;
const outputSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['ok'],
  properties: { ok: { type: 'boolean' } }
} as const;

function manifest(id = 'agentcanvas.fixture'): PluginManifest {
  return {
    apiVersion: 'agentcanvas.plugin/v1',
    id,
    version: '1.2.3',
    displayName: 'Fixture plugin',
    description: 'Contract fixture',
    license: 'MIT',
    entrypoints: { server: 'dist/server.mjs', browser: 'dist/browser/entry.mjs' },
    requires: {
      hostApi: '^1.0.0',
      plugins: {},
      capabilities: { 'agentcanvas.assets': '^1.0.0' }
    },
    provides: { capabilities: {} },
    permissions: ['canvas.read', 'canvas.mutate-own'],
    contributes: {
      elements: [{ name: 'card', schemaVersion: 2, browser: true, snapshot: 'supported' }],
      tools: ['add-card'],
      procedures: ['export-card'],
      migrations: []
    },
    configuration: {
      schema: 'schemas/config.schema.json',
      file: 'plugin.config.json',
      environment: ['FIXTURE_SECRET_TOKEN']
    }
  };
}

function element(): ElementTypeDescriptor {
  return {
    name: 'card',
    schemaVersion: 2,
    dataSchema: dataSchema as unknown as JsonObject,
    browser: true,
    snapshot: 'supported',
    summarize: () => ({ title: 'Card' })
  };
}

function tool(name = 'add-card'): PluginToolDescriptor {
  return {
    name,
    title: 'Add card',
    description: 'Add a fixture card',
    inputSchema: dataSchema as unknown as JsonObject,
    outputSchema: outputSchema as unknown as JsonObject,
    annotations: { destructiveHint: false, idempotentHint: true },
    invoke: async () => ({ ok: true })
  };
}

function procedure(): PluginProcedureDescriptor {
  return {
    name: 'export-card',
    description: 'Export a fixture card',
    inputSchema: dataSchema as unknown as JsonObject,
    outputSchema: outputSchema as unknown as JsonObject,
    invoke: async () => ({ ok: true })
  };
}

function activated(id = 'agentcanvas.fixture', toolName = 'add-card'): ActivatedPlugin {
  const pluginManifest = manifest(id);
  if (toolName !== 'add-card') {
    pluginManifest.contributes = { ...pluginManifest.contributes, tools: [toolName] };
  }
  return {
    plugin: {
      manifest: pluginManifest,
      root: `C:\\private\\plugins\\${id}`,
      serverEntry: `C:\\private\\plugins\\${id}\\dist\\server.mjs`,
      browserEntry: `C:\\private\\plugins\\${id}\\dist\\browser\\entry.mjs`,
      config: { apiToken: 'top-secret-config-value' }
    },
    elements: [element()],
    tools: [tool(toolName)],
    procedures: [procedure()],
    migrations: []
  };
}

function registry(plugins: ActivatedPlugin[] = [activated()]): FrozenPluginRegistry {
  const provider: CapabilityProvider<unknown> = {
    name: 'agentcanvas.assets',
    version: '1.0.0',
    value: { token: 'top-secret-capability-value' }
  };
  return new FrozenPluginRegistry(plugins, new Map([[provider.name, provider]]));
}

describe('v0.2 registry-driven API contracts', () => {
  it('projects plugin status without paths, configuration, environment, or capability values', () => {
    const diagnostics: PluginDiagnostic[] = [
      {
        code: 'fixture_warning',
        severity: 'warning',
        message: 'A safe fixture warning',
        retryable: true,
        pluginId: 'agentcanvas.fixture'
      }
    ];
    const catalog = createPluginStatusCatalog(registry(), {
      browserEntries: [
        {
          id: 'agentcanvas.fixture',
          browserBuildHash: 'build-hash',
          browserEntryUrl: '/api/v1/plugin-modules/agentcanvas.fixture/build-hash/entry.mjs'
        }
      ],
      diagnostics,
      capabilityStatus: { 'agentcanvas.assets': { ok: true } }
    });
    const status = getPluginStatus(catalog, 'agentcanvas.fixture');
    expect(status).toMatchObject({
      id: 'agentcanvas.fixture',
      browserEntryUrl: '/api/v1/plugin-modules/agentcanvas.fixture/build-hash/entry.mjs',
      contributions: { elements: [{ type: 'agentcanvas.fixture/card', schemaVersion: 2 }] },
      capabilities: [
        {
          name: 'agentcanvas.assets',
          relationship: 'required',
          version: null,
          range: '^1.0.0',
          providerPluginId: null,
          status: { ok: true }
        }
      ],
      diagnostics
    });
    const serialized = JSON.stringify(catalog);
    for (const privateValue of [
      'C:\\private',
      'top-secret-config-value',
      'top-secret-capability-value',
      'FIXTURE_SECRET_TOKEN',
      'plugin.config.json',
      'dist/server.mjs'
    ]) {
      expect(serialized).not.toContain(privateValue);
    }
  });

  it('uses one procedure catalog for lookup and concrete OpenAPI operations', () => {
    const frozen = registry();
    const procedures = createProcedureCatalog(frozen);
    expect(procedures.get('agentcanvas.fixture', 'export-card')).toMatchObject({
      operationId: 'plugin_agentcanvas_fixture__export_card',
      path: '/api/v1/plugins/agentcanvas.fixture/procedures/export-card'
    });
    const document = createRegistryOpenApiDocument(frozen, {
      version: '0.2.0',
      procedureCatalog: procedures,
      corePaths: {
        '/api/v1/canvases': {
          get: { operationId: 'canvasList', responses: { 200: { description: 'Canvas list' } } }
        }
      }
    });
    const paths = document.paths as Record<string, Record<string, JsonObject>>;
    const operation = paths['/api/v1/plugins/agentcanvas.fixture/procedures/export-card'].post;
    expect(operation.operationId).toBe('plugin_agentcanvas_fixture__export_card');
    expect((operation.requestBody as JsonObject).content).toEqual({
      'application/json': { schema: dataSchema }
    });
    expect(operation['x-agent-notes']).toMatchObject({ sideEffects: expect.any(Array) });
    expect(paths['/api/v1/canvases'].get.operationId).toBe('canvasList');

    const schemas = (document.components as JsonObject).schemas as JsonObject;
    expect(schemas.CanvasElement).toEqual(CANVAS_ELEMENT_SCHEMA);
    expect(schemas.WritableCanvasElement).toEqual({
      oneOf: [{ $ref: '#/components/schemas/Element_agentcanvas_fixture_card' }]
    });
    expect(schemas.Element_agentcanvas_fixture_card).toMatchObject({
      allOf: [
        CANVAS_ELEMENT_SCHEMA,
        {
          properties: {
            type: { const: 'agentcanvas.fixture/card' },
            schemaVersion: { const: 2 },
            data: dataSchema,
            style: { type: 'null' }
          }
        }
      ]
    });
  });

  it('derives canonical JSON-Schema MCP names and detects HTTP/stdio drift', () => {
    const catalog = createMcpToolCatalog(registry(), [
      {
        name: 'canvas_list_plugins',
        title: 'List plugins',
        description: 'List active plugins',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        outputSchema: { type: 'object' }
      }
    ]);
    expect(catalog.map((entry) => entry.name)).toEqual(['agentcanvas_fixture__add_card', 'canvas_list_plugins']);
    expect(catalog[0]).toMatchObject({ source: 'plugin', pluginId: 'agentcanvas.fixture', localName: 'add-card' });

    const reordered = catalog.map((entry) => ({
      name: entry.name,
      inputSchema:
        entry.name === 'canvas_list_plugins'
          ? { additionalProperties: false, properties: {}, type: 'object' }
          : entry.inputSchema,
      outputSchema: entry.outputSchema
    }));
    expect(compareMcpToolCatalogs(catalog, reordered)).toEqual({
      ok: true,
      missing: [],
      unexpected: [],
      schemaMismatches: []
    });
    expect(() =>
      assertMcpToolCatalogParity(catalog, [
        ...reordered.slice(0, 1).map((entry) => ({ ...entry, outputSchema: false })),
        { name: 'unexpected', inputSchema: true, outputSchema: true }
      ])
    ).toThrow(/missing=canvas_list_plugins.*unexpected=unexpected.*schemas=agentcanvas_fixture__add_card/);
  });

  it('fails on normalized plugin tool and OpenAPI path collisions', () => {
    expect(() => createMcpToolCatalog(registry([activated('a-b', 'run'), activated('a.b', 'run')]))).toThrow(
      'MCP tool name collision: a_b__run'
    );
    expect(() =>
      createRegistryOpenApiDocument(registry(), {
        version: '0.2.0',
        corePaths: { '/api/v1/plugins': { get: { operationId: 'conflict' } } }
      })
    ).toThrow('OpenAPI operation collision: GET /api/v1/plugins');
  });
});
