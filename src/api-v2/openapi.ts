import type { JsonObject, JsonSchema } from '@agentcanvas/plugin-sdk';
import type { FrozenPluginRegistry } from '../plugin-runtime/index.js';
import { getMacroOpenApiComponentSchemas } from '../macros/schema-catalog.js';
import { PLUGIN_STATUS_CATALOG_SCHEMA, PLUGIN_STATUS_SCHEMA } from './plugin-status.js';
import { createProcedureCatalog, type RegistryProcedureCatalog } from './procedures.js';
import {
  PROBLEM_DETAILS_OPENAPI_SCHEMA,
  PROBLEM_ISSUE_OPENAPI_SCHEMA,
  problemResponse,
  type AgentCanvasProblemCode
} from './problem-contract.js';
import {
  CANVAS_ELEMENT_SCHEMA,
  JSON_OBJECT_SCHEMA,
  PLUGIN_DIAGNOSTIC_SCHEMA,
  RESOURCE_DETAILS_SCHEMA,
  RESOURCE_HANDLE_SCHEMA
} from './schemas.js';

export interface RegistryOpenApiOptions {
  title?: string;
  version: string;
  description?: string;
  serverUrls?: readonly string[];
  corePaths?: Readonly<Record<string, JsonObject>>;
  additionalSchemas?: Readonly<Record<string, JsonSchema>>;
  procedureCatalog?: RegistryProcedureCatalog;
}

export interface RegistryElementSchemaCatalog {
  schemas: Readonly<Record<string, JsonSchema>>;
  writableElementSchema: JsonSchema;
  componentForType: Readonly<Record<string, string>>;
}

function componentName(type: string): string {
  return `Element_${type.replace(/[^A-Za-z0-9_]/g, '_')}`;
}

function response(description: string, schema: JsonSchema, mediaType = 'application/json'): JsonObject {
  return { description, content: { [mediaType]: { schema } } };
}

function errorResponse(description: string, codes: readonly AgentCanvasProblemCode[]): JsonObject {
  return problemResponse(description, codes);
}

function addPath(paths: Record<string, JsonObject>, route: string, method: string, operation: JsonObject): void {
  const current = paths[route] ?? {};
  if (current[method] !== undefined) throw new Error(`OpenAPI operation collision: ${method.toUpperCase()} ${route}`);
  paths[route] = { ...current, [method]: operation };
}

/** Composes writable element schemas from the exact descriptor schemas used by runtime validation. */
export function createRegistryElementSchemas(registry: FrozenPluginRegistry): RegistryElementSchemaCatalog {
  const schemas: Record<string, JsonSchema> = {};
  const componentForType: Record<string, string> = {};
  const references: JsonSchema[] = [];
  for (const activated of registry.plugins) {
    for (const descriptor of activated.elements) {
      const type = `${activated.plugin.manifest.id}/${descriptor.name}`;
      const component = componentName(type);
      if (schemas[component]) throw new Error(`OpenAPI element component collision: ${component}`);
      componentForType[type] = component;
      schemas[component] = {
        allOf: [
          CANVAS_ELEMENT_SCHEMA,
          {
            type: 'object',
            properties: {
              type: { const: type },
              schemaVersion: { const: descriptor.schemaVersion },
              data: descriptor.dataSchema,
              style: descriptor.styleSchema ? { oneOf: [descriptor.styleSchema, { type: 'null' }] } : { type: 'null' }
            }
          }
        ]
      };
      references.push({ $ref: `#/components/schemas/${component}` });
    }
  }
  return Object.freeze({
    schemas: Object.freeze(schemas),
    writableElementSchema: references.length > 0 ? { oneOf: references } : false,
    componentForType: Object.freeze(componentForType)
  });
}

/** Creates the v0.2 OpenAPI document from kernel paths and one frozen plugin registry. */
export function createRegistryOpenApiDocument(
  registry: FrozenPluginRegistry,
  options: RegistryOpenApiOptions
): JsonObject {
  const elementCatalog = createRegistryElementSchemas(registry);
  const procedureCatalog = options.procedureCatalog ?? createProcedureCatalog(registry);
  const paths: Record<string, JsonObject> = structuredClone(options.corePaths ?? {});

  addPath(paths, '/api/v1/plugins', 'get', {
    operationId: 'canvasListPlugins',
    summary: 'List active AgentCanvas plugins',
    tags: ['Plugins'],
    responses: {
      200: response('Sanitized active plugin catalog', { $ref: '#/components/schemas/PluginStatusCatalog' })
    },
    'x-agent-notes': {
      useWhen: ['Discover installed element types, tools, procedures, browser modules, and safe capability state.'],
      sideEffects: [],
      consistency: { refresh: [] }
    }
  });
  addPath(paths, '/api/v1/plugins/{pluginId}', 'get', {
    operationId: 'canvasGetPlugin',
    summary: 'Get one active plugin',
    tags: ['Plugins'],
    parameters: [{ name: 'pluginId', in: 'path', required: true, schema: { type: 'string' } }],
    responses: {
      200: response('Sanitized plugin status', { $ref: '#/components/schemas/PluginStatus' }),
      404: errorResponse('Plugin is not active', ['plugin_unavailable'])
    },
    'x-agent-notes': {
      useWhen: ['Inspect one active plugin after discovery.'],
      sideEffects: [],
      consistency: { refresh: [] }
    }
  });
  addPath(paths, '/api/v1/resources/{handle}/details', 'get', {
    operationId: 'canvasGetResourceDetails',
    summary: 'Get safe metadata for an opaque resource handle',
    tags: ['Resources'],
    parameters: [{ name: 'handle', in: 'path', required: true, schema: { type: 'string' } }],
    responses: {
      200: response('Resource metadata', { $ref: '#/components/schemas/ResourceDetails' }),
      404: errorResponse('Resource handle was not found', ['resource_not_found'])
    },
    'x-agent-notes': {
      useWhen: ['Inspect MIME type, size, dimensions, or checksum without retrieving binary content.'],
      sideEffects: [],
      consistency: { refresh: [] }
    }
  });
  addPath(paths, '/api/v1/resources/{handle}/content', 'get', {
    operationId: 'canvasGetResourceContent',
    summary: 'Resolve bounded content for an opaque resource handle',
    description:
      'Returns the current bounded bytes for the handle. Provider-backed resources may refresh size, checksum, and dimensions when their stable source identity has mutable content; MIME type and delivery limits remain enforced.',
    tags: ['Resources'],
    parameters: [{ name: 'handle', in: 'path', required: true, schema: { type: 'string' } }],
    responses: {
      200: response('Bounded resource bytes', { type: 'string', format: 'binary' }, 'application/octet-stream'),
      404: errorResponse('Resource handle was not found', ['resource_not_found']),
      413: errorResponse('Resource exceeds the delivery limit', ['resource_too_large'])
    },
    'x-agent-notes': {
      useWhen: ['A consumer explicitly needs bytes after inspecting resource details.'],
      doNotUseWhen: ['Agent-readable metadata or a compact resource URL is sufficient.'],
      sideEffects: [],
      consistency: { refresh: ['Resource metadata is refreshed after mutable provider content is loaded.'] }
    }
  });

  for (const procedure of procedureCatalog.procedures) {
    addPath(paths, procedure.path, 'post', {
      operationId: procedure.operationId,
      summary: procedure.descriptor.description,
      tags: ['Plugin procedures'],
      requestBody: {
        required: true,
        content: { 'application/json': { schema: procedure.descriptor.inputSchema } }
      },
      responses: {
        200: response('Validated plugin procedure result', procedure.descriptor.outputSchema),
        400: errorResponse('Procedure input failed validation', ['validation_error']),
        404: errorResponse('Plugin or procedure is unavailable', ['plugin_unavailable', 'procedure_not_found']),
        500: errorResponse('Procedure execution failed', ['internal_error']),
        504: errorResponse('Procedure timed out', ['procedure_timeout'])
      },
      'x-agent-notes': {
        useWhen: [`Invoke the ${procedure.pluginId}/${procedure.name} plugin workflow.`],
        sideEffects: ['Runs trusted plugin code and may mutate canvases according to the plugin permissions.'],
        consistency: { refresh: ['Affected canvas and plugin diagnostics after successful mutation.'] }
      }
    });
  }

  const components: Record<string, JsonSchema> = {
    JsonObject: JSON_OBJECT_SCHEMA,
    CanvasElement: CANVAS_ELEMENT_SCHEMA,
    WritableCanvasElement: elementCatalog.writableElementSchema,
    PluginDiagnostic: PLUGIN_DIAGNOSTIC_SCHEMA,
    PluginStatus: PLUGIN_STATUS_SCHEMA,
    PluginStatusCatalog: PLUGIN_STATUS_CATALOG_SCHEMA,
    ResourceHandle: RESOURCE_HANDLE_SCHEMA,
    ResourceDetails: RESOURCE_DETAILS_SCHEMA,
    ProblemIssue: PROBLEM_ISSUE_OPENAPI_SCHEMA,
    ProblemDetails: PROBLEM_DETAILS_OPENAPI_SCHEMA,
    ...getMacroOpenApiComponentSchemas(),
    ...elementCatalog.schemas
  };
  for (const [name, schema] of Object.entries(options.additionalSchemas ?? {})) {
    if (components[name]) throw new Error(`OpenAPI schema component collision: ${name}`);
    components[name] = schema;
  }

  return {
    openapi: '3.1.0',
    info: {
      title: options.title ?? 'AgentCanvas API',
      version: options.version,
      ...(options.description ? { description: options.description } : {})
    },
    ...(options.serverUrls?.length ? { servers: options.serverUrls.map((url) => ({ url })) } : {}),
    tags: [
      { name: 'Plugins' },
      { name: 'Plugin procedures' },
      { name: 'Resources' },
      { name: 'Macros' },
      { name: 'Canvases' },
      { name: 'Service' },
      { name: 'Configuration' }
    ],
    paths,
    components: { schemas: components }
  };
}
