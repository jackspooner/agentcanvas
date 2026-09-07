import { CORE_REQUEST_SCHEMAS } from './api-v2/schemas.js';
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
import { matchedRoutes } from 'hono/route';
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
import {
  MACRO_ARCHIVE_RESPONSE_SCHEMA,
  MACRO_CREATE_REQUEST_SCHEMA,
  MACRO_CREATE_RESPONSE_SCHEMA,
  MACRO_HTTP_CREATE_VERSION_REQUEST_SCHEMA,
  MACRO_CREATE_VERSION_RESPONSE_SCHEMA,
  MACRO_HTTP_EXECUTE_REQUEST_SCHEMA,
  MACRO_EXECUTE_RESPONSE_SCHEMA,
  MACRO_GET_REQUEST_SCHEMA,
  MACRO_GET_RESPONSE_SCHEMA,
  MACRO_LIST_REQUEST_SCHEMA,
  MACRO_LIST_RESPONSE_SCHEMA,
  MACRO_HTTP_PLAN_REQUEST_SCHEMA,
  MACRO_PLAN_RESPONSE_SCHEMA,
  MACRO_HTTP_ARCHIVE_REQUEST_SCHEMA
} from './macros/index.js';
import { MacroError, MacroRuntime, MACRO_RUNTIME_LIMITS } from './macros/index.js';
import { loadConfig, type AgentCanvasConfig } from './config.js';
import {
  EMBED_SESSION_CREATE_REQUEST_SCHEMA,
  EMBED_SESSION_LIMITS,
  EmbedSessionRegistry,
  type CreateEmbedSessionInput
} from './embed-sessions.js';
import { CanvasError, toCanvasError } from './errors.js';
import { canvasPageUrl } from './canvas-url.js';
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
import {
  assertTrustedRequest,
  securityResponseHeaders,
  SECURITY_RESPONSE_HEADERS,
  SecurityPolicyError
} from './security.js';
import { V2SqliteCanvasStore, type V2CanvasRecord } from './store/v2.js';
import { handleMcpV2Request } from './mcp-v2/http.js';
import { assertPluginSchemasReady } from './migrations/plugin-schema.js';
import { AGENTCANVAS_HOST_API_VERSION, AGENTCANVAS_VERSION } from './version.js';
import {
  codesForStatus,
  problemForCode,
  problemFromCanvasError,
  problemFromMacroError,
  problemResponse
} from './api-v2/problem-contract.js';

interface V2Runtime {
  config: AgentCanvasConfig;
  plugins: PreparedPluginRuntime;
  registry: FrozenPluginRegistry;
  browserCatalog: BrowserPluginCatalog;
  resources: ResourceBroker;
  store: V2SqliteCanvasStore;
  macros: MacroRuntime;
  embedSessions: EmbedSessionRegistry;
  openapi: JsonObject;
  developmentReloadVersion?: string;
  dispose(): void;
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
  const jsonBody = (schema: JsonObject, example?: JsonObject): JsonObject => ({
    required: true,
    description:
      'Send a valid JSON object matching this schema. Malformed JSON or schema violations return 400 Problem Details before mutation.',
    content: { 'application/json': { schema, ...(example ? { example } : {}) } }
  });
  const response = (description: string, schema?: JsonObject, example?: JsonObject): JsonObject => ({
    description,
    ...(schema ? { content: { 'application/json': { schema, ...(example ? { example } : {}) } } } : {})
  });
  const errorResponses = {
    400: problemResponse('Request validation failed', codesForStatus(400)),
    403: problemResponse('The operation is not permitted', codesForStatus(403)),
    404: problemResponse('Resource was not found', codesForStatus(404)),
    409: problemResponse('Revision or idempotency conflict', codesForStatus(409)),
    410: problemResponse('The requested session or plan has expired', codesForStatus(410)),
    500: problemResponse('AgentCanvas failed to complete the request', codesForStatus(500)),
    503: problemResponse('AgentCanvas dependency is unavailable', codesForStatus(503)),
    504: problemResponse('A dependent operation timed out', codesForStatus(504))
  };
  const macroErrors = {
    400: problemResponse('Macro request validation failed', [
      'macro_definition_invalid',
      'macro_definition_too_large',
      'macro_input_invalid',
      'macro_input_too_large',
      'macro_unsafe',
      'macro_ref_invalid',
      'macro_ref_pointer_invalid',
      'macro_dependency_invalid',
      'macro_element_invalid',
      'macro_limit_exceeded',
      'macro_canvas_limit_exceeded',
      'macro_idempotency_invalid'
    ]),
    403: problemResponse('Macro scope does not permit this canvas', ['macro_scope_denied']),
    404: problemResponse('Macro or exact macro version was not found', [
      'macro_not_found',
      'macro_version_not_found',
      'macro_plan_not_found',
      'macro_ref_missing',
      'macro_dependency_missing'
    ]),
    409: problemResponse('Macro revision, version, scope, or idempotency conflict', [
      'macro_archived',
      'macro_version_mismatch',
      'macro_plan_stale',
      'macro_revision_conflict',
      'macro_idempotency_conflict'
    ]),
    410: problemResponse('Macro plan has expired', ['macro_plan_expired']),
    500: problemResponse('Macro execution failed', ['macro_execution_invalid'])
  };
  const authoringExample = {
    scope: 'installation',
    title: 'Insert card',
    inputSchema: { type: 'object', additionalProperties: false },
    elements: []
  };
  const recordExample = {
    definition: {
      id: 'macro_example',
      version: 1,
      scope: 'installation',
      title: 'Insert card',
      inputSchema: { type: 'object', additionalProperties: false },
      elements: []
    },
    currentVersion: 1,
    archived: false
  };
  const planExample = {
    planId: 'macro_plan_example',
    macroId: 'macro_example',
    macroVersion: 1,
    canvasId: 'canvas_example',
    canvasRevision: 1,
    anchor: { x: 0, y: 0 },
    inputDigest: 'a'.repeat(64),
    planDigest: 'b'.repeat(64),
    createdAt: '2026-01-01T00:00:00.000Z',
    expiresAt: '2026-01-01T00:05:00.000Z',
    operations: [],
    previewElements: [],
    outputs: {},
    effectSummary: { label: 'Insert card', operationCount: 0, generatedElementCount: 0, affectedElementIds: [] }
  };
  const executionExample = {
    canvas: { id: 'canvas_example', revision: 2, elements: [], bounds: { mode: 'unlimited' } },
    provenance: {
      macroId: 'macro_example',
      macroVersion: 1,
      planId: 'macro_plan_example',
      inputDigest: 'a'.repeat(64),
      planDigest: 'b'.repeat(64)
    },
    outputs: {},
    history: { label: 'Insert card', forward: [], inverse: [], affectedElementIds: [] }
  };
  const macroNotes = (sideEffects: string[] = [], pure = false): JsonObject => ({
    useWhen: [
      pure
        ? 'Use for a deterministic macro preview or catalog operation.'
        : 'Use when the macro workflow requires this mutation.'
    ],
    ...(pure ? { doNotUseWhen: ['Do not use to mutate canvas state.'] } : {}),
    sideEffects,
    consistency: { refresh: sideEffects.length ? ['Refresh the affected macro catalog or canvas after success.'] : [] }
  });
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
    useWhen: [
      sideEffects.length
        ? 'Use when this exact AgentCanvas mutation is required.'
        : 'Use to inspect the current AgentCanvas state without mutation.'
    ],
    sideEffects,
    consistency: {
      refresh: sideEffects.length ? ['Refresh the affected canvas, list, or configuration after success.'] : []
    },
    ...(retry ? { workflow: ['Retry only when the returned Problem Details object has retryable=true.'] } : {})
  });
  const embedSession = {
    type: 'object',
    additionalProperties: false,
    required: ['id', 'canvasIds', 'mode', 'parentOrigin', 'createdAt', 'expiresAt'],
    properties: {
      id: { type: 'string' },
      canvasIds: {
        type: 'array',
        minItems: 1,
        maxItems: EMBED_SESSION_LIMITS.maxCanvasIds,
        uniqueItems: true,
        items: { type: 'string' }
      },
      mode: { enum: ['read', 'edit'] },
      parentOrigin: { type: 'string', format: 'uri' },
      createdAt: { type: 'string', format: 'date-time' },
      expiresAt: { type: 'string', format: 'date-time' }
    }
  };
  const embedNotes = (sideEffects: string[] = []): JsonObject => ({
    useWhen: ['Embedding one or more explicitly allowed AgentCanvas canvases inside a trusted host application.'],
    doNotUseWhen: [
      'Do not use as LLM mutation transport; use the canvas HTTP or MCP operations.',
      'Do not expose the bearer URL in logs, prompts, analytics, or untrusted client state.'
    ],
    sideEffects,
    consistency: {
      refresh: sideEffects.length ? ['Recreate the iframe or discard its URL after session revocation or expiry.'] : []
    },
    workflow: [
      'Create the session server-side, set the returned URL as the iframe src, and listen for the versioned postMessage bridge.',
      'Ordinary AgentCanvas pages remain non-frameable.'
    ]
  });
  return {
    '/api/v1/embed-sessions': {
      post: {
        operationId: 'embedSessionCreate',
        summary: 'Create a short-lived app-scoped embed session',
        description:
          'Creates an in-memory bearer session for one through 25 canvases and one exact parent origin. Sessions are invalidated when AgentCanvas restarts.',
        tags: ['Embedding'],
        requestBody: jsonBody(EMBED_SESSION_CREATE_REQUEST_SCHEMA as unknown as JsonObject, {
          canvasIds: ['canvas_example'],
          mode: 'read',
          parentOrigin: 'http://127.0.0.1:3000',
          expiresInSeconds: 3600
        }),
        responses: {
          201: response('Created embed session', {
            type: 'object',
            required: ['ok', 'session', 'url'],
            properties: { ok: { const: true }, session: embedSession, url: { type: 'string', format: 'uri' } }
          }),
          400: errorResponses[400],
          404: errorResponses[404],
          500: errorResponses[500],
          503: errorResponses[503]
        },
        'x-agent-notes': embedNotes(['Creates process-memory embed authority until expiry, revocation, or restart.'])
      }
    },
    '/api/v1/embed-sessions/{token}': {
      get: {
        operationId: 'embedSessionResolve',
        summary: 'Resolve an embed session and selected canvas',
        description: 'Used by the AgentCanvas iframe shell. The optional canvasId must belong to the session.',
        tags: ['Embedding'],
        parameters: [
          { name: 'token', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'canvasId', in: 'query', schema: { type: 'string' } }
        ],
        responses: {
          200: response('Embed session and canvas projection', {
            type: 'object',
            required: ['ok', 'session', 'canvas', 'elementRuntime', 'diagnostics', 'readOnly'],
            properties: {
              ok: { const: true },
              session: embedSession,
              canvas: { $ref: '#/components/schemas/CanvasRecord' },
              elementRuntime: { type: 'object', additionalProperties: { type: 'object' } },
              diagnostics: { type: 'array', items: { $ref: '#/components/schemas/PluginDiagnostic' } },
              readOnly: { type: 'boolean' }
            }
          }),
          403: problemResponse('Canvas is outside the embed session', ['embed_canvas_forbidden']),
          404: errorResponses[404],
          410: problemResponse('Embed session expired', ['embed_session_expired'])
        },
        'x-agent-notes': embedNotes()
      },
      delete: {
        operationId: 'embedSessionRevoke',
        summary: 'Revoke an embed session',
        tags: ['Embedding'],
        parameters: [{ name: 'token', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          200: response('Revoked embed session', {
            type: 'object',
            required: ['ok', 'session'],
            properties: { ok: { const: true }, session: embedSession }
          }),
          404: errorResponses[404],
          410: problemResponse('Embed session expired', ['embed_session_expired'])
        },
        'x-agent-notes': embedNotes(['Immediately removes the process-memory embed authority.'])
      }
    },
    '/api/v1/macros': {
      get: {
        operationId: 'macroList',
        summary: 'List available macro templates',
        tags: ['Macros'],
        parameters: [
          { name: 'canvasId', in: 'query', schema: { type: 'string' } },
          { name: 'includeArchived', in: 'query', schema: { type: 'boolean' } },
          { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100 } },
          { name: 'cursor', in: 'query', schema: { type: 'string' } }
        ],
        responses: {
          200: response('Macro catalog page', { $ref: '#/components/schemas/MacroListResponse' }, { items: [] }),
          ...macroErrors
        },
        'x-agent-notes': macroNotes([], true)
      },
      post: {
        operationId: 'macroCreate',
        summary: 'Create a version-one macro template',
        tags: ['Macros'],
        requestBody: jsonBody({ $ref: '#/components/schemas/MacroCreateRequest' }, authoringExample),
        responses: {
          201: response('Created macro', { $ref: '#/components/schemas/MacroCreateResponse' }, recordExample),
          ...macroErrors
        },
        'x-agent-notes': macroNotes(['Creates a macro definition and immutable version one.'])
      }
    },
    '/api/v1/macros/{macroId}/versions/{version}': {
      get: {
        operationId: 'macroGet',
        summary: 'Get one exact macro version',
        tags: ['Macros'],
        parameters: [
          { name: 'macroId', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'version', in: 'path', required: true, schema: { type: 'integer', minimum: 1 } },
          { name: 'canvasId', in: 'query', schema: { type: 'string' } }
        ],
        responses: {
          200: response('Exact macro version', { $ref: '#/components/schemas/MacroGetResponse' }, recordExample),
          ...macroErrors
        },
        'x-agent-notes': macroNotes([], true)
      }
    },
    '/api/v1/macros/{macroId}/versions': {
      post: {
        operationId: 'macroCreateVersion',
        summary: 'Create the next immutable macro version',
        tags: ['Macros'],
        parameters: [{ name: 'macroId', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: jsonBody(
          { $ref: '#/components/schemas/MacroHttpCreateVersionRequest' },
          { ...authoringExample, expectedCurrentVersion: 1 }
        ),
        responses: {
          201: response(
            'Created macro version',
            { $ref: '#/components/schemas/MacroCreateVersionResponse' },
            { ...recordExample, currentVersion: 2, definition: { ...recordExample.definition, version: 2 } }
          ),
          ...macroErrors
        },
        'x-agent-notes': macroNotes(['Adds a new immutable version while preserving scope and canvas identity.'])
      }
    },
    '/api/v1/macros/{macroId}': {
      patch: {
        operationId: 'macroArchive',
        summary: 'Archive or unarchive a macro',
        tags: ['Macros'],
        parameters: [{ name: 'macroId', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: jsonBody({ $ref: '#/components/schemas/MacroHttpArchiveRequest' }, { archived: true }),
        responses: {
          200: response(
            'Updated macro archive state',
            { $ref: '#/components/schemas/MacroArchiveResponse' },
            { macroId: 'macro_example', currentVersion: 1, archived: true }
          ),
          ...macroErrors
        },
        'x-agent-notes': macroNotes(['Changes only the archive state; existing versions remain immutable.'])
      }
    },
    '/api/v1/canvases/{canvasId}/macros/{macroId}:plan': {
      post: {
        operationId: 'macroPlan',
        summary: 'Plan an exact macro version without mutation',
        description:
          'Macro references are evaluated in saved template payloads. Values read from invocation input are inserted as literal JSON.',
        tags: ['Macros'],
        parameters: [
          { name: 'canvasId', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'macroId', in: 'path', required: true, schema: { type: 'string' } }
        ],
        requestBody: jsonBody(
          { $ref: '#/components/schemas/MacroHttpPlanRequest' },
          { macroVersion: 1, anchor: { x: 0, y: 0 }, input: {} }
        ),
        responses: {
          200: response('Pure macro plan', { $ref: '#/components/schemas/MacroPlanResponse' }, planExample),
          ...macroErrors
        },
        'x-agent-notes': macroNotes(['Creates a short-lived in-memory plan bound to the current canvas revision.'])
      }
    },
    '/api/v1/canvases/{canvasId}/macros:execute': {
      post: {
        operationId: 'macroExecute',
        summary: 'Execute a previously stored macro plan',
        tags: ['Macros'],
        parameters: [{ name: 'canvasId', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: jsonBody(
          { $ref: '#/components/schemas/MacroHttpExecuteRequest' },
          { planId: 'macro_plan_example', expectedRevision: 1, idempotencyKey: 'request-example' }
        ),
        responses: {
          200: response(
            'Complete macro execution result',
            { $ref: '#/components/schemas/MacroExecuteResponse' },
            executionExample
          ),
          ...macroErrors
        },
        'x-agent-notes': macroNotes([
          'Updates canvas elements, canvas events, macro invocation provenance, and the idempotent replay record atomically.'
        ])
      }
    },
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
        requestBody: jsonBody(CORE_REQUEST_SCHEMAS.configuration),
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
        requestBody: jsonBody(CORE_REQUEST_SCHEMAS.create),
        responses: {
          201: response('Created canvas', {
            type: 'object',
            additionalProperties: false,
            required: ['ok', 'canvas', 'url'],
            properties: {
              ok: { const: true },
              canvas: { $ref: '#/components/schemas/CanvasRecord' },
              url: { type: 'string', minLength: 1 }
            }
          }),
          ...errorResponses
        },
        'x-agent-notes': agentNotes([
          'Creates one canvas.',
          'Returns the direct browser URL based on AGENT_CANVAS_PUBLIC_BASE_URL; this does not create a public share link.'
        ])
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
        requestBody: jsonBody(CORE_REQUEST_SCHEMAS.bounds),
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
        requestBody: jsonBody(CORE_REQUEST_SCHEMAS.title),
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
        requestBody: jsonBody(CORE_REQUEST_SCHEMAS.theme),
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
        requestBody: jsonBody(CORE_REQUEST_SCHEMAS.batch),
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
        requestBody: jsonBody(CORE_REQUEST_SCHEMAS.share),
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
        requestBody: jsonBody(CORE_REQUEST_SCHEMAS.viewport),
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
        requestBody: jsonBody(CORE_REQUEST_SCHEMAS.focus),
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
  const macros = new MacroRuntime(store, plugins.registry);
  const embedSessions = new EmbedSessionRegistry(config.publicBaseUrl);
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
    macros,
    embedSessions,
    openapi,
    dispose() {
      plugins.resources.dispose();
      store.close();
    },
    ...(options.developmentReloadVersion ? { developmentReloadVersion: options.developmentReloadVersion } : {})
  };
}

async function readMacroJson(c: Context, validator: ValidateFunction, label: string): Promise<JsonObject> {
  let value: unknown;
  try {
    value = await c.req.json();
  } catch {
    throw new MacroError('macro_definition_invalid', `${label} must be valid JSON`, 'definition');
  }
  if (!validator(value))
    throw new MacroError(
      'macro_definition_invalid',
      `${label} does not match the canonical macro schema`,
      'definition'
    );
  return value as JsonObject;
}

function validateMacroResult(value: unknown, validator: ValidateFunction): void {
  if (!validator(value))
    throw new MacroError(
      'macro_execution_invalid',
      'macro service returned data outside the canonical response schema',
      'execution',
      { status: 500 }
    );
}

function requestId(c: Context): string {
  return c.req.header('x-request-id')?.trim() || `req_${nanoid(16)}`;
}

function sendProblem(c: Context, problem: ReturnType<typeof problemForCode>): Response {
  return c.json(problem, problem.status as 400 | 403 | 404 | 408 | 409 | 410 | 413 | 500 | 503 | 504, {
    'content-type': 'application/problem+json',
    'x-request-id': problem.requestId
  });
}

export function createV2App(runtime: V2Runtime): Hono {
  const { config, registry, browserCatalog, resources, store, macros, embedSessions } = runtime;
  const app = new Hono();
  const procedures = createProcedureCatalog(registry);
  const ajv = new Ajv2020({ strict: true, allErrors: true, useDefaults: false });
  const procedureValidators = new Map<string, { input: ValidateFunction; output: ValidateFunction }>(
    procedures.procedures.map((procedure) => [
      `${procedure.pluginId}\0${procedure.name}`,
      { input: ajv.compile(procedure.descriptor.inputSchema), output: ajv.compile(procedure.descriptor.outputSchema) }
    ])
  );
  const coreValidators = new Map<string, ValidateFunction>(
    Object.entries(CORE_REQUEST_SCHEMAS).map(([name, schema]) => [
      name,
      ajv.compile(
        JSON.parse(
          JSON.stringify({
            ...schema,
            $defs: (runtime.openapi.components as JsonObject).schemas
          }).replaceAll('#/components/schemas/', '#/$defs/')
        )
      )
    ])
  );
  async function readCoreJson<T>(c: Context, name: keyof typeof CORE_REQUEST_SCHEMAS): Promise<T> {
    let value: unknown;
    try {
      value = await c.req.json();
    } catch {
      throw new CanvasError('validation_error', 'Request body must be valid JSON', 'validation', 400);
    }
    const validate = coreValidators.get(name) as ValidateFunction;
    if (!validate(value)) {
      const issue = validate.errors?.[0];
      throw new CanvasError(
        'validation_error',
        `Request body${issue?.instancePath || '/'} ${issue?.message || 'does not match the canonical schema'}`,
        'validation',
        400
      );
    }
    return value as T;
  }
  const macroValidators = new Map<string, ValidateFunction>([
    ['list', ajv.compile(MACRO_LIST_REQUEST_SCHEMA)],
    ['create', ajv.compile(MACRO_CREATE_REQUEST_SCHEMA)],
    ['get', ajv.compile(MACRO_GET_REQUEST_SCHEMA)],
    ['createVersionHttp', ajv.compile(MACRO_HTTP_CREATE_VERSION_REQUEST_SCHEMA)],
    ['archive', ajv.compile(MACRO_HTTP_ARCHIVE_REQUEST_SCHEMA)],
    ['planHttp', ajv.compile(MACRO_HTTP_PLAN_REQUEST_SCHEMA)],
    ['executeHttp', ajv.compile(MACRO_HTTP_EXECUTE_REQUEST_SCHEMA)]
  ]);
  const macroResponseValidators = new Map<string, ValidateFunction>([
    ['list', ajv.compile(MACRO_LIST_RESPONSE_SCHEMA)],
    ['create', ajv.compile(MACRO_CREATE_RESPONSE_SCHEMA)],
    ['get', ajv.compile(MACRO_GET_RESPONSE_SCHEMA)],
    ['createVersion', ajv.compile(MACRO_CREATE_VERSION_RESPONSE_SCHEMA)],
    ['archive', ajv.compile(MACRO_ARCHIVE_RESPONSE_SCHEMA)],
    ['plan', ajv.compile(MACRO_PLAN_RESPONSE_SCHEMA)],
    ['execute', ajv.compile(MACRO_EXECUTE_RESPONSE_SCHEMA)]
  ]);
  const embedSessionCreateValidator = ajv.compile(
    EMBED_SESSION_CREATE_REQUEST_SCHEMA as unknown as Record<string, unknown>
  );

  app.onError((error, c) => {
    const correlationId = requestId(c);
    const problem =
      error instanceof MacroError
        ? problemFromMacroError(error, correlationId, c.req.path)
        : problemFromCanvasError(toCanvasError(error), correlationId, c.req.path);
    if (problem.status >= 500) {
      // Log source locations, never exception messages or request values: either can contain credentials.
      const frames = (error.stack ?? '')
        .split('\n')
        .slice(1)
        .flatMap((line) => {
          const location = line.match(/([^\\/():\s]+\.[cm]?[jt]s):(\d+):(\d+)\)?$/);
          return location ? [`${location[1]}:${location[2]}:${location[3]}`] : [];
        });
      process.stderr.write(
        `${JSON.stringify({
          service: 'AgentCanvas',
          level: 'error',
          time: new Date().toISOString(),
          requestId: correlationId,
          method: c.req.method,
          route: matchedRoutes(c).at(-1)?.path,
          status: problem.status,
          code: problem.code,
          stage: 'http',
          outcome: 'failed',
          frames
        })}\n`
      );
    }
    return sendProblem(c, problem);
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
      macros: MACRO_RUNTIME_LIMITS,
      embedding: {
        maxCanvasIds: EMBED_SESSION_LIMITS.maxCanvasIds,
        minTtlSeconds: EMBED_SESSION_LIMITS.minTtlSeconds,
        maxTtlSeconds: EMBED_SESSION_LIMITS.maxTtlSeconds,
        storage: 'process-memory'
      },
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
  app.post('/api/v1/embed-sessions', async (c) => {
    let input: unknown;
    try {
      input = await c.req.json();
    } catch {
      throw new CanvasError('validation_error', 'embed session request must be valid JSON', 'validation', 400);
    }
    if (!embedSessionCreateValidator(input)) {
      throw new CanvasError(
        'validation_error',
        'embed session request does not match the canonical schema',
        'validation',
        400
      );
    }
    const created = embedSessions.create(input as CreateEmbedSessionInput, (canvasId) => {
      store.getCanvas(canvasId);
    });
    return c.json({ ok: true, ...created }, 201);
  });
  app.get('/api/v1/embed-sessions/:token', async (c) => {
    const selected = embedSessions.select(c.req.param('token'), c.req.query('canvasId'));
    const canvas = store.getCanvas(selected.canvasId);
    const readOnly = selected.session.mode === 'read';
    const projection = await resolveCanvasProjection(canvas, registry, readOnly, c.req.raw.signal);
    return c.json({ ok: true, session: selected.session, canvas, ...projection, readOnly });
  });
  app.delete('/api/v1/embed-sessions/:token', (c) =>
    c.json({ ok: true, session: embedSessions.revoke(c.req.param('token')) })
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
    return status
      ? c.json(status)
      : sendProblem(c, problemForCode('plugin_unavailable', 'Plugin is not active.', requestId(c), c.req.path));
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

  app.get('/api/v1/macros', (c) => {
    const raw = {
      ...(c.req.query('canvasId') !== undefined ? { canvasId: c.req.query('canvasId') } : {}),
      ...(c.req.query('includeArchived') !== undefined
        ? { includeArchived: c.req.query('includeArchived') === 'true' }
        : {}),
      ...(c.req.query('limit') !== undefined ? { limit: Number(c.req.query('limit')) } : {}),
      ...(c.req.query('cursor') !== undefined ? { cursor: c.req.query('cursor') } : {})
    };
    const validator = macroValidators.get('list') as ValidateFunction;
    if (!validator(raw)) throw new MacroError('macro_definition_invalid', 'macro list query is invalid', 'definition');
    const result = macros.list(raw);
    validateMacroResult(result, macroResponseValidators.get('list') as ValidateFunction);
    return c.json(result);
  });
  app.post('/api/v1/macros', async (c) => {
    const body = await readMacroJson(c, macroValidators.get('create') as ValidateFunction, 'macro create request');
    const result = macros.create(body as never);
    validateMacroResult(result, macroResponseValidators.get('create') as ValidateFunction);
    return c.json(result, 201);
  });
  app.get('/api/v1/macros/:macroId/versions/:version', (c) => {
    const macroId = c.req.param('macroId') ?? '';
    const macroVersion = Number(c.req.param('version'));
    const request = {
      macroId,
      macroVersion,
      ...(c.req.query('canvasId') !== undefined ? { canvasId: c.req.query('canvasId') } : {})
    };
    if (!(macroValidators.get('get') as ValidateFunction)(request))
      throw new MacroError('macro_definition_invalid', 'macro get path is invalid', 'definition');
    const result = macros.get(request.macroId, request.macroVersion, request.canvasId ?? '');
    validateMacroResult(result, macroResponseValidators.get('get') as ValidateFunction);
    return c.json(result);
  });
  app.post('/api/v1/macros/:macroId/versions', async (c) => {
    const macroId = c.req.param('macroId') ?? '';
    const body = await readMacroJson(
      c,
      macroValidators.get('createVersionHttp') as ValidateFunction,
      'macro version request'
    );
    const result = macros.createVersion({ ...body, macroId } as never);
    validateMacroResult(result, macroResponseValidators.get('createVersion') as ValidateFunction);
    return c.json(result, 201);
  });
  app.patch('/api/v1/macros/:macroId', async (c) => {
    const macroId = c.req.param('macroId');
    const body = await readMacroJson(c, macroValidators.get('archive') as ValidateFunction, 'macro archive request');
    const result = macros.archive(macroId, body.archived as boolean);
    validateMacroResult(result, macroResponseValidators.get('archive') as ValidateFunction);
    return c.json(result);
  });
  app.post('/api/v1/canvases/:canvasId/macros/*', async (c) => {
    const match = c.req.path.match(/^\/api\/v1\/canvases\/([^/]+)\/macros\/([^/]+):plan$/);
    if (!match) throw new MacroError('macro_definition_invalid', 'macro plan route is invalid', 'definition');
    const canvasId = decodeURIComponent(match[1]);
    const macroId = decodeURIComponent(match[2]);
    const body = await readMacroJson(c, macroValidators.get('planHttp') as ValidateFunction, 'macro plan request');
    const result = macros.plan({ ...body, canvasId, macroId } as never);
    validateMacroResult(result, macroResponseValidators.get('plan') as ValidateFunction);
    return c.json(result);
  });
  app.post('/api/v1/canvases/:canvasId/macros:execute', async (c) => {
    const canvasId = c.req.param('canvasId');
    const body = await readMacroJson(
      c,
      macroValidators.get('executeHttp') as ValidateFunction,
      'macro execute request'
    );
    const result = await macros.execute({ ...body, canvasId } as never);
    validateMacroResult(result, macroResponseValidators.get('execute') as ValidateFunction);
    return c.json(result);
  });

  app.get('/api/v1/configuration', (c) => c.json({ ok: true, configuration: store.getConfiguration() }));
  app.patch('/api/v1/configuration', async (c) =>
    c.json({ ok: true, configuration: store.updateConfiguration(await readCoreJson(c, 'configuration')) })
  );
  app.get('/api/v1/canvases', async (c) => {
    const canvases = store.listCanvases({
      project: c.req.query('project'),
      conversationId: c.req.query('conversationId'),
      limit: c.req.query('limit') ? Number(c.req.query('limit')) : undefined
    });
    return c.json({ ok: true, canvases });
  });
  app.post('/api/v1/canvases', async (c) => {
    const canvas = store.createCanvas(await readCoreJson(c, 'create'));
    return c.json({ ok: true, canvas, url: canvasPageUrl(config.publicBaseUrl, canvas.id) }, 201);
  });
  app.get('/api/v1/canvases/:canvasId', async (c) => {
    const canvas = store.getCanvas(c.req.param('canvasId'));
    const projection = await resolveCanvasProjection(canvas, registry, false, c.req.raw.signal);
    return c.json({ ok: true, canvas, ...projection });
  });
  app.patch('/api/v1/canvases/:canvasId', async (c) =>
    c.json({ ok: true, canvas: store.updateCanvasBounds(c.req.param('canvasId'), await readCoreJson(c, 'bounds')) })
  );
  app.patch('/api/v1/canvases/:canvasId/title', async (c) =>
    c.json({ ok: true, canvas: store.renameCanvas(c.req.param('canvasId'), await readCoreJson(c, 'title')) })
  );
  app.patch('/api/v1/canvases/:canvasId/theme', async (c) =>
    c.json({ ok: true, canvas: store.updateCanvasTheme(c.req.param('canvasId'), await readCoreJson(c, 'theme')) })
  );
  app.post('/api/v1/canvases/:canvasId/elements:batch', async (c) => {
    const canvas = store.applyOperations(c.req.param('canvasId'), await readCoreJson(c, 'batch'));
    const projection = await resolveCanvasProjection(canvas, registry, false, c.req.raw.signal);
    return c.json({ ok: true, canvas, revision: canvas.revision, ...projection });
  });
  app.post('/api/v1/canvases/:canvasId/share-links', async (c) => {
    const share = store.createShareLink(c.req.param('canvasId'), await readCoreJson(c, 'share'));
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
    c.json({
      ok: true,
      viewport: store.recordViewport(c.req.param('canvasId'), await readCoreJson(c, 'viewport'), 'user')
    })
  );
  app.post('/api/v1/canvases/:canvasId/viewport/focus', async (c) =>
    c.json({
      ok: true,
      viewport: store.recordViewport(c.req.param('canvasId'), await readCoreJson(c, 'focus'), 'agent')
    })
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
    if (!match)
      return sendProblem(
        c,
        problemForCode('procedure_not_found', 'Plugin procedure is unavailable.', requestId(c), c.req.path)
      );
    const pluginId = decodeURIComponent(match[1]);
    const procedureName = decodeURIComponent(match[2]);
    const contract = procedures.get(pluginId, procedureName);
    if (!contract)
      return sendProblem(
        c,
        problemForCode('procedure_not_found', 'Plugin procedure is unavailable.', requestId(c), c.req.path)
      );
    const input = await c.req.json();
    const validators = procedureValidators.get(`${pluginId}\0${procedureName}`) as {
      input: ValidateFunction;
      output: ValidateFunction;
    };
    if (!validators.input(input))
      return sendProblem(
        c,
        problemForCode('validation_error', 'Procedure input is invalid.', requestId(c), c.req.path)
      );
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
      : sendProblem(c, problemForCode('resource_not_found', 'Resource handle not found.', requestId(c), c.req.path));
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
      : sendProblem(c, problemForCode('resource_not_found', 'Resource handle not found.', requestId(c), c.req.path));
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
  app.get('/embed/:token', (c) => {
    embedSessions.get(c.req.param('token'));
    return c.html(webShell());
  });
  return app;
}

export function createV2ServiceHandler(runtime: V2Runtime): RequestListener {
  const app = createV2App(runtime);
  const handler = getRequestListener(app.fetch, { hostname: runtime.config.host, overrideGlobalObjects: false });
  return async (request, response) => {
    const requestUrl = new URL(request.url ?? '/', runtime.config.publicBaseUrl);
    let responseHeaders = SECURITY_RESPONSE_HEADERS;
    const embedMatch = requestUrl.pathname.match(/^\/embed\/([^/]+)$/);
    if (embedMatch) {
      try {
        const session = runtime.embedSessions.get(decodeURIComponent(embedMatch[1]));
        responseHeaders = securityResponseHeaders([session.parentOrigin]);
      } catch {
        responseHeaders = SECURITY_RESPONSE_HEADERS;
      }
    }
    for (const [name, value] of Object.entries(responseHeaders)) response.setHeader(name, value);
    try {
      const headers = new Headers();
      for (const [name, value] of Object.entries(request.headers)) {
        if (Array.isArray(value)) for (const item of value) headers.append(name, item);
        else if (value !== undefined) headers.set(name, value);
      }
      assertTrustedRequest(headers, runtime.config.security);
    } catch (error) {
      if (!(error instanceof SecurityPolicyError)) throw error;
      const securityRequestId = request.headers['x-request-id']?.toString() ?? `req_${nanoid(16)}`;
      const problem = problemForCode(
        error.code as 'untrusted_host' | 'untrusted_origin',
        error.message,
        securityRequestId,
        requestUrl.pathname
      );
      response.statusCode = problem.status;
      response.setHeader('content-type', 'application/problem+json');
      response.setHeader('x-request-id', securityRequestId);
      response.end(JSON.stringify(problem));
      return;
    }
    if (requestUrl.pathname === '/mcp') {
      await handleMcpV2Request(request, response, {
        publicBaseUrl: runtime.config.publicBaseUrl,
        registry: runtime.registry,
        store: runtime.store,
        macros: runtime.macros,
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
  server.once('close', () => runtime.dispose());
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
