import type { JsonObject } from '@agentcanvas/plugin-sdk';
import { EMBED_SESSION_CREATE_REQUEST_SCHEMA, EMBED_SESSION_LIMITS } from '../embed-sessions.js';
import { codesForStatus, problemResponse } from './problem-contract.js';
import { CORE_REQUEST_SCHEMAS } from './schemas.js';

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
