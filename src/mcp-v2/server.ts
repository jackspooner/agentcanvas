import {
  CANVAS_BOUNDS_SCHEMA,
  CANVAS_ELEMENT_SCHEMA,
  CANVAS_LIST_LIMIT_SCHEMA,
  CORE_REQUEST_SCHEMAS,
  VIEWER_ID_SCHEMA
} from '../api-v2/schemas.js';
import {
  CANVAS_INSPECTION_SUMMARY_SCHEMA,
  CANVAS_MUTATION_RECEIPT_SCHEMA,
  CANVAS_THEME_V1_SCHEMA,
  deriveToolName,
  type CanvasThemeV1,
  type CanvasMutationReceipt,
  type JsonObject,
  type JsonSchema,
  type PluginInvocationContext
} from '@agentcanvas/plugin-sdk';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import Ajv2020, { type ValidateFunction } from 'ajv/dist/2020.js';
import { nanoid } from 'nanoid';
import type { CanvasBounds } from '../contracts.js';
import {
  AGENTCANVAS_PROBLEM_CODES,
  createMcpToolCatalog,
  mcpOutputSchema,
  problemFromCanvasError,
  problemFromMacroError,
  createPluginStatusCatalog,
  getPluginStatus,
  JSON_OBJECT_SCHEMA,
  PLUGIN_DIAGNOSTIC_SCHEMA,
  PLUGIN_STATUS_SCHEMA,
  type AgentCanvasProblemCode,
  type CoreJsonSchemaTool,
  type McpJsonSchemaTool
} from '../api-v2/index.js';
import {
  MACRO_ARCHIVE_REQUEST_SCHEMA,
  MACRO_ARCHIVE_RESPONSE_SCHEMA,
  MACRO_CREATE_REQUEST_SCHEMA,
  MACRO_CREATE_VERSION_REQUEST_SCHEMA,
  MACRO_GET_REQUEST_SCHEMA,
  MACRO_GET_RESPONSE_SCHEMA,
  MACRO_LIST_REQUEST_SCHEMA,
  MACRO_LIST_RESPONSE_SCHEMA,
  MACRO_PLAN_REQUEST_SCHEMA,
  MACRO_PROVENANCE_SCHEMA,
  CANVAS_RUN_MACRO_REQUEST_SCHEMA
} from '../macros/index.js';
import type { MacroRuntime } from '../macros/runtime.js';
import type { MacroDefinitionRecord, MacroExecutionResult } from '../macros/types.js';
import { MacroError } from '../macros/errors.js';
import type { BrowserPluginCatalog, FrozenPluginRegistry, InspectableCanvas } from '../plugin-runtime/index.js';
import { createPluginCanvasOperations, inspectCanvas } from '../plugin-runtime/index.js';
import type { V2SqliteCanvasStore } from '../store/v2.js';
import { AGENTCANVAS_VERSION } from '../version.js';
import { canvasPageUrl } from '../canvas-url.js';
import { AGENTCANVAS_AGENT_GUIDANCE, AGENTCANVAS_MCP_INSTRUCTIONS } from './agent-guidance.js';
import { CanvasError, toCanvasError } from '../errors.js';
import { VIEWER_PRESENCE_MAX_ACTIVE, type ViewerPresenceRegistry } from '../viewer-presence.js';

export interface McpV2Runtime {
  publicBaseUrl: string;
  registry: FrozenPluginRegistry;
  store: V2SqliteCanvasStore;
  browserCatalog: BrowserPluginCatalog;
  viewerPresence: ViewerPresenceRegistry;
  diagnostics(): readonly import('@agentcanvas/plugin-sdk').PluginDiagnostic[];
  macros?: MacroRuntime;
}

export type McpCatalogProfile = 'lean' | 'full';

const DIRECT_LEAN_PLUGIN_IDS = new Set([
  'agentcanvas.filesystem-images',
  'agentcanvas.markdown',
  'agentcanvas.primitives',
  'agentcanvas.table'
]);

const CANVAS_ID = { type: 'string', minLength: 1 };
const ELEMENT_ID = { type: 'string', minLength: 1 };
const CANVAS_URL_SCHEMA: JsonSchema = {
  type: 'string',
  minLength: 1,
  description: 'Direct browser URL for this canvas, based on AGENT_CANVAS_PUBLIC_BASE_URL.'
};

const INSPECTION_SUMMARY_SCHEMA = CANVAS_INSPECTION_SUMMARY_SCHEMA;
const CURSOR_SCHEMA: JsonSchema = { type: 'string', minLength: 1, maxLength: 512 };
const PAGE_LIMIT_SCHEMA: JsonSchema = { type: 'integer', minimum: 1, maximum: 200, default: 100 };

const CANVAS_SUMMARY_SCHEMA: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'title', 'project', 'updatedAt', 'revision', 'documentVersion', 'elementCount'],
  properties: {
    id: CANVAS_ID,
    title: { type: 'string' },
    project: { type: ['string', 'null'] },
    updatedAt: { type: 'string' },
    revision: { type: 'integer', minimum: 1 },
    documentVersion: { const: 2 },
    elementCount: { type: 'integer', minimum: 0 }
  }
};

const ELEMENT_PAGE_ITEM_SCHEMA: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'type', 'schemaVersion', 'frame', 'summary'],
  properties: {
    id: ELEMENT_ID,
    type: { type: 'string' },
    schemaVersion: { type: 'integer', minimum: 1 },
    frame: {
      type: 'object',
      additionalProperties: false,
      required: ['x', 'y'],
      properties: {
        x: { type: 'number' },
        y: { type: 'number' },
        width: { type: ['number', 'null'] },
        height: { type: ['number', 'null'] },
        zIndex: { type: ['number', 'null'] },
        rotation: { type: ['number', 'null'] }
      }
    },
    summary: {
      type: 'object',
      additionalProperties: false,
      required: ['title'],
      properties: { title: { type: 'string', maxLength: 200 }, detail: { type: 'string', maxLength: 500 } }
    }
  }
};

const MACRO_PLAN_RECEIPT_SCHEMA: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'planId',
    'macroId',
    'macroVersion',
    'canvasId',
    'canvasRevision',
    'inputDigest',
    'planDigest',
    'createdAt',
    'expiresAt',
    'outputs',
    'effectSummary'
  ],
  properties: {
    planId: { type: 'string', minLength: 1 },
    macroId: { type: 'string', minLength: 1 },
    macroVersion: { type: 'integer', minimum: 1 },
    canvasId: CANVAS_ID,
    canvasRevision: { type: 'integer', minimum: 1 },
    inputDigest: { type: 'string', pattern: '^[a-f0-9]{64}$' },
    planDigest: { type: 'string', pattern: '^[a-f0-9]{64}$' },
    createdAt: { type: 'string' },
    expiresAt: { type: 'string' },
    outputs: { type: 'object', additionalProperties: { type: 'string', minLength: 1 } },
    effectSummary: {
      type: 'object',
      additionalProperties: false,
      required: ['label', 'operationCount', 'generatedElementCount', 'affectedElementCount'],
      properties: {
        label: { type: 'string' },
        operationCount: { type: 'integer', minimum: 0 },
        generatedElementCount: { type: 'integer', minimum: 0 },
        affectedElementCount: { type: 'integer', minimum: 0 }
      }
    }
  }
};

const PLUGIN_SUMMARY_CATALOG_SCHEMA: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['plugins', 'diagnosticCounts'],
  properties: {
    plugins: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'version', 'displayName', 'elementTypes', 'tools', 'capabilities', 'diagnosticCounts'],
        properties: {
          id: { type: 'string' },
          version: { type: 'string' },
          displayName: { type: 'string' },
          elementTypes: { type: 'array', items: { type: 'string' } },
          tools: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['name', 'directName'],
              properties: { name: { type: 'string' }, directName: { type: ['string', 'null'] } }
            }
          },
          capabilities: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['name', 'relationship', 'ok'],
              properties: {
                name: { type: 'string' },
                relationship: { enum: ['required', 'provided'] },
                ok: { type: 'boolean' },
                code: { type: 'string' }
              }
            }
          },
          diagnosticCounts: INSPECTION_SUMMARY_SCHEMA
        }
      }
    },
    diagnosticCounts: INSPECTION_SUMMARY_SCHEMA
  }
};

const EXTENSION_TOOL_SELECTOR_SCHEMA: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['pluginId', 'toolName'],
  properties: {
    pluginId: { type: 'string', minLength: 1 },
    toolName: { type: 'string', minLength: 1 }
  }
};

const EXTENSION_TOOL_ARGUMENTS_SCHEMA: JsonSchema = {
  ...EXTENSION_TOOL_SELECTOR_SCHEMA,
  required: ['pluginId', 'toolName', 'arguments'],
  properties: { ...(EXTENSION_TOOL_SELECTOR_SCHEMA.properties as JsonObject), arguments: JSON_OBJECT_SCHEMA }
};

const GENERIC_OBJECT_OUTPUT_SCHEMA: JsonSchema = {
  type: 'object',
  not: { required: ['problem'], properties: { problem: {} } }
};

const CREATED_CANVAS_RECEIPT_SCHEMA: JsonSchema = {
  ...CANVAS_MUTATION_RECEIPT_SCHEMA,
  required: [...(CANVAS_MUTATION_RECEIPT_SCHEMA.required as string[]), 'url'],
  properties: { ...(CANVAS_MUTATION_RECEIPT_SCHEMA.properties as JsonObject), url: CANVAS_URL_SCHEMA }
};

const MACRO_EXECUTION_RECEIPT_SCHEMA: JsonSchema = {
  ...CANVAS_MUTATION_RECEIPT_SCHEMA,
  required: [...(CANVAS_MUTATION_RECEIPT_SCHEMA.required as string[]), 'provenance', 'outputs', 'affectedElementIds'],
  properties: {
    ...(CANVAS_MUTATION_RECEIPT_SCHEMA.properties as JsonObject),
    provenance: MACRO_PROVENANCE_SCHEMA,
    outputs: { type: 'object', additionalProperties: { type: 'string', minLength: 1 } },
    affectedElementIds: { type: 'array', maxItems: 100, uniqueItems: true, items: ELEMENT_ID }
  }
};

const FRAME_SCHEMA: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  minProperties: 1,
  properties: {
    x: { type: 'number', description: 'New left edge in canvas world coordinates.' },
    y: { type: 'number', description: 'New top edge in canvas world coordinates.' },
    width: { type: ['number', 'null'], description: 'New visible frame width.' },
    height: { type: ['number', 'null'], description: 'New visible frame height.' },
    zIndex: { type: ['number', 'null'] },
    rotation: { type: ['number', 'null'] },
    opacity: { type: ['number', 'null'], minimum: 0, maximum: 1 },
    locked: { type: ['boolean', 'null'] }
  }
};

function canvasSchema(elementSchema: JsonSchema, includeInspection = false, includeUrl = false): JsonSchema {
  return {
    type: 'object',
    additionalProperties: false,
    required: [
      'id',
      'title',
      'createdBy',
      'createdAt',
      'updatedAt',
      'bounds',
      'elements',
      'revision',
      'documentVersion',
      ...(includeInspection ? ['diagnostics', 'inspectionSummary'] : []),
      ...(includeUrl ? ['url'] : [])
    ],
    properties: {
      id: CANVAS_ID,
      title: { type: 'string' },
      description: { type: ['string', 'null'] },
      project: { type: ['string', 'null'] },
      conversationId: { type: ['string', 'null'] },
      createdBy: { type: 'string', enum: ['agent', 'user', 'system'] },
      createdAt: { type: 'string' },
      updatedAt: { type: 'string' },
      bounds: CANVAS_BOUNDS_SCHEMA,
      width: { type: 'number' },
      height: { type: 'number' },
      background: { oneOf: [JSON_OBJECT_SCHEMA, { type: 'null' }] },
      theme: { oneOf: [CANVAS_THEME_V1_SCHEMA, { type: 'null' }] },
      elements: { type: 'array', items: elementSchema },
      revision: { type: 'integer', minimum: 1 },
      metadata: JSON_OBJECT_SCHEMA,
      documentVersion: { const: 2 },
      ...(includeInspection
        ? {
            diagnostics: { type: 'array', items: PLUGIN_DIAGNOSTIC_SCHEMA },
            inspectionSummary: INSPECTION_SUMMARY_SCHEMA
          }
        : {}),
      ...(includeUrl ? { url: CANVAS_URL_SCHEMA } : {})
    }
  };
}

function coreTools(): readonly CoreJsonSchemaTool[] {
  // Reads preserve canonical envelopes even when their owning extension is absent.
  const canvas = canvasSchema(CANVAS_ELEMENT_SCHEMA);
  const inspectedCanvas = canvasSchema(CANVAS_ELEMENT_SCHEMA, true);
  const canvasList: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['canvases'],
    properties: { canvases: { type: 'array', items: CANVAS_SUMMARY_SCHEMA } }
  };
  return [
    {
      name: 'canvas_get_guidance',
      title: 'Get agent canvas guidance',
      description:
        'Read this before creating, editing, or evaluating a canvas. It returns the concise runtime rules for layout, literal text, capability discovery, and evidence-based claims.',
      inputSchema: { type: 'object', additionalProperties: false, properties: {} },
      outputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['schemaVersion', 'workflow', 'layout', 'text', 'truth', 'mcpCatalog'],
        properties: {
          schemaVersion: { const: 1 },
          workflow: { type: 'array', items: { type: 'string' } },
          layout: { type: 'array', items: { type: 'string' } },
          text: { type: 'array', items: { type: 'string' } },
          truth: { type: 'array', items: { type: 'string' } },
          mcpCatalog: {
            type: 'object',
            additionalProperties: false,
            required: ['coreToolCount', 'pluginToolCount', 'totalToolCount'],
            properties: {
              coreToolCount: { type: 'integer', minimum: 1 },
              pluginToolCount: { type: 'integer', minimum: 0 },
              totalToolCount: { type: 'integer', minimum: 1 }
            }
          }
        }
      },
      annotations: { readOnlyHint: true }
    },
    {
      name: 'canvas_create',
      title: 'Create canvas',
      description:
        'Create an empty AgentCanvas v0.2 canvas and return a compact receipt with its direct browser URL. This does not create elements or prove a finished layout is readable.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['title'],
        properties: {
          title: CORE_REQUEST_SCHEMAS.create.properties.title,
          project: CORE_REQUEST_SCHEMAS.create.properties.project,
          description: CORE_REQUEST_SCHEMAS.create.properties.description,
          bounds: CANVAS_BOUNDS_SCHEMA,
          theme: { oneOf: [CANVAS_THEME_V1_SCHEMA, { type: 'null' }] }
        }
      },
      outputSchema: CREATED_CANVAS_RECEIPT_SCHEMA
    },
    {
      name: 'canvas_list',
      title: 'List canvases',
      description: 'List recent canvases.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: { limit: CANVAS_LIST_LIMIT_SCHEMA }
      },
      outputSchema: canvasList,
      annotations: { readOnlyHint: true }
    },
    {
      name: 'canvas_get',
      title: 'Get canvas',
      description:
        'Get the complete persisted source of truth for one canvas. Use it only when full element IDs, frames, and data are needed; mutation receipts already confirm the resulting revision and diagnostic counts. Persisted state alone does not prove rendered readability or remote-image loading.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['canvasId'],
        properties: { canvasId: CANVAS_ID }
      },
      outputSchema: inspectedCanvas,
      annotations: { readOnlyHint: true }
    },
    {
      name: 'canvas_list_viewers',
      title: 'List active canvas viewers',
      description:
        'List anonymous visible browser tabs viewing this canvas. Each viewport gives world-space center and zoom plus actual CSS-pixel dimensions. Entries expire 30 seconds after the last report; an empty list means no recently reporting visible tab.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['canvasId'],
        properties: { canvasId: CANVAS_ID }
      },
      outputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['canvasId', 'asOf', 'viewers'],
        properties: {
          canvasId: CANVAS_ID,
          asOf: { type: 'string' },
          viewers: {
            type: 'array',
            maxItems: VIEWER_PRESENCE_MAX_ACTIVE,
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['viewerId', 'viewport', 'lastSeenAt'],
              properties: {
                viewerId: VIEWER_ID_SCHEMA,
                viewport: CORE_REQUEST_SCHEMAS.viewerPresence,
                lastSeenAt: { type: 'string' }
              }
            }
          }
        }
      },
      annotations: { readOnlyHint: true }
    },
    {
      name: 'canvas_list_elements',
      title: 'List canvas elements',
      description:
        'List bounded element identities, frames, and plugin-owned summaries. Continue only with the returned revision-bound cursor.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['canvasId'],
        properties: { canvasId: CANVAS_ID, limit: PAGE_LIMIT_SCHEMA, cursor: CURSOR_SCHEMA }
      },
      outputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['canvasId', 'revision', 'items'],
        properties: {
          canvasId: CANVAS_ID,
          revision: { type: 'integer', minimum: 1 },
          items: { type: 'array', maxItems: 200, items: ELEMENT_PAGE_ITEM_SCHEMA },
          nextCursor: CURSOR_SCHEMA
        }
      },
      annotations: { readOnlyHint: true }
    },
    {
      name: 'canvas_get_element',
      title: 'Get canvas element',
      description: 'Get one complete persisted element plus its canvas ID and revision.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['canvasId', 'elementId'],
        properties: { canvasId: CANVAS_ID, elementId: ELEMENT_ID }
      },
      outputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['canvasId', 'revision', 'element'],
        properties: {
          canvasId: CANVAS_ID,
          revision: { type: 'integer', minimum: 1 },
          element: CANVAS_ELEMENT_SCHEMA
        }
      },
      annotations: { readOnlyHint: true }
    },
    {
      name: 'canvas_get_url',
      title: 'Get canvas browser URL',
      description:
        'Return the direct browser URL for an existing canvas. Use this when you need to give a user the canvas URL after a previous creation or edit. This does not create a share link or change access controls.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['canvasId'],
        properties: { canvasId: CANVAS_ID }
      },
      outputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['canvasId', 'url'],
        properties: { canvasId: CANVAS_ID, url: CANVAS_URL_SCHEMA }
      },
      annotations: { readOnlyHint: true }
    },
    {
      name: 'canvas_inspect',
      title: 'Inspect canvas quality',
      description:
        'Run deterministic plugin-owned quality checks against persisted elements. Use after edits to find likely clipping and similar repairable issues; a clean result still does not prove rendered appearance or remote resource loading.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['canvasId'],
        properties: {
          canvasId: CANVAS_ID,
          severity: { type: 'array', maxItems: 3, uniqueItems: true, items: { enum: ['info', 'warning', 'error'] } },
          code: { type: 'array', maxItems: 50, uniqueItems: true, items: { type: 'string', minLength: 1 } },
          limit: { type: 'integer', minimum: 1, maximum: 100, default: 25 },
          cursor: CURSOR_SCHEMA
        }
      },
      outputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['canvasId', 'revision', 'diagnostics', 'summary'],
        properties: {
          canvasId: CANVAS_ID,
          revision: { type: 'integer', minimum: 1 },
          diagnostics: { type: 'array', maxItems: 100, items: PLUGIN_DIAGNOSTIC_SCHEMA },
          summary: INSPECTION_SUMMARY_SCHEMA,
          nextCursor: CURSOR_SCHEMA
        }
      },
      annotations: { readOnlyHint: true }
    },
    mutationTool(
      'canvas_rename',
      'Rename a canvas',
      {
        canvasId: CANVAS_ID,
        title: CORE_REQUEST_SCHEMAS.title.properties.title,
        expectedRevision: CORE_REQUEST_SCHEMAS.title.properties.expectedRevision
      },
      ['canvasId', 'title'],
      CANVAS_MUTATION_RECEIPT_SCHEMA
    ),
    mutationTool(
      'canvas_set_bounds',
      'Set unlimited or fixed canvas bounds',
      {
        canvasId: CANVAS_ID,
        bounds: CANVAS_BOUNDS_SCHEMA,
        expectedRevision: CORE_REQUEST_SCHEMAS.bounds.properties.expectedRevision
      },
      ['canvasId', 'bounds'],
      CANVAS_MUTATION_RECEIPT_SCHEMA
    ),
    mutationTool(
      'canvas_set_theme',
      'Set a complete semantic theme on a canvas',
      {
        canvasId: CANVAS_ID,
        theme: CANVAS_THEME_V1_SCHEMA as JsonObject,
        expectedRevision: CORE_REQUEST_SCHEMAS.title.properties.expectedRevision
      },
      ['canvasId', 'theme'],
      CANVAS_MUTATION_RECEIPT_SCHEMA
    ),
    mutationTool(
      'canvas_clear_theme',
      'Clear a canvas theme and restore AgentCanvas defaults',
      {
        canvasId: CANVAS_ID,
        expectedRevision: CORE_REQUEST_SCHEMAS.title.properties.expectedRevision
      },
      ['canvasId'],
      CANVAS_MUTATION_RECEIPT_SCHEMA
    ),
    mutationTool(
      'canvas_upsert_element',
      'Upsert a complete current-version element; prefer a plugin-specific tool when one exists for its detailed schema',
      {
        canvasId: CANVAS_ID,
        element: {
          ...(CANVAS_ELEMENT_SCHEMA as JsonObject),
          description:
            'Generic canonical element envelope. Prefer a plugin-specific tool when available for its detailed element schema.'
        },
        expectedRevision: CORE_REQUEST_SCHEMAS.title.properties.expectedRevision
      },
      ['canvasId', 'element'],
      CANVAS_MUTATION_RECEIPT_SCHEMA
    ),
    mutationTool(
      'canvas_patch_element_frame',
      'Patch only kernel-owned frame fields',
      {
        canvasId: CANVAS_ID,
        elementId: ELEMENT_ID,
        frame: FRAME_SCHEMA as JsonObject,
        expectedRevision: CORE_REQUEST_SCHEMAS.title.properties.expectedRevision
      },
      ['canvasId', 'elementId', 'frame'],
      CANVAS_MUTATION_RECEIPT_SCHEMA
    ),
    mutationTool(
      'canvas_replace_element_data',
      'Replace plugin-owned element data and optional style atomically',
      {
        canvasId: CANVAS_ID,
        elementId: ELEMENT_ID,
        data: JSON_OBJECT_SCHEMA as JsonObject,
        style: { oneOf: [JSON_OBJECT_SCHEMA, { type: 'null' }] },
        expectedRevision: CORE_REQUEST_SCHEMAS.title.properties.expectedRevision
      },
      ['canvasId', 'elementId', 'data'],
      CANVAS_MUTATION_RECEIPT_SCHEMA
    ),
    mutationTool(
      'canvas_replace_element_metadata',
      'Replace generic element metadata atomically',
      {
        canvasId: CANVAS_ID,
        elementId: ELEMENT_ID,
        metadata: JSON_OBJECT_SCHEMA as JsonObject,
        expectedRevision: CORE_REQUEST_SCHEMAS.title.properties.expectedRevision
      },
      ['canvasId', 'elementId', 'metadata'],
      CANVAS_MUTATION_RECEIPT_SCHEMA
    ),
    mutationTool(
      'canvas_delete_element',
      'Delete an element',
      {
        canvasId: CANVAS_ID,
        elementId: ELEMENT_ID,
        expectedRevision: CORE_REQUEST_SCHEMAS.title.properties.expectedRevision
      },
      ['canvasId', 'elementId'],
      CANVAS_MUTATION_RECEIPT_SCHEMA
    ),
    mutationTool(
      'canvas_clear',
      'Remove all elements from a canvas',
      {
        canvasId: CANVAS_ID,
        expectedRevision: CORE_REQUEST_SCHEMAS.title.properties.expectedRevision
      },
      ['canvasId'],
      CANVAS_MUTATION_RECEIPT_SCHEMA
    ),
    {
      name: 'canvas_list_plugins',
      title: 'List plugins',
      description:
        'List sanitized active plugin status. Treat this runtime result as authoritative for which element types and plugin tools are currently available.',
      inputSchema: { type: 'object', additionalProperties: false, properties: {} },
      outputSchema: PLUGIN_SUMMARY_CATALOG_SCHEMA,
      annotations: { readOnlyHint: true }
    },
    {
      name: 'canvas_get_plugin',
      title: 'Get plugin',
      description: 'Get sanitized status for one active plugin.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['pluginId'],
        properties: { pluginId: { type: 'string' } }
      },
      outputSchema: PLUGIN_STATUS_SCHEMA,
      annotations: { readOnlyHint: true }
    },
    {
      name: 'canvas_get_extension_tool',
      title: 'Get extension tool descriptor',
      description:
        'Get the exact registry-owned descriptor, schemas, annotations, errors, and dispatcher for one active extension tool.',
      inputSchema: EXTENSION_TOOL_SELECTOR_SCHEMA,
      outputSchema: GENERIC_OBJECT_OUTPUT_SCHEMA,
      annotations: { readOnlyHint: true }
    },
    {
      name: 'canvas_read_extension_tool',
      title: 'Run read-only extension tool',
      description: 'Invoke one active extension tool only when its registry descriptor marks it read-only.',
      inputSchema: EXTENSION_TOOL_ARGUMENTS_SCHEMA,
      outputSchema: GENERIC_OBJECT_OUTPUT_SCHEMA,
      annotations: { readOnlyHint: true, idempotentHint: false, openWorldHint: false }
    },
    {
      name: 'canvas_mutate_extension_tool',
      title: 'Run mutating extension tool',
      description:
        'Invoke one active extension tool only when it is not marked read-only. Inspect the target canvas after writes when counts are nonzero.',
      inputSchema: EXTENSION_TOOL_ARGUMENTS_SCHEMA,
      outputSchema: GENERIC_OBJECT_OUTPUT_SCHEMA,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false
      }
    }
  ];
}

function macroTools(): readonly CoreJsonSchemaTool[] {
  return [
    {
      name: 'macro_list',
      title: 'List macros',
      description: 'List installation macros and macros scoped to one canvas.',
      inputSchema: MACRO_LIST_REQUEST_SCHEMA,
      outputSchema: MACRO_LIST_RESPONSE_SCHEMA,
      annotations: { readOnlyHint: true }
    },
    {
      name: 'macro_get',
      title: 'Get exact macro version',
      description: 'Get one exact immutable macro version.',
      inputSchema: MACRO_GET_REQUEST_SCHEMA,
      outputSchema: MACRO_GET_RESPONSE_SCHEMA,
      annotations: { readOnlyHint: true }
    },
    {
      name: 'macro_create',
      title: 'Create macro',
      description: 'Create a macro; the host assigns its opaque ID and version one.',
      inputSchema: MACRO_CREATE_REQUEST_SCHEMA,
      outputSchema: MACRO_ARCHIVE_RESPONSE_SCHEMA,
      annotations: { readOnlyHint: false, idempotentHint: false }
    },
    {
      name: 'macro_create_version',
      title: 'Create macro version',
      description: 'Create the next immutable version without changing scope or canvas identity.',
      inputSchema: MACRO_CREATE_VERSION_REQUEST_SCHEMA,
      outputSchema: MACRO_ARCHIVE_RESPONSE_SCHEMA,
      annotations: { readOnlyHint: false, idempotentHint: false }
    },
    {
      name: 'macro_archive',
      title: 'Archive macro',
      description: 'Archive or unarchive a macro without changing its immutable versions.',
      inputSchema: MACRO_ARCHIVE_REQUEST_SCHEMA,
      outputSchema: MACRO_ARCHIVE_RESPONSE_SCHEMA,
      annotations: { readOnlyHint: false, idempotentHint: false }
    },
    {
      name: 'macro_plan',
      title: 'Plan macro',
      description:
        'Purely expand and validate an exact macro version for a canvas. Macro references are evaluated in saved template payloads. Values read from invocation input are inserted as literal JSON.',
      inputSchema: MACRO_PLAN_REQUEST_SCHEMA,
      outputSchema: MACRO_PLAN_RECEIPT_SCHEMA,
      annotations: { readOnlyHint: true }
    },
    {
      name: 'canvas_run_macro',
      title: 'Run macro',
      description: 'Execute an existing plan or directly plan and execute one exact macro version.',
      inputSchema: CANVAS_RUN_MACRO_REQUEST_SCHEMA,
      outputSchema: MACRO_EXECUTION_RECEIPT_SCHEMA,
      annotations: { readOnlyHint: false, idempotentHint: false }
    }
  ];
}

function mutationTool(
  name: string,
  description: string,
  properties: Record<string, JsonSchema>,
  required: string[],
  outputSchema: JsonSchema
): CoreJsonSchemaTool {
  return {
    name,
    title: description,
    description: `${description}. Returns revision and diagnostic counts; inspect nonzero counts with canvas_inspect.`,
    inputSchema: { type: 'object', additionalProperties: false, required, properties },
    outputSchema,
    annotations: { readOnlyHint: false, idempotentHint: false }
  };
}

function json(value: unknown): JsonObject {
  return JSON.parse(JSON.stringify(value)) as JsonObject;
}

interface PageCursor {
  revision: number;
  offset: number;
  filter?: string;
}

function encodeCursor(cursor: PageCursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString('base64url');
}

function decodeCursor(value: unknown): PageCursor | undefined {
  if (value === undefined) return undefined;
  try {
    const parsed = JSON.parse(Buffer.from(String(value), 'base64url').toString('utf8')) as PageCursor;
    if (
      !Number.isSafeInteger(parsed.revision) ||
      parsed.revision < 1 ||
      !Number.isSafeInteger(parsed.offset) ||
      parsed.offset < 0
    )
      throw new Error();
    return parsed;
  } catch {
    throw new CanvasError('validation_error', 'cursor is invalid', 'validation', 400);
  }
}

function checkedOffset(cursor: PageCursor | undefined, revision: number, filter?: string): number {
  if (!cursor) return 0;
  if (cursor.revision !== revision)
    throw new CanvasError(
      'revision_conflict',
      `cursor revision ${cursor.revision} is stale; current revision is ${revision}`,
      'revision',
      409,
      true
    );
  if (cursor.filter !== filter)
    throw new CanvasError('validation_error', 'cursor filters do not match this request', 'validation', 400);
  return cursor.offset;
}

function diagnosticCounts(diagnostics: readonly { severity: string }[]): CanvasMutationReceipt['inspectionSummary'] {
  return {
    errorCount: diagnostics.filter((item) => item.severity === 'error').length,
    warningCount: diagnostics.filter((item) => item.severity === 'warning').length,
    infoCount: diagnostics.filter((item) => item.severity === 'info').length
  };
}

function boundedText(value: string | undefined, maximum: number): string | undefined {
  return value === undefined ? undefined : value.slice(0, maximum);
}

function withInspection(canvas: InspectableCanvas, runtime: McpV2Runtime): JsonObject {
  const inspection = inspectCanvas(canvas, runtime.registry, runtime.store.getConfiguration().diagnostics);
  return json({
    ...canvas,
    diagnostics: inspection.diagnostics,
    inspectionSummary: inspection.summary
  });
}

function mutationReceipt(
  canvas: InspectableCanvas & { revision: number },
  runtime: McpV2Runtime
): CanvasMutationReceipt {
  return {
    canvasId: canvas.id,
    revision: canvas.revision,
    inspectionSummary: inspectCanvas(canvas, runtime.registry, runtime.store.getConfiguration().diagnostics).summary
  };
}

function macroDefinitionReceipt(record: MacroDefinitionRecord): JsonObject {
  return { macroId: record.definition.id, currentVersion: record.currentVersion, archived: record.archived };
}

function macroExecutionReceipt(result: MacroExecutionResult, runtime: McpV2Runtime): JsonObject {
  return {
    ...mutationReceipt(result.canvas, runtime),
    provenance: result.provenance,
    outputs: result.outputs,
    affectedElementIds: result.history.affectedElementIds
  } as unknown as JsonObject;
}

function macroPlanReceipt(plan: ReturnType<NonNullable<McpV2Runtime['macros']>['plan']>): JsonObject {
  return {
    planId: plan.planId,
    macroId: plan.macroId,
    macroVersion: plan.macroVersion,
    canvasId: plan.canvasId,
    canvasRevision: plan.canvasRevision,
    inputDigest: plan.inputDigest,
    planDigest: plan.planDigest,
    createdAt: plan.createdAt,
    expiresAt: plan.expiresAt,
    outputs: plan.outputs,
    effectSummary: {
      label: plan.effectSummary.label,
      operationCount: plan.effectSummary.operationCount,
      generatedElementCount: plan.effectSummary.generatedElementCount,
      affectedElementCount: plan.effectSummary.affectedElementIds.length
    }
  } as unknown as JsonObject;
}

function pluginTool(runtime: McpV2Runtime, pluginId: string, toolName: string): McpJsonSchemaTool {
  const plugin = runtime.registry.getPlugin(pluginId);
  if (!plugin) throw new CanvasError('plugin_unavailable', `plugin is not active: ${pluginId}`, 'not_found', 404);
  const descriptor = plugin.tools.find((tool) => tool.name === toolName);
  if (!descriptor)
    throw new CanvasError('not_found', `extension tool is not active: ${pluginId}/${toolName}`, 'not_found', 404);
  return {
    name: `extension:${pluginId}/${toolName}`,
    title: descriptor.title,
    description: descriptor.description,
    inputSchema: descriptor.inputSchema,
    outputSchema: descriptor.outputSchema,
    annotations: descriptor.annotations,
    source: 'plugin',
    pluginId,
    localName: toolName,
    descriptor
  };
}

function extensionToolDescriptor(tool: McpJsonSchemaTool): JsonObject {
  const readOnly = tool.annotations?.readOnlyHint === true;
  return json({
    pluginId: tool.pluginId,
    toolName: tool.localName,
    title: tool.title,
    description: tool.description,
    inputSchema: tool.inputSchema,
    outputSchema: tool.outputSchema,
    annotations: tool.annotations ?? {},
    errorCodes: mcpErrorCodesForTool(tool),
    dispatcher: readOnly ? 'canvas_read_extension_tool' : 'canvas_mutate_extension_tool'
  });
}

async function invokePluginTool(
  tool: McpJsonSchemaTool,
  input: JsonObject,
  runtime: McpV2Runtime,
  signal: AbortSignal,
  ajv: Ajv2020
): Promise<JsonObject> {
  const pluginId = tool.pluginId as string;
  const plugin = runtime.registry.getPlugin(pluginId);
  if (!plugin) throw new CanvasError('plugin_unavailable', `plugin is not active: ${pluginId}`, 'not_found', 404);
  const descriptor = tool.descriptor as NonNullable<McpJsonSchemaTool['descriptor']>;
  if (!ajv.validate(descriptor.inputSchema, input))
    throw new CanvasError(
      'validation_error',
      `tool input failed schema validation: ${pluginId}/${descriptor.name}`,
      'validation',
      400
    );
  const context: PluginInvocationContext = {
    signal,
    correlationId: `mcp_${nanoid(16)}`,
    canvas: createPluginCanvasOperations(runtime.store, pluginId, plugin.plugin.manifest.permissions, runtime.registry)
  };
  const output = await descriptor.invoke(input, context);
  if (!ajv.validate(descriptor.outputSchema, output))
    throw new Error(`tool output failed schema validation: ${pluginId}/${descriptor.name}`);
  return output;
}

function compactPluginCatalog(runtime: McpV2Runtime, profile: McpCatalogProfile): JsonObject {
  const status = createPluginStatusCatalog(runtime.registry, {
    browserEntries: runtime.browserCatalog.entries,
    diagnostics: runtime.diagnostics()
  });
  return json({
    plugins: status.plugins.map((plugin) => ({
      id: plugin.id,
      version: plugin.version,
      displayName: plugin.displayName,
      elementTypes: plugin.contributions.elements.map((element) => element.type),
      tools: plugin.contributions.tools.map((name) => ({
        name,
        directName: profile === 'full' || DIRECT_LEAN_PLUGIN_IDS.has(plugin.id) ? deriveToolName(plugin.id, name) : null
      })),
      capabilities: plugin.capabilities.map((capability) => ({
        name: capability.name,
        relationship: capability.relationship,
        ok: capability.status.ok,
        ...(capability.status.code ? { code: capability.status.code } : {})
      })),
      diagnosticCounts: diagnosticCounts(plugin.diagnostics)
    })),
    diagnosticCounts: diagnosticCounts(status.diagnostics)
  });
}

async function invokeCore(
  name: string,
  input: JsonObject,
  runtime: McpV2Runtime,
  profile: McpCatalogProfile,
  signal: AbortSignal,
  ajv: Ajv2020
): Promise<JsonObject> {
  const store = runtime.store;
  const canvasId = input.canvasId as string;
  const expectedRevision = input.expectedRevision as number | undefined;
  if (name === 'canvas_get_guidance') {
    const coreToolCount = coreTools().length + macroTools().length;
    const pluginToolCount = runtime.registry.plugins.reduce(
      (count, plugin) =>
        count + (profile === 'full' || DIRECT_LEAN_PLUGIN_IDS.has(plugin.plugin.manifest.id) ? plugin.tools.length : 0),
      0
    );
    return json({
      ...AGENTCANVAS_AGENT_GUIDANCE,
      mcpCatalog: { coreToolCount, pluginToolCount, totalToolCount: coreToolCount + pluginToolCount }
    });
  }
  if (name === 'macro_list') {
    if (!runtime.macros) throw new Error('macro runtime is unavailable');
    return runtime.macros.list(input as never) as unknown as JsonObject;
  }
  if (name === 'macro_get') {
    if (!runtime.macros) throw new Error('macro runtime is unavailable');
    return runtime.macros.get(
      input.macroId as string,
      input.macroVersion as number,
      (input.canvasId as string | undefined) ?? ''
    ) as unknown as JsonObject;
  }
  if (name === 'macro_create') {
    if (!runtime.macros) throw new Error('macro runtime is unavailable');
    return macroDefinitionReceipt(runtime.macros.create(input as never));
  }
  if (name === 'macro_create_version') {
    if (!runtime.macros) throw new Error('macro runtime is unavailable');
    return macroDefinitionReceipt(runtime.macros.createVersion(input as never));
  }
  if (name === 'macro_archive') {
    if (!runtime.macros) throw new Error('macro runtime is unavailable');
    return runtime.macros.archive(input.macroId as string, input.archived as boolean) as unknown as JsonObject;
  }
  if (name === 'macro_plan') {
    if (!runtime.macros) throw new Error('macro runtime is unavailable');
    return macroPlanReceipt(runtime.macros.plan(input as never));
  }
  if (name === 'canvas_run_macro') {
    if (!runtime.macros) throw new Error('macro runtime is unavailable');
    const result =
      input.mode === 'plan'
        ? await runtime.macros.execute(input as never)
        : await runtime.macros.direct(input as never);
    return macroExecutionReceipt(result, runtime);
  }
  if (name === 'canvas_create') {
    const canvas = store.createCanvas(input as never);
    return { ...mutationReceipt(canvas, runtime), url: canvasPageUrl(runtime.publicBaseUrl, canvas.id) };
  }
  if (name === 'canvas_list')
    return {
      canvases: store.listCanvases({ limit: input.limit as number | undefined }).map((canvas) => ({
        id: canvas.id,
        title: canvas.title,
        project: canvas.project ?? null,
        updatedAt: canvas.updatedAt,
        revision: canvas.revision,
        documentVersion: canvas.documentVersion,
        elementCount: canvas.elements.length
      }))
    } as unknown as JsonObject;
  if (name === 'canvas_get') return withInspection(store.getCanvas(canvasId), runtime);
  if (name === 'canvas_list_viewers') {
    store.getCanvas(canvasId);
    return json(runtime.viewerPresence.list(canvasId));
  }
  if (name === 'canvas_list_elements') {
    const canvas = store.getCanvas(canvasId);
    const limit = (input.limit as number | undefined) ?? 100;
    const offset = checkedOffset(decodeCursor(input.cursor), canvas.revision);
    const items = canvas.elements.slice(offset, offset + limit).map((element) => {
      const summary = runtime.registry.getElementType(element.type)?.summarize(element) ?? {
        title: `Unavailable ${element.type}`
      };
      return {
        id: element.id,
        type: element.type,
        schemaVersion: element.schemaVersion,
        frame: {
          x: element.x,
          y: element.y,
          width: element.width ?? null,
          height: element.height ?? null,
          zIndex: element.zIndex ?? null,
          rotation: element.rotation ?? null
        },
        summary: {
          title: boundedText(summary.title, 200),
          ...(summary.detail ? { detail: boundedText(summary.detail, 500) } : {})
        }
      };
    });
    return json({
      canvasId,
      revision: canvas.revision,
      items,
      ...(offset + items.length < canvas.elements.length
        ? { nextCursor: encodeCursor({ revision: canvas.revision, offset: offset + items.length }) }
        : {})
    });
  }
  if (name === 'canvas_get_element') {
    const canvas = store.getCanvas(canvasId);
    const element = canvas.elements.find((candidate) => candidate.id === input.elementId);
    if (!element) throw new CanvasError('not_found', `element not found: ${String(input.elementId)}`, 'not_found', 404);
    return json({ canvasId, revision: canvas.revision, element });
  }
  if (name === 'canvas_get_url') {
    const canvas = store.getCanvas(canvasId);
    return { canvasId: canvas.id, url: canvasPageUrl(runtime.publicBaseUrl, canvas.id) };
  }
  if (name === 'canvas_inspect') {
    const canvas = store.getCanvas(canvasId);
    const inspection = inspectCanvas(canvas, runtime.registry, store.getConfiguration().diagnostics);
    const severities = (input.severity as string[] | undefined) ?? [];
    const codes = (input.code as string[] | undefined) ?? [];
    const filter = JSON.stringify({ severities: [...severities].sort(), codes: [...codes].sort() });
    const offset = checkedOffset(decodeCursor(input.cursor), canvas.revision, filter);
    const limit = (input.limit as number | undefined) ?? 25;
    const filtered = inspection.diagnostics.filter(
      (diagnostic) =>
        (severities.length === 0 || severities.includes(diagnostic.severity)) &&
        (codes.length === 0 || codes.includes(diagnostic.code))
    );
    const diagnostics = filtered.slice(offset, offset + limit);
    return json({
      canvasId,
      revision: canvas.revision,
      diagnostics,
      summary: inspection.summary,
      ...(offset + diagnostics.length < filtered.length
        ? { nextCursor: encodeCursor({ revision: canvas.revision, offset: offset + diagnostics.length, filter }) }
        : {})
    });
  }
  if (name === 'canvas_rename') {
    return mutationReceipt(
      store.renameCanvas(canvasId, {
        title: input.title as string,
        expectedRevision
      }),
      runtime
    );
  }
  if (name === 'canvas_set_bounds') {
    return mutationReceipt(
      store.updateCanvasBounds(canvasId, { bounds: input.bounds as CanvasBounds, expectedRevision }),
      runtime
    );
  }
  if (name === 'canvas_set_theme') {
    return mutationReceipt(
      store.updateCanvasTheme(canvasId, { theme: input.theme as unknown as CanvasThemeV1, expectedRevision }),
      runtime
    );
  }
  if (name === 'canvas_clear_theme') {
    return mutationReceipt(store.updateCanvasTheme(canvasId, { theme: null, expectedRevision }), runtime);
  }
  if (name === 'canvas_upsert_element') {
    return mutationReceipt(
      store.applyOperations(canvasId, {
        expectedRevision,
        operations: [{ op: 'upsertElement', element: input.element as JsonObject }]
      }),
      runtime
    );
  }
  if (name === 'canvas_patch_element_frame') {
    return mutationReceipt(
      store.applyOperations(canvasId, {
        expectedRevision,
        operations: [
          { op: 'patchElementFrame', elementId: input.elementId as string, frame: input.frame as JsonObject }
        ]
      }),
      runtime
    );
  }
  if (name === 'canvas_replace_element_data') {
    return mutationReceipt(
      store.applyOperations(canvasId, {
        expectedRevision,
        operations: [
          {
            op: 'replaceElementData',
            elementId: input.elementId as string,
            data: input.data as JsonObject,
            ...(Object.hasOwn(input, 'style') ? { style: input.style as JsonObject | null } : {})
          }
        ]
      }),
      runtime
    );
  }
  if (name === 'canvas_replace_element_metadata') {
    return mutationReceipt(
      store.applyOperations(canvasId, {
        expectedRevision,
        operations: [
          { op: 'replaceElementMetadata', elementId: input.elementId as string, metadata: input.metadata as JsonObject }
        ]
      }),
      runtime
    );
  }
  if (name === 'canvas_delete_element') {
    return mutationReceipt(
      store.applyOperations(canvasId, {
        expectedRevision,
        operations: [{ op: 'deleteElement', elementId: input.elementId as string }]
      }),
      runtime
    );
  }
  if (name === 'canvas_clear')
    return mutationReceipt(
      store.applyOperations(canvasId, { expectedRevision, operations: [{ op: 'clear' }] }),
      runtime
    );
  if (name === 'canvas_list_plugins') return compactPluginCatalog(runtime, profile);
  if (name === 'canvas_get_plugin') {
    const status = createPluginStatusCatalog(runtime.registry, {
      browserEntries: runtime.browserCatalog.entries,
      diagnostics: runtime.diagnostics()
    });
    const plugin = getPluginStatus(status, input.pluginId as string);
    if (!plugin) throw new Error(`plugin is not active: ${String(input.pluginId)}`);
    return plugin as unknown as JsonObject;
  }
  if (name === 'canvas_get_extension_tool')
    return extensionToolDescriptor(pluginTool(runtime, input.pluginId as string, input.toolName as string));
  if (name === 'canvas_read_extension_tool' || name === 'canvas_mutate_extension_tool') {
    const tool = pluginTool(runtime, input.pluginId as string, input.toolName as string);
    const readOnly = tool.annotations?.readOnlyHint === true;
    if ((name === 'canvas_read_extension_tool') !== readOnly)
      throw new CanvasError(
        'validation_error',
        `${tool.pluginId}/${tool.localName} must use ${readOnly ? 'canvas_read_extension_tool' : 'canvas_mutate_extension_tool'}`,
        'validation',
        400
      );
    return invokePluginTool(tool, input.arguments as JsonObject, runtime, signal, ajv);
  }
  throw new Error(`unknown core MCP tool: ${name}`);
}

function schemaObject(schema: JsonSchema): Record<string, unknown> {
  if (typeof schema === 'boolean') throw new Error('MCP tool schemas must be JSON Schema objects');
  return schema;
}

/** Creates the canonical tool catalog shared by MCP runtime exposure and generated contract artifacts. */
export function createMcpV2ToolCatalog(
  registry: FrozenPluginRegistry,
  profile: McpCatalogProfile = 'lean'
): readonly McpJsonSchemaTool[] {
  return createMcpToolCatalog(registry, [...coreTools(), ...macroTools()])
    .filter(
      (tool) => tool.source === 'core' || profile === 'full' || DIRECT_LEAN_PLUGIN_IDS.has(tool.pluginId as string)
    )
    .map((tool) => Object.freeze({ ...tool, outputSchema: mcpOutputSchema(tool.outputSchema) }));
}

/** Declares the application failures a caller should handle for one normalized tool contract. */
export function mcpErrorCodesForTool(tool: McpJsonSchemaTool): readonly AgentCanvasProblemCode[] {
  const codes = new Set<AgentCanvasProblemCode>(['validation_error', 'internal_error']);
  if (tool.source === 'plugin') {
    codes.add('plugin_unavailable');
    codes.add('plugin_permission_denied');
    codes.add('not_found');
    codes.add('element_not_found');
  }
  if (tool.name.startsWith('macro_') || tool.name === 'canvas_run_macro') {
    for (const code of Object.keys(AGENTCANVAS_PROBLEM_CODES) as AgentCanvasProblemCode[]) {
      if (code.startsWith('macro_')) codes.add(code);
    }
  }
  if (tool.name.startsWith('canvas_') && tool.name !== 'canvas_get_guidance') {
    codes.add('not_found');
    codes.add('stored_canvas_invalid');
    codes.add('database_version_invalid');
  }
  if (!tool.annotations?.readOnlyHint) {
    codes.add('revision_conflict');
    codes.add('idempotency_conflict');
  }
  return [...codes].sort();
}

function responseReceipt(output: JsonObject): string {
  const scalarKeys = [
    'canvasId',
    'elementId',
    'macroId',
    'macroVersion',
    'currentVersion',
    'planId',
    'revision',
    'canvasRevision'
  ];
  const collectionKeys = [
    'canvases',
    'elements',
    'items',
    'diagnostics',
    'plugins',
    'warnings',
    'generatedIds',
    'removedRelationshipIds'
  ];
  const fields = scalarKeys.flatMap((key) => {
    const value = output[key];
    return ['string', 'number', 'boolean'].includes(typeof value) ? [`${key}=${String(value)}`] : [];
  });
  for (const key of collectionKeys) if (Array.isArray(output[key])) fields.push(`${key}=${output[key].length}`);
  return (fields.length ? fields.join(' ') : 'ok; result in structuredContent').slice(0, 512);
}

export function createMcpV2Server(
  runtime: McpV2Runtime,
  profile: McpCatalogProfile = 'lean'
): {
  server: Server;
  tools: readonly McpJsonSchemaTool[];
} {
  const tools = createMcpV2ToolCatalog(runtime.registry, profile);
  const ajv = new Ajv2020({ strict: true, allErrors: true, useDefaults: false });
  const validators = new Map<string, { input: ValidateFunction; output: ValidateFunction }>(
    tools.map((tool) => [tool.name, { input: ajv.compile(tool.inputSchema), output: ajv.compile(tool.outputSchema) }])
  );
  const server = new Server(
    { name: 'AgentCanvasMcp', version: AGENTCANVAS_VERSION },
    {
      capabilities: { tools: {} },
      instructions: AGENTCANVAS_MCP_INSTRUCTIONS
    }
  );
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: tools.map((tool) => ({
      name: tool.name,
      title: tool.title,
      description: tool.description,
      inputSchema: schemaObject(tool.inputSchema),
      outputSchema: schemaObject(tool.outputSchema),
      ...(tool.annotations ? { annotations: tool.annotations } : {})
    }))
  }));
  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    const tool = tools.find((candidate) => candidate.name === request.params.name);
    try {
      if (!tool) throw new CanvasError('not_found', `unknown tool: ${request.params.name}`, 'not_found', 404);
      const input = (request.params.arguments ?? {}) as JsonObject;
      const validation = validators.get(tool.name) as { input: ValidateFunction; output: ValidateFunction };
      if (!validation.input(input))
        throw new CanvasError(
          'validation_error',
          `tool input failed schema validation: ${tool.name}`,
          'validation',
          400
        );
      let output: JsonObject;
      if (tool.source === 'core') output = await invokeCore(tool.name, input, runtime, profile, extra.signal, ajv);
      else output = await invokePluginTool(tool, input, runtime, extra.signal, ajv);
      if (!validation.output(output)) throw new Error(`tool output failed schema validation: ${tool.name}`);
      return {
        content: [{ type: 'text' as const, text: responseReceipt(output) }],
        structuredContent: output
      };
    } catch (error) {
      const requestId = `mcp_${nanoid(16)}`;
      const instance = `mcp://tool/${request.params.name}`;
      const problem =
        error instanceof MacroError
          ? problemFromMacroError(error, requestId, instance)
          : problemFromCanvasError(toCanvasError(error), requestId, instance);
      return {
        content: [{ type: 'text' as const, text: `${problem.title}: ${problem.detail}` }],
        structuredContent: { problem },
        isError: true
      };
    }
  });
  return { server, tools };
}
