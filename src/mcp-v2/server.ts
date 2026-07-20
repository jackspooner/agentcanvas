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
  createMcpToolCatalog,
  createPluginStatusCatalog,
  createRegistryElementSchemas,
  getPluginStatus,
  JSON_OBJECT_SCHEMA,
  PLUGIN_STATUS_CATALOG_SCHEMA,
  PLUGIN_STATUS_SCHEMA,
  type CoreJsonSchemaTool,
  type McpJsonSchemaTool
} from '../api-v2/index.js';
import type { BrowserPluginCatalog, FrozenPluginRegistry } from '../plugin-runtime/index.js';
import { createPluginCanvasOperations } from '../plugin-runtime/index.js';
import type { V2SqliteCanvasStore } from '../store/v2.js';
import { AGENTCANVAS_VERSION } from '../version.js';

export interface McpV2Runtime {
  registry: FrozenPluginRegistry;
  store: V2SqliteCanvasStore;
  browserCatalog: BrowserPluginCatalog;
  diagnostics(): readonly import('@agentcanvas/plugin-sdk').PluginDiagnostic[];
}

const CANVAS_ID = { type: 'string', minLength: 1 };
const ELEMENT_ID = { type: 'string', minLength: 1 };

const FRAME_SCHEMA: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  minProperties: 1,
  properties: {
    x: { type: 'number' },
    y: { type: 'number' },
    width: { type: ['number', 'null'] },
    height: { type: ['number', 'null'] },
    zIndex: { type: ['number', 'null'] },
    rotation: { type: ['number', 'null'] },
    opacity: { type: ['number', 'null'], minimum: 0, maximum: 1 },
    locked: { type: ['boolean', 'null'] }
  }
};

function canvasSchema(elementSchema: JsonSchema): JsonSchema {
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
      'documentVersion'
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
      documentVersion: { const: 2 }
    }
  };
}

function coreTools(registry: FrozenPluginRegistry): readonly CoreJsonSchemaTool[] {
  const elementCatalog = createRegistryElementSchemas(registry);
  const elementSchema: JsonSchema = { oneOf: Object.values(elementCatalog.schemas) };
  const canvas = canvasSchema(elementSchema);
  const canvasList: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['canvases'],
    properties: { canvases: { type: 'array', items: canvas } }
  };
  return [
    {
      name: 'canvas_create',
      title: 'Create canvas',
      description: 'Create a new AgentCanvas v0.2 canvas.',
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
      outputSchema: canvas
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
      description: 'Get one canvas with its canonical element envelopes.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['canvasId'],
        properties: { canvasId: CANVAS_ID }
      },
      outputSchema: canvas,
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
      canvas
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
      canvas
    ),
    mutationTool(
      'canvas_clear_theme',
      'Clear a canvas theme and restore AgentCanvas defaults',
      {
        canvasId: CANVAS_ID,
        expectedRevision: { type: 'integer', minimum: 1 }
      },
      ['canvasId'],
      canvas
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
      canvas
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
      canvas
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
      canvas
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
      canvas
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
      canvas
    ),
    mutationTool(
      'canvas_clear',
      'Remove all elements from a canvas',
      {
        canvasId: CANVAS_ID,
        expectedRevision: { type: 'integer', minimum: 1 }
      },
      ['canvasId'],
      canvas
    ),
    {
      name: 'canvas_list_plugins',
      title: 'List plugins',
      description: 'List sanitized active plugin status.',
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
    description,
    inputSchema: { type: 'object', additionalProperties: false, required, properties },
    outputSchema,
    annotations: { readOnlyHint: false, idempotentHint: false }
  };
}

function json(value: unknown): JsonObject {
  return JSON.parse(JSON.stringify(value)) as JsonObject;
}

function invokeCore(name: string, input: JsonObject, runtime: McpV2Runtime): JsonObject {
  const store = runtime.store;
  const canvasId = input.canvasId as string;
  const expectedRevision = input.expectedRevision as number | undefined;
  if (name === 'canvas_create') return json(store.createCanvas(input as never));
  if (name === 'canvas_list')
    return { canvases: json(store.listCanvases({ limit: input.limit as number | undefined })) as never };
  if (name === 'canvas_get') return json(store.getCanvas(canvasId));
  if (name === 'canvas_rename') {
    return json(
      store.renameCanvas(canvasId, {
        title: input.title as string,
        expectedRevision
      })
    );
  }
  if (name === 'canvas_set_theme') {
    return json(
      store.updateCanvasTheme(canvasId, { theme: input.theme as unknown as CanvasThemeV1, expectedRevision })
    );
  }
  if (name === 'canvas_clear_theme') {
    return json(store.updateCanvasTheme(canvasId, { theme: null, expectedRevision }));
  }
  if (name === 'canvas_upsert_element') {
    return json(
      store.applyOperations(canvasId, {
        expectedRevision,
        operations: [{ op: 'upsertElement', element: input.element as JsonObject }]
      })
    );
  }
  if (name === 'canvas_patch_element_frame') {
    return json(
      store.applyOperations(canvasId, {
        expectedRevision,
        operations: [
          { op: 'patchElementFrame', elementId: input.elementId as string, frame: input.frame as JsonObject }
        ]
      })
    );
  }
  if (name === 'canvas_replace_element_data') {
    return json(
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
      })
    );
  }
  if (name === 'canvas_replace_element_metadata') {
    return json(
      store.applyOperations(canvasId, {
        expectedRevision,
        operations: [
          { op: 'replaceElementMetadata', elementId: input.elementId as string, metadata: input.metadata as JsonObject }
        ]
      })
    );
  }
  if (name === 'canvas_delete_element') {
    return json(
      store.applyOperations(canvasId, {
        expectedRevision,
        operations: [{ op: 'deleteElement', elementId: input.elementId as string }]
      })
    );
  }
  if (name === 'canvas_clear')
    return json(store.applyOperations(canvasId, { expectedRevision, operations: [{ op: 'clear' }] }));
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

export function createMcpV2Server(runtime: McpV2Runtime): {
  server: Server;
  tools: readonly McpJsonSchemaTool[];
} {
  const tools = createMcpToolCatalog(runtime.registry, coreTools(runtime.registry));
  const ajv = new Ajv2020({ strict: true, allErrors: true, useDefaults: false });
  const validators = new Map<string, { input: ValidateFunction; output: ValidateFunction }>(
    tools.map((tool) => [tool.name, { input: ajv.compile(tool.inputSchema), output: ajv.compile(tool.outputSchema) }])
  );
  const server = new Server(
    { name: 'AgentCanvasMcp', version: AGENTCANVAS_VERSION },
    {
      capabilities: { tools: {} },
      instructions: 'Use canonical core tools and active plugin tools; resources are returned as compact handles.'
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
    if (!tool) throw new Error(`unknown tool: ${request.params.name}`);
    const input = (request.params.arguments ?? {}) as JsonObject;
    const validation = validators.get(tool.name) as { input: ValidateFunction; output: ValidateFunction };
    if (!validation.input(input)) throw new Error(`tool input failed schema validation: ${tool.name}`);
    let output: JsonObject;
    if (tool.source === 'core') output = invokeCore(tool.name, input, runtime);
    else {
      const pluginId = tool.pluginId as string;
      const plugin = runtime.registry.getPlugin(pluginId);
      if (!plugin) throw new Error(`plugin is not active: ${pluginId}`);
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
  });
  return { server, tools };
}
