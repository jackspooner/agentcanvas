import {
  CANVAS_THEME_V1_SCHEMA,
  type CanvasThemeV1,
  type JsonObject,
  type JsonSchema,
  type PluginInvocationContext
} from '@agentcanvas/plugin-sdk';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import Ajv2020, { type ValidateFunction } from 'ajv/dist/2020.js';
import { nanoid } from 'nanoid';
import {
  AGENTCANVAS_PROBLEM_CODES,
  createMcpToolCatalog,
  mcpOutputSchema,
  problemFromCanvasError,
  problemFromMacroError,
  createPluginStatusCatalog,
  createRegistryElementSchemas,
  getPluginStatus,
  JSON_OBJECT_SCHEMA,
  PLUGIN_DIAGNOSTIC_SCHEMA,
  PLUGIN_STATUS_CATALOG_SCHEMA,
  PLUGIN_STATUS_SCHEMA,
  type AgentCanvasProblemCode,
  type CoreJsonSchemaTool,
  type McpJsonSchemaTool
} from '../api-v2/index.js';
import {
  MACRO_ARCHIVE_REQUEST_SCHEMA,
  MACRO_ARCHIVE_RESPONSE_SCHEMA,
  MACRO_CREATE_REQUEST_SCHEMA,
  MACRO_CREATE_RESPONSE_SCHEMA,
  MACRO_CREATE_VERSION_REQUEST_SCHEMA,
  MACRO_CREATE_VERSION_RESPONSE_SCHEMA,
  MACRO_GET_REQUEST_SCHEMA,
  MACRO_GET_RESPONSE_SCHEMA,
  MACRO_LIST_REQUEST_SCHEMA,
  MACRO_LIST_RESPONSE_SCHEMA,
  MACRO_PLAN_REQUEST_SCHEMA,
  MACRO_PLAN_RESPONSE_SCHEMA,
  CANVAS_RUN_MACRO_REQUEST_SCHEMA,
  CANVAS_RUN_MACRO_RESPONSE_SCHEMA
} from '../macros/index.js';
import type { MacroRuntime } from '../macros/runtime.js';
import { MacroError } from '../macros/errors.js';
import type { BrowserPluginCatalog, FrozenPluginRegistry, InspectableCanvas } from '../plugin-runtime/index.js';
import { createPluginCanvasOperations, inspectCanvas } from '../plugin-runtime/index.js';
import type { V2SqliteCanvasStore } from '../store/v2.js';
import { AGENTCANVAS_VERSION } from '../version.js';
import { canvasPageUrl } from '../canvas-url.js';
import { AGENTCANVAS_AGENT_GUIDANCE, AGENTCANVAS_MCP_INSTRUCTIONS } from './agent-guidance.js';
import { CanvasError, toCanvasError } from '../errors.js';

export interface McpV2Runtime {
  publicBaseUrl: string;
  registry: FrozenPluginRegistry;
  store: V2SqliteCanvasStore;
  browserCatalog: BrowserPluginCatalog;
  diagnostics(): readonly import('@agentcanvas/plugin-sdk').PluginDiagnostic[];
  macros?: MacroRuntime;
}

const CANVAS_ID = { type: 'string', minLength: 1 };
const ELEMENT_ID = { type: 'string', minLength: 1 };
const CANVAS_URL_SCHEMA: JsonSchema = {
  type: 'string',
  minLength: 1,
  description: 'Direct browser URL for this canvas, based on AGENT_CANVAS_PUBLIC_BASE_URL.'
};

const INSPECTION_SUMMARY_SCHEMA: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['errorCount', 'warningCount', 'infoCount'],
  properties: {
    errorCount: { type: 'integer', minimum: 0 },
    warningCount: { type: 'integer', minimum: 0 },
    infoCount: { type: 'integer', minimum: 0 }
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
      bounds: {
        oneOf: [
          {
            type: 'object',
            additionalProperties: false,
            required: ['mode'],
            properties: { mode: { const: 'unlimited' } }
          },
          {
            type: 'object',
            additionalProperties: false,
            required: ['mode', 'width', 'height'],
            properties: {
              mode: { const: 'fixed' },
              width: { type: 'number', exclusiveMinimum: 0 },
              height: { type: 'number', exclusiveMinimum: 0 }
            }
          }
        ]
      },
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

function coreTools(registry: FrozenPluginRegistry): readonly CoreJsonSchemaTool[] {
  const elementCatalog = createRegistryElementSchemas(registry);
  const elementSchema: JsonSchema = { oneOf: Object.values(elementCatalog.schemas) };
  const canvas = canvasSchema(elementSchema);
  const inspectedCanvas = canvasSchema(elementSchema, true);
  const createdCanvas = canvasSchema(elementSchema, true, true);
  const canvasList: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['canvases'],
    properties: { canvases: { type: 'array', items: canvas } }
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
        'Create an empty AgentCanvas v0.2 canvas and return its direct browser URL. This does not create elements or prove a finished layout is readable.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['title'],
        properties: {
          title: { type: 'string', minLength: 1 },
          project: { type: 'string' },
          description: { type: 'string' },
          theme: { oneOf: [CANVAS_THEME_V1_SCHEMA, { type: 'null' }] }
        }
      },
      outputSchema: createdCanvas
    },
    {
      name: 'canvas_list',
      title: 'List canvases',
      description: 'List recent canvases.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: { limit: { type: 'integer', minimum: 1, maximum: 200 } }
      },
      outputSchema: canvasList,
      annotations: { readOnlyHint: true }
    },
    {
      name: 'canvas_get',
      title: 'Get canvas',
      description:
        'Get the persisted source of truth for one canvas. Use it after edits to verify element IDs, frames, data, revision, and diagnostics; persisted state alone does not prove rendered readability or remote-image loading.',
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
        properties: { canvasId: CANVAS_ID }
      },
      outputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['canvasId', 'revision', 'diagnostics', 'summary'],
        properties: {
          canvasId: CANVAS_ID,
          revision: { type: 'integer', minimum: 1 },
          diagnostics: { type: 'array', items: PLUGIN_DIAGNOSTIC_SCHEMA },
          summary: INSPECTION_SUMMARY_SCHEMA
        }
      },
      annotations: { readOnlyHint: true }
    },
    mutationTool(
      'canvas_rename',
      'Rename a canvas',
      {
        canvasId: CANVAS_ID,
        title: { type: 'string', minLength: 1 },
        expectedRevision: { type: 'integer', minimum: 1 }
      },
      ['canvasId', 'title'],
      inspectedCanvas
    ),
    mutationTool(
      'canvas_set_theme',
      'Set a complete semantic theme on a canvas',
      {
        canvasId: CANVAS_ID,
        theme: CANVAS_THEME_V1_SCHEMA as JsonObject,
        expectedRevision: { type: 'integer', minimum: 1 }
      },
      ['canvasId', 'theme'],
      inspectedCanvas
    ),
    mutationTool(
      'canvas_clear_theme',
      'Clear a canvas theme and restore AgentCanvas defaults',
      {
        canvasId: CANVAS_ID,
        expectedRevision: { type: 'integer', minimum: 1 }
      },
      ['canvasId'],
      inspectedCanvas
    ),
    mutationTool(
      'canvas_upsert_element',
      'Upsert a complete current-version element',
      {
        canvasId: CANVAS_ID,
        element: elementSchema as JsonObject,
        expectedRevision: { type: 'integer', minimum: 1 }
      },
      ['canvasId', 'element'],
      inspectedCanvas
    ),
    mutationTool(
      'canvas_patch_element_frame',
      'Patch only kernel-owned frame fields',
      {
        canvasId: CANVAS_ID,
        elementId: ELEMENT_ID,
        frame: FRAME_SCHEMA as JsonObject,
        expectedRevision: { type: 'integer', minimum: 1 }
      },
      ['canvasId', 'elementId', 'frame'],
      inspectedCanvas
    ),
    mutationTool(
      'canvas_replace_element_data',
      'Replace plugin-owned element data and optional style atomically',
      {
        canvasId: CANVAS_ID,
        elementId: ELEMENT_ID,
        data: JSON_OBJECT_SCHEMA as JsonObject,
        style: { oneOf: [JSON_OBJECT_SCHEMA, { type: 'null' }] },
        expectedRevision: { type: 'integer', minimum: 1 }
      },
      ['canvasId', 'elementId', 'data'],
      inspectedCanvas
    ),
    mutationTool(
      'canvas_replace_element_metadata',
      'Replace generic element metadata atomically',
      {
        canvasId: CANVAS_ID,
        elementId: ELEMENT_ID,
        metadata: JSON_OBJECT_SCHEMA as JsonObject,
        expectedRevision: { type: 'integer', minimum: 1 }
      },
      ['canvasId', 'elementId', 'metadata'],
      inspectedCanvas
    ),
    mutationTool(
      'canvas_delete_element',
      'Delete an element',
      {
        canvasId: CANVAS_ID,
        elementId: ELEMENT_ID,
        expectedRevision: { type: 'integer', minimum: 1 }
      },
      ['canvasId', 'elementId'],
      inspectedCanvas
    ),
    mutationTool(
      'canvas_clear',
      'Remove all elements from a canvas',
      {
        canvasId: CANVAS_ID,
        expectedRevision: { type: 'integer', minimum: 1 }
      },
      ['canvasId'],
      inspectedCanvas
    ),
    {
      name: 'canvas_list_plugins',
      title: 'List plugins',
      description:
        'List sanitized active plugin status. Treat this runtime result as authoritative for which element types and plugin tools are currently available.',
      inputSchema: { type: 'object', additionalProperties: false, properties: {} },
      outputSchema: PLUGIN_STATUS_CATALOG_SCHEMA,
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
      outputSchema: MACRO_CREATE_RESPONSE_SCHEMA,
      annotations: { readOnlyHint: false, idempotentHint: false }
    },
    {
      name: 'macro_create_version',
      title: 'Create macro version',
      description: 'Create the next immutable version without changing scope or canvas identity.',
      inputSchema: MACRO_CREATE_VERSION_REQUEST_SCHEMA,
      outputSchema: MACRO_CREATE_VERSION_RESPONSE_SCHEMA,
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
      description: 'Purely expand and validate an exact macro version for a canvas.',
      inputSchema: MACRO_PLAN_REQUEST_SCHEMA,
      outputSchema: MACRO_PLAN_RESPONSE_SCHEMA,
      annotations: { readOnlyHint: true }
    },
    {
      name: 'canvas_run_macro',
      title: 'Run macro',
      description: 'Execute an existing plan or directly plan and execute one exact macro version.',
      inputSchema: CANVAS_RUN_MACRO_REQUEST_SCHEMA,
      outputSchema: CANVAS_RUN_MACRO_RESPONSE_SCHEMA,
      annotations: { readOnlyHint: false, idempotentHint: false }
    }
  ];
}

function mutationTool(
  name: string,
  description: string,
  properties: Record<string, JsonObject>,
  required: string[],
  outputSchema: JsonSchema
): CoreJsonSchemaTool {
  return {
    name,
    title: description,
    description: `${description}. The returned canvas includes post-mutation diagnostics and severity counts; repair unintended warnings before continuing.`,
    inputSchema: { type: 'object', additionalProperties: false, required, properties },
    outputSchema,
    annotations: { readOnlyHint: false, idempotentHint: false }
  };
}

function json(value: unknown): JsonObject {
  return JSON.parse(JSON.stringify(value)) as JsonObject;
}

function withInspection(canvas: InspectableCanvas, registry: FrozenPluginRegistry): JsonObject {
  const inspection = inspectCanvas(canvas, registry);
  return json({
    ...canvas,
    diagnostics: inspection.diagnostics,
    inspectionSummary: inspection.summary
  });
}

function withInspectionAndUrl(canvas: InspectableCanvas, runtime: McpV2Runtime): JsonObject {
  return { ...withInspection(canvas, runtime.registry), url: canvasPageUrl(runtime.publicBaseUrl, canvas.id) };
}

async function invokeCore(name: string, input: JsonObject, runtime: McpV2Runtime): Promise<JsonObject> {
  const store = runtime.store;
  const canvasId = input.canvasId as string;
  const expectedRevision = input.expectedRevision as number | undefined;
  if (name === 'canvas_get_guidance') {
    const coreToolCount = coreTools(runtime.registry).length + macroTools().length;
    const pluginToolCount = runtime.registry.plugins.reduce((count, plugin) => count + plugin.tools.length, 0);
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
    return runtime.macros.create(input as never) as unknown as JsonObject;
  }
  if (name === 'macro_create_version') {
    if (!runtime.macros) throw new Error('macro runtime is unavailable');
    return runtime.macros.createVersion(input as never) as unknown as JsonObject;
  }
  if (name === 'macro_archive') {
    if (!runtime.macros) throw new Error('macro runtime is unavailable');
    return runtime.macros.archive(input.macroId as string, input.archived as boolean) as unknown as JsonObject;
  }
  if (name === 'macro_plan') {
    if (!runtime.macros) throw new Error('macro runtime is unavailable');
    return runtime.macros.plan(input as never) as unknown as JsonObject;
  }
  if (name === 'canvas_run_macro') {
    if (!runtime.macros) throw new Error('macro runtime is unavailable');
    if (input.mode === 'plan') return (await runtime.macros.execute(input as never)) as unknown as JsonObject;
    return (await runtime.macros.direct(input as never)) as unknown as JsonObject;
  }
  if (name === 'canvas_create') return withInspectionAndUrl(store.createCanvas(input as never), runtime);
  if (name === 'canvas_list')
    return { canvases: json(store.listCanvases({ limit: input.limit as number | undefined })) as never };
  if (name === 'canvas_get') return withInspection(store.getCanvas(canvasId), runtime.registry);
  if (name === 'canvas_get_url') {
    const canvas = store.getCanvas(canvasId);
    return { canvasId: canvas.id, url: canvasPageUrl(runtime.publicBaseUrl, canvas.id) };
  }
  if (name === 'canvas_inspect') {
    const canvas = store.getCanvas(canvasId);
    const inspection = inspectCanvas(canvas, runtime.registry);
    return json({
      canvasId,
      revision: canvas.revision,
      diagnostics: inspection.diagnostics,
      summary: inspection.summary
    });
  }
  if (name === 'canvas_rename') {
    return withInspection(
      store.renameCanvas(canvasId, {
        title: input.title as string,
        expectedRevision
      }),
      runtime.registry
    );
  }
  if (name === 'canvas_set_theme') {
    return withInspection(
      store.updateCanvasTheme(canvasId, { theme: input.theme as unknown as CanvasThemeV1, expectedRevision }),
      runtime.registry
    );
  }
  if (name === 'canvas_clear_theme') {
    return withInspection(store.updateCanvasTheme(canvasId, { theme: null, expectedRevision }), runtime.registry);
  }
  if (name === 'canvas_upsert_element') {
    return withInspection(
      store.applyOperations(canvasId, {
        expectedRevision,
        operations: [{ op: 'upsertElement', element: input.element as JsonObject }]
      }),
      runtime.registry
    );
  }
  if (name === 'canvas_patch_element_frame') {
    return withInspection(
      store.applyOperations(canvasId, {
        expectedRevision,
        operations: [
          { op: 'patchElementFrame', elementId: input.elementId as string, frame: input.frame as JsonObject }
        ]
      }),
      runtime.registry
    );
  }
  if (name === 'canvas_replace_element_data') {
    return withInspection(
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
      runtime.registry
    );
  }
  if (name === 'canvas_replace_element_metadata') {
    return withInspection(
      store.applyOperations(canvasId, {
        expectedRevision,
        operations: [
          { op: 'replaceElementMetadata', elementId: input.elementId as string, metadata: input.metadata as JsonObject }
        ]
      }),
      runtime.registry
    );
  }
  if (name === 'canvas_delete_element') {
    return withInspection(
      store.applyOperations(canvasId, {
        expectedRevision,
        operations: [{ op: 'deleteElement', elementId: input.elementId as string }]
      }),
      runtime.registry
    );
  }
  if (name === 'canvas_clear')
    return withInspection(
      store.applyOperations(canvasId, { expectedRevision, operations: [{ op: 'clear' }] }),
      runtime.registry
    );
  const status = createPluginStatusCatalog(runtime.registry, {
    browserEntries: runtime.browserCatalog.entries,
    diagnostics: runtime.diagnostics()
  });
  if (name === 'canvas_list_plugins') return status as unknown as JsonObject;
  if (name === 'canvas_get_plugin') {
    const plugin = getPluginStatus(status, input.pluginId as string);
    if (!plugin) throw new Error(`plugin is not active: ${String(input.pluginId)}`);
    return plugin as unknown as JsonObject;
  }
  throw new Error(`unknown core MCP tool: ${name}`);
}

function schemaObject(schema: JsonSchema): Record<string, unknown> {
  if (typeof schema === 'boolean') throw new Error('MCP tool schemas must be JSON Schema objects');
  return schema;
}

/** Creates the canonical tool catalog shared by MCP runtime exposure and generated contract artifacts. */
export function createMcpV2ToolCatalog(registry: FrozenPluginRegistry): readonly McpJsonSchemaTool[] {
  return createMcpToolCatalog(registry, [...coreTools(registry), ...macroTools()]).map((tool) =>
    Object.freeze({ ...tool, outputSchema: mcpOutputSchema(tool.outputSchema) })
  );
}

/** Declares the application failures a caller should handle for one normalized tool contract. */
export function mcpErrorCodesForTool(tool: McpJsonSchemaTool): readonly AgentCanvasProblemCode[] {
  const codes = new Set<AgentCanvasProblemCode>(['validation_error', 'internal_error']);
  if (tool.source === 'plugin') {
    codes.add('plugin_unavailable');
    codes.add('plugin_permission_denied');
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

export function createMcpV2Server(runtime: McpV2Runtime): {
  server: Server;
  tools: readonly McpJsonSchemaTool[];
} {
  const tools = createMcpV2ToolCatalog(runtime.registry);
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
      if (tool.source === 'core') output = await invokeCore(tool.name, input, runtime);
      else {
        const pluginId = tool.pluginId as string;
        const plugin = runtime.registry.getPlugin(pluginId);
        if (!plugin) throw new CanvasError('plugin_unavailable', `plugin is not active: ${pluginId}`, 'not_found', 404);
        const context: PluginInvocationContext = {
          signal: extra.signal,
          correlationId: `mcp_${nanoid(16)}`,
          canvas: createPluginCanvasOperations(runtime.store, pluginId, plugin.plugin.manifest.permissions)
        };
        output = await (tool.descriptor as NonNullable<McpJsonSchemaTool['descriptor']>).invoke(input, context);
      }
      if (!validation.output(output)) throw new Error(`tool output failed schema validation: ${tool.name}`);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(output, null, 2) }],
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
