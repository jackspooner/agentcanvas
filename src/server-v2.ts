import fs from 'node:fs';
import { createServer, type RequestListener } from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { getRequestListener } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import type {
  AssetsCapabilityV1,
  CanvasElement,
  JsonObject,
  PluginDiagnostic,
  PluginInvocationContext
} from '@agentcanvas/plugin-sdk';
import { CANVAS_THEME_V1_SCHEMA, DEFAULT_CANVAS_THEME } from '@agentcanvas/plugin-sdk';
import Ajv2020, { type ValidateFunction } from 'ajv/dist/2020.js';
import { Hono, type Context } from 'hono';
import { nanoid } from 'nanoid';
import {
  createPluginStatusCatalog,
  createProcedureCatalog,
  createRegistryOpenApiDocument,
  getPluginStatus,
  CANVAS_BOUNDS_SCHEMA,
  CANVAS_RECORD_SCHEMA,
  SHARE_LINK_SCHEMA,
  VIEWPORT_SCHEMA
} from './api-v2/index.js';
import { loadConfig, type AgentCanvasConfig } from './config.js';
import { CanvasError, toCanvasError } from './errors.js';
import {
  createPluginCanvasOperations,
  createBrowserPluginCatalog,
  inspectCanvasElements,
  PluginElementValidator,
  preparePluginRuntime,
  resolveBrowserPluginModule,
  type BrowserPluginCatalog,
  type FrozenPluginRegistry,
  type PreparedPluginRuntime
} from './plugin-runtime/index.js';
import type { ResourceBroker } from './resources/broker.js';
import { collectSnapshotItems, composeSnapshot } from './snapshot-runtime/index.js';
import { assertTrustedRequest, SECURITY_RESPONSE_HEADERS, SecurityPolicyError } from './security.js';
import { V2SqliteCanvasStore, type V2CanvasRecord } from './store/v2.js';
import { handleMcpV2Request } from './mcp-v2/http.js';
import { assertPluginSchemasReady } from './migrations/plugin-schema.js';
import { AGENTCANVAS_HOST_API_VERSION, AGENTCANVAS_VERSION } from './version.js';

interface V2Runtime {
  config: AgentCanvasConfig;
  plugins: PreparedPluginRuntime;
  registry: FrozenPluginRegistry;
  browserCatalog: BrowserPluginCatalog;
  resources: ResourceBroker;
  store: V2SqliteCanvasStore;
  openapi: JsonObject;
  developmentReloadVersion?: string;
}

const INSTALLATION_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WEB_BUILD_ROOT = path.join(INSTALLATION_ROOT, 'dist', 'web');
const WEB_SHELL_PATH = path.join(WEB_BUILD_ROOT, 'index.html');

function readWebShell(): string {
  try {
    return fs.readFileSync(WEB_SHELL_PATH, 'utf8');
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`AgentCanvas browser build is unavailable at ${WEB_SHELL_PATH}: ${detail}`);
  }
}

export interface CreateV2RuntimeOptions {
  config?: Partial<AgentCanvasConfig>;
  pluginsRoot?: string;
  databasePath?: string;
  developmentReloadVersion?: string;
}

function invocationContext(
  store: V2SqliteCanvasStore,
  registry: FrozenPluginRegistry,
  pluginId: string,
  signal: AbortSignal
): PluginInvocationContext {
  const plugin = registry.getPlugin(pluginId);
  if (!plugin) throw new CanvasError('plugin_unavailable', `plugin is not active: ${pluginId}`, 'not_found', 404);
  return {
    signal,
    correlationId: `call_${nanoid(16)}`,
    canvas: createPluginCanvasOperations(store, pluginId, plugin.plugin.manifest.permissions)
  };
}

function anchorPoint(
  element: Readonly<CanvasElement>,
  anchor: 'center' | 'top' | 'right' | 'bottom' | 'left' = 'center'
): { x: number; y: number } {
  const width = element.width ?? 0;
  const height = element.height ?? 0;
  if (anchor === 'top') return { x: element.x + width / 2, y: element.y };
  if (anchor === 'right') return { x: element.x + width, y: element.y + height / 2 };
  if (anchor === 'bottom') return { x: element.x + width / 2, y: element.y + height };
  if (anchor === 'left') return { x: element.x, y: element.y + height / 2 };
  return { x: element.x + width / 2, y: element.y + height / 2 };
}

async function resolveCanvasProjection(
  canvas: V2CanvasRecord,
  registry: FrozenPluginRegistry,
  readOnly: boolean,
  signal: AbortSignal
): Promise<{ elementRuntime: Record<string, JsonObject>; diagnostics: PluginDiagnostic[] }> {
  const elementRuntime: Record<string, JsonObject> = {};
  const diagnostics: PluginDiagnostic[] = inspectCanvasElements(canvas, registry);
  const elements = new Map(canvas.elements.map((element) => [element.id, element]));
  for (const element of canvas.elements) {
    const descriptor = registry.getElementType(element.type);
    if (!descriptor) continue;
    let runtime: JsonObject = {};
    if (descriptor.resolve) {
      try {
        const resolved = await descriptor.resolve(element, {
          signal,
          canvasId: canvas.id,
          readOnly,
          geometry: {
            getElementFrame(elementId) {
              const target = elements.get(elementId);
              return target ? { x: target.x, y: target.y, width: target.width ?? 0, height: target.height ?? 0 } : null;
            },
            resolveAnchor(elementId, anchor) {
              const target = elements.get(elementId);
              return target ? anchorPoint(target, anchor) : null;
            }
          }
        });
        runtime = { ...runtime, ...resolved.runtime };
        diagnostics.push(...(resolved.diagnostics ?? []));
      } catch {
        diagnostics.push({
          code: 'element_resolution_failed',
          severity: 'error',
          message: `Runtime projection failed for ${element.type}.`,
          retryable: true,
          pluginId: element.type.slice(0, element.type.lastIndexOf('/')),
          elementId: element.id
        });
      }
    }
    if (Object.keys(runtime).length) elementRuntime[element.id] = runtime;
  }
  return { elementRuntime, diagnostics };
}

async function capabilityStatus(
  registry: FrozenPluginRegistry
): Promise<Record<string, { ok: boolean; code?: string; retryable?: boolean }>> {
  const result: Record<string, { ok: boolean; code?: string; retryable?: boolean }> = {};
  for (const [name, provider] of Object.entries(registry.capabilities)) {
    const readiness = await provider.readiness?.();
    result[name] = readiness
      ? {
          ok: readiness.ok,
          ...(readiness.code ? { code: readiness.code } : {}),
          ...(readiness.retryable !== undefined ? { retryable: readiness.retryable } : {})
        }
      : { ok: true };
  }
  return result;
}

async function assetsProviderStatus(
  registry: FrozenPluginRegistry,
  signal?: AbortSignal
): Promise<{
  ok: boolean;
  identity?: string;
  capabilities?: readonly string[];
  code?: string;
  retryable?: boolean;
} | null> {
  const provider = registry.capabilities['agentcanvas.assets'];
  if (!provider) return null;
  const value = provider.value as AssetsCapabilityV1;
  if (typeof value.providerStatus !== 'function') {
    return { ok: false, code: 'assets_provider_status_missing', retryable: false };
  }
  try {
    return await value.providerStatus(signal);
  } catch {
    return { ok: false, code: 'assets_unavailable', retryable: true };
  }
}

export function coreOpenApiPaths(): Record<string, JsonObject> {
  const canvasId = { name: 'canvasId', in: 'path', required: true, schema: { type: 'string' } };
  const jsonBody = (schema: JsonObject): JsonObject => ({
    required: true,
    content: { 'application/json': { schema } }
  });
  const response = (description: string, schema?: JsonObject): JsonObject => ({
    description,
    ...(schema ? { content: { 'application/json': { schema } } } : {})
  });
  const errorResponses = {
    400: response('Request validation failed', { $ref: '#/components/schemas/ApiError' }),
    404: response('Resource was not found', { $ref: '#/components/schemas/ApiError' }),
    409: response('Revision or idempotency conflict', { $ref: '#/components/schemas/ApiError' }),
    500: response('AgentCanvas failed to complete the request', { $ref: '#/components/schemas/ApiError' })
  };
  const canvasProjection = {
    type: 'object',
    required: ['ok', 'canvas', 'elementRuntime', 'diagnostics'],
    properties: {
      ok: { const: true },
      canvas: { $ref: '#/components/schemas/CanvasRecord' },
      elementRuntime: { type: 'object', additionalProperties: { type: 'object' } },
      diagnostics: { type: 'array', items: { $ref: '#/components/schemas/PluginDiagnostic' } }
    }
  };
  const agentNotes = (sideEffects: string[] = [], retry = false): JsonObject => ({
    sideEffects,
    idempotency: sideEffects.length
      ? 'Use expectedRevision; element batches may also use idempotencyKey.'
      : 'Read-only.',
    retry: retry ? 'Retry only when the returned error marks retryable=true.' : 'No retry is normally required.'
  });
  return {
    '/health': {
      get: {
        operationId: 'canvasHealth',
        summary: 'Check AgentCanvas readiness and optional capability status',
        tags: ['Service'],
        responses: {
          200: response('Service is ready')
        },
        'x-agent-notes': agentNotes([], true)
      }
    },
    '/whoami': {
      get: {
        operationId: 'canvasWhoami',
        summary: 'Inspect safe service, plugin, MCP, and optional dependency identity',
        tags: ['Service'],
        responses: { 200: response('Safe service identity') },
        'x-agent-notes': agentNotes()
      }
    },
    '/api/v1/configuration': {
      get: {
        operationId: 'canvasGetConfiguration',
        summary: 'Get AgentCanvas document defaults',
        tags: ['Configuration'],
        responses: { 200: response('Current configuration') },
        'x-agent-notes': agentNotes()
      },
      patch: {
        operationId: 'canvasUpdateConfiguration',
        summary: 'Replace AgentCanvas document defaults',
        tags: ['Configuration'],
        requestBody: jsonBody({
          type: 'object',
          additionalProperties: false,
          required: ['defaultCanvasSize'],
          properties: { defaultCanvasSize: { $ref: '#/components/schemas/CanvasBounds' }, actor: { type: 'string' } }
        }),
        responses: { 200: response('Updated configuration'), ...errorResponses },
        'x-agent-notes': agentNotes(['Changes defaults for canvases created later.'])
      }
    },
    '/api/v1/canvases': {
      get: {
        operationId: 'canvasList',
        summary: 'List canvases',
        tags: ['Canvases'],
        parameters: [
          { name: 'project', in: 'query', schema: { type: 'string' } },
          { name: 'conversationId', in: 'query', schema: { type: 'string' } },
          { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 200 } }
        ],
        responses: { 200: response('Canvas list') },
        'x-agent-notes': agentNotes()
      },
      post: {
        operationId: 'canvasCreate',
        summary: 'Create a canvas',
        tags: ['Canvases'],
        requestBody: jsonBody({
          type: 'object',
          additionalProperties: false,
          required: ['title'],
          properties: {
            title: { type: 'string', minLength: 1 },
            description: { type: 'string' },
            project: { type: 'string' },
            conversationId: { type: 'string' },
            createdBy: { type: 'string', enum: ['agent', 'user', 'system'] },
            bounds: { $ref: '#/components/schemas/CanvasBounds' },
            background: { type: 'object' },
            theme: { oneOf: [{ $ref: '#/components/schemas/CanvasThemeV1' }, { type: 'null' }] },
            metadata: { type: 'object' }
          }
        }),
        responses: { 201: response('Created canvas'), ...errorResponses },
        'x-agent-notes': agentNotes(['Creates one canvas.'])
      }
    },
    '/api/v1/canvases/{canvasId}': {
      get: {
        operationId: 'canvasGet',
        summary: 'Get a canonical canvas plus runtime projection',
        tags: ['Canvases'],
        parameters: [canvasId],
        responses: { 200: response('Canvas projection', canvasProjection), 404: errorResponses[404] },
        'x-agent-notes': agentNotes()
      },
      patch: {
        operationId: 'canvasUpdateBounds',
        summary: 'Update canvas bounds',
        tags: ['Canvases'],
        parameters: [canvasId],
        requestBody: jsonBody({
          type: 'object',
          additionalProperties: false,
          required: ['bounds'],
          properties: {
            bounds: { $ref: '#/components/schemas/CanvasBounds' },
            expectedRevision: { type: 'integer', minimum: 1 },
            actor: { type: 'string' }
          }
        }),
        responses: { 200: response('Updated canvas'), ...errorResponses },
        'x-agent-notes': agentNotes(['Updates bounds and increments the canvas revision.'], true)
      }
    },
    '/api/v1/canvases/{canvasId}/title': {
      patch: {
        operationId: 'canvasRename',
        summary: 'Rename a canvas',
        tags: ['Canvases'],
        parameters: [canvasId],
        requestBody: jsonBody({
          type: 'object',
          additionalProperties: false,
          required: ['title'],
          properties: {
            title: { type: 'string', minLength: 1 },
            expectedRevision: { type: 'integer', minimum: 1 },
            actor: { type: 'string' }
          }
        }),
        responses: { 200: response('Renamed canvas'), ...errorResponses },
        'x-agent-notes': agentNotes(['Renames the canvas and increments its revision.'], true)
      }
    },
    '/api/v1/canvases/{canvasId}/theme': {
      patch: {
        operationId: 'canvasSetTheme',
        summary: 'Set or clear a canvas theme',
        tags: ['Canvases'],
        parameters: [canvasId],
        requestBody: jsonBody({
          type: 'object',
          additionalProperties: false,
          required: ['theme'],
          properties: {
            theme: { oneOf: [{ $ref: '#/components/schemas/CanvasThemeV1' }, { type: 'null' }] },
            expectedRevision: { type: 'integer', minimum: 1 },
            actor: { type: 'string' }
          }
        }),
        responses: { 200: response('Updated canvas theme'), ...errorResponses },
        'x-agent-notes': agentNotes(
          ['Replaces the canvas-level semantic design tokens and increments the canvas revision.'],
          true
        )
      }
    },
    '/api/v1/canvases/{canvasId}/elements:batch': {
      post: {
        operationId: 'canvasMutateElements',
        summary: 'Apply explicit element operations',
        tags: ['Elements'],
        parameters: [canvasId],
        requestBody: jsonBody({
          type: 'object',
          additionalProperties: false,
          required: ['operations'],
          properties: {
            expectedRevision: { type: 'integer', minimum: 1 },
            idempotencyKey: { type: 'string', minLength: 1 },
            actor: { type: 'string' },
            operations: {
              type: 'array',
              minItems: 1,
              items: {
                oneOf: [
                  {
                    type: 'object',
                    additionalProperties: false,
                    required: ['op', 'element'],
                    properties: {
                      op: { const: 'upsertElement' },
                      element: { $ref: '#/components/schemas/WritableCanvasElement' }
                    }
                  },
                  {
                    type: 'object',
                    required: ['op', 'elementId'],
                    properties: {
                      op: {
                        enum: ['patchElementFrame', 'replaceElementData', 'replaceElementMetadata', 'deleteElement']
                      },
                      elementId: { type: 'string' },
                      frame: { type: 'object' },
                      data: { type: 'object' },
                      style: { type: ['object', 'null'] },
                      metadata: { type: 'object' }
                    }
                  },
                  {
                    type: 'object',
                    additionalProperties: false,
                    required: ['op'],
                    properties: { op: { const: 'clear' } }
                  }
                ]
              }
            }
          }
        }),
        responses: { 200: response('Updated canvas projection', canvasProjection), ...errorResponses },
        'x-agent-notes': agentNotes(['Mutates element envelopes and increments the canvas revision.'], true)
      }
    },
    '/api/v1/canvases/{canvasId}/snapshot': {
      post: {
        operationId: 'canvasSnapshot',
        summary: 'Render a safe SVG snapshot into an opaque resource',
        tags: ['Snapshots'],
        parameters: [canvasId],
        responses: {
          200: response('Snapshot resource handle and diagnostics', {
            type: 'object',
            required: ['snapshot', 'diagnostics'],
            properties: {
              snapshot: { $ref: '#/components/schemas/ResourceHandle' },
              diagnostics: { type: 'array', items: { $ref: '#/components/schemas/PluginDiagnostic' } }
            }
          }),
          ...errorResponses
        },
        'x-agent-notes': agentNotes(['Creates an expiring in-memory resource handle.'], true)
      }
    },
    '/api/v1/canvases/{canvasId}/share-links': {
      get: {
        operationId: 'canvasListShareLinks',
        summary: 'List share links',
        tags: ['Sharing'],
        parameters: [canvasId],
        responses: { 200: response('Share links'), 404: errorResponses[404] },
        'x-agent-notes': agentNotes()
      },
      post: {
        operationId: 'canvasCreateShareLink',
        summary: 'Create a read-only share link',
        tags: ['Sharing'],
        parameters: [canvasId],
        requestBody: jsonBody({
          type: 'object',
          additionalProperties: false,
          properties: { label: { type: 'string' }, expiresAt: { type: ['string', 'null'] } }
        }),
        responses: { 201: response('Created share link'), ...errorResponses },
        'x-agent-notes': agentNotes(['Creates a revocable read-only share token.'])
      }
    },
    '/api/v1/canvases/{canvasId}/share-links/{shareLinkId}': {
      delete: {
        operationId: 'canvasRevokeShareLink',
        summary: 'Revoke a share link',
        tags: ['Sharing'],
        parameters: [canvasId, { name: 'shareLinkId', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { 200: response('Revoked share link'), ...errorResponses },
        'x-agent-notes': agentNotes(['Revokes the selected share link.'])
      }
    },
    '/api/v1/canvases/{canvasId}/viewport': {
      get: {
        operationId: 'canvasGetViewport',
        summary: 'Get user and agent viewport state',
        tags: ['Viewport'],
        parameters: [canvasId],
        responses: { 200: response('Viewport state'), 404: errorResponses[404] },
        'x-agent-notes': agentNotes()
      },
      post: {
        operationId: 'canvasSaveUserViewport',
        summary: 'Save the user viewport',
        tags: ['Viewport'],
        parameters: [canvasId],
        requestBody: jsonBody({
          type: 'object',
          required: ['centerX', 'centerY', 'zoom', 'width', 'height'],
          properties: {
            centerX: { type: 'number' },
            centerY: { type: 'number' },
            zoom: { type: 'number', exclusiveMinimum: 0 },
            width: { type: 'integer', minimum: 1 },
            height: { type: 'integer', minimum: 1 }
          }
        }),
        responses: { 200: response('Saved user viewport'), ...errorResponses },
        'x-agent-notes': agentNotes(['Updates user viewport state.'])
      }
    },
    '/api/v1/canvases/{canvasId}/viewport/focus': {
      post: {
        operationId: 'canvasFocusAgentViewport',
        summary: 'Publish an agent viewport focus',
        tags: ['Viewport'],
        parameters: [canvasId],
        requestBody: jsonBody({
          type: 'object',
          required: ['centerX', 'centerY', 'zoom', 'width', 'height'],
          properties: {
            centerX: { type: 'number' },
            centerY: { type: 'number' },
            zoom: { type: 'number', exclusiveMinimum: 0 },
            width: { type: 'integer', minimum: 1 },
            height: { type: 'integer', minimum: 1 }
          }
        }),
        responses: { 200: response('Saved agent viewport'), ...errorResponses },
        'x-agent-notes': agentNotes(['Updates agent viewport state.'])
      }
    },
    '/api/v1/share/{token}': {
      get: {
        operationId: 'canvasResolveShare',
        summary: 'Resolve a read-only share token',
        tags: ['Sharing'],
        parameters: [{ name: 'token', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { 200: response('Read-only canvas projection'), 404: errorResponses[404] },
        'x-agent-notes': agentNotes()
      }
    },
    '/api/v1/plugin-modules/{pluginId}/{buildHash}/{modulePath}': {
      get: {
        operationId: 'canvasGetPluginModule',
        summary: 'Load an immutable same-origin browser plugin module',
        tags: ['Plugins'],
        parameters: [
          { name: 'pluginId', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'buildHash', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'modulePath', in: 'path', required: true, schema: { type: 'string' } }
        ],
        responses: { 200: response('Immutable ESM module bytes'), 404: errorResponses[404] },
        'x-agent-notes': agentNotes()
      }
    }
  };
}

export async function createV2Runtime(options: CreateV2RuntimeOptions = {}): Promise<V2Runtime> {
  const config = loadConfig({ ...options.config, databasePath: options.databasePath ?? options.config?.databasePath });
  const plugins = await preparePluginRuntime(options.pluginsRoot);
  const store = new V2SqliteCanvasStore(new PluginElementValidator(plugins.registry), config.databasePath, config);
  plugins.bindDatabase(store.db);
  assertPluginSchemasReady(store.db, plugins.registry, config.databasePath, plugins.pluginsRoot);
  const browserCatalog = await createBrowserPluginCatalog(plugins.registry);
  const openapi = createRegistryOpenApiDocument(plugins.registry, {
    title: 'AgentCanvas API',
    version: AGENTCANVAS_VERSION,
    description: 'Registry-derived AgentCanvas HTTP contract.',
    serverUrls: [config.publicBaseUrl],
    corePaths: coreOpenApiPaths(),
    additionalSchemas: {
      CanvasBounds: CANVAS_BOUNDS_SCHEMA,
      CanvasThemeV1: CANVAS_THEME_V1_SCHEMA,
      CanvasRecord: CANVAS_RECORD_SCHEMA,
      Viewport: VIEWPORT_SCHEMA,
      ShareLink: SHARE_LINK_SCHEMA
    }
  });
  return {
    config,
    plugins,
    registry: plugins.registry,
    browserCatalog,
    resources: plugins.resources,
    store,
    openapi,
    ...(options.developmentReloadVersion ? { developmentReloadVersion: options.developmentReloadVersion } : {})
  };
}

export function createV2App(runtime: V2Runtime): Hono {
  const { config, registry, browserCatalog, resources, store } = runtime;
  const app = new Hono();
  const procedures = createProcedureCatalog(registry);
  const ajv = new Ajv2020({ strict: true, allErrors: true, useDefaults: false });
  const procedureValidators = new Map<string, { input: ValidateFunction; output: ValidateFunction }>(
    procedures.procedures.map((procedure) => [
      `${procedure.pluginId}\0${procedure.name}`,
      { input: ajv.compile(procedure.descriptor.inputSchema), output: ajv.compile(procedure.descriptor.outputSchema) }
    ])
  );

  app.onError((error, c) => {
    const projected = toCanvasError(error);
    return c.json(projected.toPayload(), projected.status as 400 | 404 | 409 | 500 | 503 | 504);
  });
  app.use('/assets/*', serveStatic({ root: WEB_BUILD_ROOT }));

  app.get('/health', async (c) => {
    const statuses = await capabilityStatus(registry);
    const assets = statuses['agentcanvas.assets'];
    return c.json({
      ok: true,
      service: 'AgentCanvas',
      version: AGENTCANVAS_VERSION,
      dependencies: { ...(assets ? { assets } : {}) }
    });
  });
  app.get('/whoami', async (c) => {
    const assets = await assetsProviderStatus(registry, c.req.raw.signal);
    return c.json({
      service: 'AgentCanvas',
      version: AGENTCANVAS_VERSION,
      pluginApi: AGENTCANVAS_HOST_API_VERSION,
      plugins: registry.plugins.map((plugin) => plugin.plugin.manifest.id),
      dependencies: { ...(assets ? { assets } : {}) },
      mcp: { endpoint: `${config.publicBaseUrl}/mcp`, transport: 'streamable-http' },
      host: config.host,
      port: config.port
    });
  });
  app.get('/openapi.json', (c) => c.json(runtime.openapi));
  if (runtime.developmentReloadVersion) {
    app.get('/__agentcanvas/dev-version', (c) => {
      c.header('cache-control', 'no-store');
      return c.text(runtime.developmentReloadVersion ?? '');
    });
    app.get('/__agentcanvas/dev-reload.js', (c) => {
      c.header('content-type', 'text/javascript; charset=utf-8');
      c.header('cache-control', 'no-store');
      return c.body(`
const initial = await fetch('/__agentcanvas/dev-version', { cache: 'no-store' }).then((response) => response.text());
setInterval(async () => {
  try {
    const current = await fetch('/__agentcanvas/dev-version', { cache: 'no-store' }).then((response) => response.text());
    if (current && current !== initial) location.reload();
  } catch (error) {
    void error;
  }
}, 750);
`);
    });
  }

  app.get('/api/v1/plugins', async (c) =>
    c.json(
      createPluginStatusCatalog(registry, {
        browserEntries: browserCatalog.entries,
        diagnostics: runtime.plugins.diagnostics.list(),
        capabilityStatus: await capabilityStatus(registry)
      })
    )
  );
  app.get('/api/v1/plugins/:pluginId', async (c) => {
    const status = getPluginStatus(
      createPluginStatusCatalog(registry, {
        browserEntries: browserCatalog.entries,
        diagnostics: runtime.plugins.diagnostics.list(),
        capabilityStatus: await capabilityStatus(registry)
      }),
      c.req.param('pluginId')
    );
    return status ? c.json(status) : c.json({ code: 'plugin_not_found', message: 'plugin is not active' }, 404);
  });
  app.get('/api/v1/plugin-modules/:pluginId/:buildHash/*', async (c) => {
    const module = await resolveBrowserPluginModule(
      browserCatalog,
      c.req.param('pluginId'),
      c.req.param('buildHash'),
      c.req.path.split(`/${c.req.param('buildHash')}/`)[1] ?? ''
    );
    return new Response(fs.readFileSync(module.filePath), {
      headers: {
        'content-type': module.contentType,
        'cache-control': 'public, max-age=31536000, immutable',
        'x-content-type-options': 'nosniff',
        'cross-origin-resource-policy': 'same-origin'
      }
    });
  });

  app.get('/api/v1/configuration', (c) => c.json({ ok: true, configuration: store.getConfiguration() }));
  app.patch('/api/v1/configuration', async (c) =>
    c.json({ ok: true, configuration: store.updateConfiguration(await c.req.json()) })
  );
  app.get('/api/v1/canvases', async (c) => {
    const canvases = store.listCanvases({
      project: c.req.query('project'),
      conversationId: c.req.query('conversationId'),
      limit: c.req.query('limit') ? Number(c.req.query('limit')) : undefined
    });
    return c.json({ ok: true, canvases });
  });
  app.post('/api/v1/canvases', async (c) => c.json({ ok: true, canvas: store.createCanvas(await c.req.json()) }, 201));
  app.get('/api/v1/canvases/:canvasId', async (c) => {
    const canvas = store.getCanvas(c.req.param('canvasId'));
    const projection = await resolveCanvasProjection(canvas, registry, false, c.req.raw.signal);
    return c.json({ ok: true, canvas, ...projection });
  });
  app.patch('/api/v1/canvases/:canvasId', async (c) =>
    c.json({ ok: true, canvas: store.updateCanvasBounds(c.req.param('canvasId'), await c.req.json()) })
  );
  app.patch('/api/v1/canvases/:canvasId/title', async (c) =>
    c.json({ ok: true, canvas: store.renameCanvas(c.req.param('canvasId'), await c.req.json()) })
  );
  app.patch('/api/v1/canvases/:canvasId/theme', async (c) =>
    c.json({ ok: true, canvas: store.updateCanvasTheme(c.req.param('canvasId'), await c.req.json()) })
  );
  app.post('/api/v1/canvases/:canvasId/elements:batch', async (c) => {
    const canvas = store.applyOperations(c.req.param('canvasId'), await c.req.json());
    const projection = await resolveCanvasProjection(canvas, registry, false, c.req.raw.signal);
    return c.json({ ok: true, canvas, revision: canvas.revision, ...projection });
  });
  app.post('/api/v1/canvases/:canvasId/share-links', async (c) => {
    const share = store.createShareLink(c.req.param('canvasId'), await c.req.json().catch(() => ({})));
    const { token: _token, ...publicShare } = share;
    return c.json({ ok: true, share: publicShare }, 201);
  });
  app.get('/api/v1/canvases/:canvasId/share-links', (c) =>
    c.json({ ok: true, shareLinks: store.listShareLinks(c.req.param('canvasId')) })
  );
  app.delete('/api/v1/canvases/:canvasId/share-links/:shareLinkId', (c) =>
    c.json({ ok: true, shareLink: store.revokeShareLink(c.req.param('canvasId'), c.req.param('shareLinkId')) })
  );
  app.get('/api/v1/canvases/:canvasId/viewport', (c) =>
    c.json({ ok: true, ...store.getViewportState(c.req.param('canvasId')) })
  );
  app.post('/api/v1/canvases/:canvasId/viewport', async (c) =>
    c.json({ ok: true, viewport: store.recordViewport(c.req.param('canvasId'), await c.req.json(), 'user') })
  );
  app.post('/api/v1/canvases/:canvasId/viewport/focus', async (c) =>
    c.json({ ok: true, viewport: store.recordViewport(c.req.param('canvasId'), await c.req.json(), 'agent') })
  );
  app.post('/api/v1/canvases/:canvasId/snapshot', async (c) => {
    const canvas = store.getCanvas(c.req.param('canvasId'));
    const projection = await resolveCanvasProjection(canvas, registry, true, c.req.raw.signal);
    const items = await collectSnapshotItems({
      canvasId: canvas.id,
      elements: canvas.elements,
      elementRuntime: projection.elementRuntime,
      registry,
      theme: canvas.theme ?? DEFAULT_CANVAS_THEME,
      signal: c.req.raw.signal
    });
    const composed = composeSnapshot({
      items,
      background: canvas.background?.color ?? canvas.theme?.colors.canvas,
      minimumWidth: canvas.bounds.mode === 'fixed' ? canvas.bounds.width : undefined,
      minimumHeight: canvas.bounds.mode === 'fixed' ? canvas.bounds.height : undefined
    });
    const handle = resources.registerBytes(new TextEncoder().encode(composed.svg), {
      mimeType: 'image/svg+xml',
      width: composed.width,
      height: composed.height
    });
    return c.json({ snapshot: handle, diagnostics: [...projection.diagnostics, ...composed.diagnostics] });
  });

  const procedureRoute: string = '/api/v1/plugins/:pluginId/procedures/:procedureName';
  const registerProcedureRoute = app.post as unknown as (
    route: string,
    handler: (context: Context) => Response | Promise<Response>
  ) => void;
  registerProcedureRoute(procedureRoute, async (c: Context): Promise<Response> => {
    const match = c.req.path.match(/^\/api\/v1\/plugins\/([^/]+)\/procedures\/([^/]+)$/);
    if (!match) return c.json({ code: 'procedure_not_found', message: 'plugin procedure is unavailable' }, 404);
    const pluginId = decodeURIComponent(match[1]);
    const procedureName = decodeURIComponent(match[2]);
    const contract = procedures.get(pluginId, procedureName);
    if (!contract) return c.json({ code: 'procedure_not_found', message: 'plugin procedure is unavailable' }, 404);
    const input = await c.req.json();
    const validators = procedureValidators.get(`${pluginId}\0${procedureName}`) as {
      input: ValidateFunction;
      output: ValidateFunction;
    };
    if (!validators.input(input))
      return c.json({ code: 'validation_error', message: 'procedure input is invalid' }, 400);
    const timeoutSignal = AbortSignal.timeout(30_000);
    const signal = AbortSignal.any([c.req.raw.signal, timeoutSignal]);
    const timeout = new Promise<never>((_resolve, reject) => {
      timeoutSignal.addEventListener(
        'abort',
        () =>
          reject(new CanvasError('procedure_timeout', 'plugin procedure exceeded 30 seconds', 'rendering', 504, true)),
        { once: true }
      );
    });
    const output = await Promise.race([
      contract.descriptor.invoke(input as JsonObject, invocationContext(store, registry, pluginId, signal)),
      timeout
    ]);
    if (!validators.output(output)) throw new Error('plugin procedure returned data outside its declared schema');
    return c.json(output);
  });

  app.get('/api/v1/resources/:handle/details', (c) => {
    const details = resources.details(c.req.param('handle'));
    return details
      ? c.json(details)
      : c.json({ code: 'resource_not_found', message: 'resource handle not found' }, 404);
  });
  app.get('/api/v1/resources/:handle/content', async (c) => {
    const payload = await resources.load(c.req.param('handle'), c.req.raw.signal);
    return payload
      ? new Response(payload.bytes.slice().buffer as ArrayBuffer, {
          headers: {
            'content-type': payload.mimeType,
            'content-length': String(payload.bytes.byteLength),
            'cache-control': 'private, max-age=300',
            'x-content-type-options': 'nosniff',
            'cross-origin-resource-policy': 'same-origin'
          }
        })
      : c.json({ code: 'resource_not_found', message: 'resource handle not found' }, 404);
  });
  app.get('/api/v1/share/:token', async (c) => {
    const resolved = store.resolveShareToken(c.req.param('token'));
    const projection = await resolveCanvasProjection(resolved.canvas, registry, true, c.req.raw.signal);
    return c.json({ ok: true, ...resolved, ...projection, readOnly: true });
  });

  const webShell = () => {
    const shell = readWebShell();
    return runtime.developmentReloadVersion
      ? shell.replace('</body>', '<script type="module" src="/__agentcanvas/dev-reload.js"></script></body>')
      : shell;
  };
  app.get('/', (c) => c.html(webShell()));
  app.get('/canvases', (c) => c.html(webShell()));
  app.get('/canvases/:canvasId', (c) => c.html(webShell()));
  app.get('/c/:shareToken', (c) => c.html(webShell()));
  return app;
}

export function createV2ServiceHandler(runtime: V2Runtime): RequestListener {
  const app = createV2App(runtime);
  const handler = getRequestListener(app.fetch, { hostname: runtime.config.host, overrideGlobalObjects: false });
  return async (request, response) => {
    for (const [name, value] of Object.entries(SECURITY_RESPONSE_HEADERS)) response.setHeader(name, value);
    try {
      const headers = new Headers();
      for (const [name, value] of Object.entries(request.headers)) {
        if (Array.isArray(value)) for (const item of value) headers.append(name, item);
        else if (value !== undefined) headers.set(name, value);
      }
      assertTrustedRequest(headers, runtime.config.security);
    } catch (error) {
      if (!(error instanceof SecurityPolicyError)) throw error;
      response.statusCode = error.status;
      response.setHeader('content-type', 'application/json; charset=utf-8');
      response.end(JSON.stringify({ code: error.code, message: error.message }));
      return;
    }
    const requestUrl = new URL(request.url ?? '/', runtime.config.publicBaseUrl);
    if (requestUrl.pathname === '/mcp') {
      await handleMcpV2Request(request, response, {
        registry: runtime.registry,
        store: runtime.store,
        browserCatalog: runtime.browserCatalog,
        diagnostics: () => runtime.plugins.diagnostics.list()
      });
      return;
    }
    await handler(request, response);
  };
}

export async function startAgentCanvas(): Promise<void> {
  const { loadAgentCanvasDotenv } = await import('./dotenv.js');
  loadAgentCanvasDotenv();
  const runtime = await createV2Runtime();
  const server = createServer(createV2ServiceHandler(runtime));
  server.listen(runtime.config.port, runtime.config.host, () => {
    console.log(`AgentCanvas ${AGENTCANVAS_VERSION} listening on ${runtime.config.publicBaseUrl}`);
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startAgentCanvas().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
