import { CANVAS_THEME_V1_SCHEMA, type JsonObject, type JsonSchema } from '@agentcanvas/plugin-sdk';
import { CANVAS_LIST_LIMITS } from '../contracts.js';
import { DIAGNOSTICS_CONFIGURATION_SCHEMA } from '../configuration.js';

export const CANVAS_LIST_LIMIT_SCHEMA: JsonObject = { type: 'integer', ...CANVAS_LIST_LIMITS };

export const CANVAS_DELETE_RECEIPT_SCHEMA: JsonObject = {
  type: 'object',
  additionalProperties: false,
  required: ['canvasId', 'deleted'],
  properties: { canvasId: { type: 'string', minLength: 1 }, deleted: { const: true } }
};

export const EXPECTED_REVISION_SCHEMA: JsonObject = { type: 'integer', minimum: 1, maximum: Number.MAX_SAFE_INTEGER };

const nullableNumber: JsonObject = { type: ['number', 'null'] };
const nullableBoolean: JsonObject = { type: ['boolean', 'null'] };

export const JSON_VALUE_SCHEMA: JsonSchema = {
  $id: 'https://agentcanvas.local/schemas/json-value.json',
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $ref: '#/$defs/value',
  $defs: {
    value: {
      oneOf: [
        { type: 'null' },
        { type: 'boolean' },
        { type: 'string' },
        { type: 'number' },
        { type: 'array', items: { $ref: '#/$defs/value' } },
        { type: 'object', additionalProperties: { $ref: '#/$defs/value' } }
      ]
    }
  }
};

export const JSON_OBJECT_SCHEMA: JsonSchema = {
  type: 'object',
  additionalProperties: true
};

export const CANVAS_ELEMENT_SCHEMA: JsonSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'object',
  additionalProperties: false,
  required: ['id', 'type', 'schemaVersion', 'x', 'y', 'data'],
  properties: {
    id: { type: 'string', minLength: 1 },
    type: {
      type: 'string',
      pattern: '^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*/[a-z][a-z0-9-]*$'
    },
    schemaVersion: { type: 'integer', minimum: 1 },
    x: { type: 'number', description: 'Left edge in canvas world coordinates.' },
    y: { type: 'number', description: 'Top edge in canvas world coordinates.' },
    width: {
      type: ['number', 'null'],
      description: 'Visible frame width. Explicit sizing prevents overlap and clipped content.'
    },
    height: {
      type: ['number', 'null'],
      description: 'Visible frame height. Explicit sizing prevents overlap and clipped content.'
    },
    zIndex: nullableNumber,
    rotation: nullableNumber,
    opacity: nullableNumber,
    locked: nullableBoolean,
    style: { oneOf: [JSON_OBJECT_SCHEMA, { type: 'null' }] },
    metadata: JSON_OBJECT_SCHEMA,
    data: JSON_OBJECT_SCHEMA
  }
};

export const PLUGIN_DIAGNOSTIC_SCHEMA: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['code', 'severity', 'message', 'retryable'],
  properties: {
    code: { type: 'string', minLength: 1 },
    severity: { type: 'string', enum: ['info', 'warning', 'error'] },
    message: { type: 'string' },
    retryable: { type: 'boolean' },
    pluginId: { type: 'string' },
    elementId: { type: 'string' }
  }
};

export const RESOURCE_HANDLE_SCHEMA: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['handle', 'url', 'mimeType'],
  properties: {
    handle: { type: 'string', minLength: 1 },
    url: { type: 'string', pattern: '^/api/v1/resources/[^/]+/content$' },
    mimeType: { type: 'string', minLength: 1 },
    byteLength: { type: 'integer', minimum: 0 },
    width: { type: 'integer', minimum: 1 },
    height: { type: 'integer', minimum: 1 },
    sha256: { type: 'string', pattern: '^[a-f0-9]{64}$' }
  }
};

export const RESOURCE_DETAILS_SCHEMA: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['handle', 'url', 'mimeType', 'createdAt'],
  properties: {
    handle: { type: 'string', minLength: 1 },
    url: { type: 'string', pattern: '^/api/v1/resources/[^/]+/content$' },
    mimeType: { type: 'string', minLength: 1 },
    byteLength: { type: 'integer', minimum: 0 },
    width: { type: 'integer', minimum: 1 },
    height: { type: 'integer', minimum: 1 },
    sha256: { type: 'string', pattern: '^[a-f0-9]{64}$' },
    createdAt: { type: 'string', format: 'date-time' },
    expiresAt: { type: 'string', format: 'date-time' }
  }
};

export const CANVAS_BOUNDS_SCHEMA: JsonSchema = {
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
};

export const CANVAS_RECORD_SCHEMA: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'title', 'createdBy', 'createdAt', 'updatedAt', 'bounds', 'elements', 'revision', 'documentVersion'],
  properties: {
    id: { type: 'string', minLength: 1 },
    title: { type: 'string' },
    description: { type: ['string', 'null'] },
    project: { type: ['string', 'null'] },
    conversationId: { type: ['string', 'null'] },
    createdBy: { type: 'string', enum: ['agent', 'user', 'system'] },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
    bounds: { $ref: '#/components/schemas/CanvasBounds' },
    width: { type: 'number' },
    height: { type: 'number' },
    background: { oneOf: [JSON_OBJECT_SCHEMA, { type: 'null' }] },
    theme: { oneOf: [CANVAS_THEME_V1_SCHEMA, { type: 'null' }] },
    elements: { type: 'array', items: { $ref: '#/components/schemas/CanvasElement' } },
    revision: { type: 'integer', minimum: 1 },
    metadata: JSON_OBJECT_SCHEMA,
    documentVersion: { const: 2 }
  }
};

export const CONFIGURATION_RESPONSE_SCHEMA: JsonObject = {
  type: 'object',
  additionalProperties: false,
  required: ['ok', 'configuration'],
  properties: {
    ok: { const: true },
    configuration: {
      type: 'object',
      additionalProperties: false,
      required: ['defaultCanvasSize', 'diagnostics', 'source', 'updatedAt'],
      properties: {
        defaultCanvasSize: CANVAS_BOUNDS_SCHEMA,
        diagnostics: DIAGNOSTICS_CONFIGURATION_SCHEMA,
        source: { type: 'string', enum: ['runtime-default', 'stored'] },
        updatedAt: { type: ['string', 'null'], format: 'date-time' }
      }
    }
  }
};

export const VIEWPORT_SCHEMA: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['source', 'centerX', 'centerY', 'zoom', 'width', 'height', 'updatedAt'],
  properties: {
    source: { type: 'string', enum: ['default', 'user', 'agent'] },
    centerX: { type: 'number' },
    centerY: { type: 'number' },
    zoom: { type: 'number', exclusiveMinimum: 0 },
    width: { type: 'integer', minimum: 1 },
    height: { type: 'integer', minimum: 1 },
    updatedAt: { type: ['string', 'null'], format: 'date-time' }
  }
};

export const SHARE_LINK_SCHEMA: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'canvasId', 'mode', 'createdAt'],
  properties: {
    id: { type: 'string' },
    canvasId: { type: 'string' },
    mode: { const: 'read' },
    label: { type: ['string', 'null'] },
    expiresAt: { type: ['string', 'null'] },
    createdAt: { type: 'string', format: 'date-time' },
    revokedAt: { type: ['string', 'null'] },
    url: { type: 'string' }
  }
};

export function schemaRecord(schema: JsonSchema): JsonObject {
  if (typeof schema === 'boolean') return schema ? {} : { not: {} };
  return schema;
}

const CANVAS_VIEWPORT_INPUT_SCHEMA = {
  type: 'object',
  required: ['centerX', 'centerY', 'zoom', 'width', 'height'],
  properties: {
    centerX: { type: 'number' },
    centerY: { type: 'number' },
    zoom: { type: 'number', exclusiveMinimum: 0 },
    width: { type: 'integer', minimum: 1 },
    height: { type: 'integer', minimum: 1 }
  }
} as JsonObject & { properties: Record<string, JsonObject> };

export const VIEWER_ID_PATTERN = '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
export const VIEWER_ID_SCHEMA: JsonObject = { type: 'string', pattern: VIEWER_ID_PATTERN };

/** Shared request definitions for HTTP validation, OpenAPI, and corresponding MCP fields. */
export const CORE_REQUEST_SCHEMAS: Record<
  | 'configuration'
  | 'create'
  | 'bounds'
  | 'title'
  | 'theme'
  | 'batch'
  | 'share'
  | 'viewport'
  | 'focus'
  | 'viewerPresence',
  JsonObject & { properties: Record<string, JsonObject> }
> = {
  configuration: {
    type: 'object',
    additionalProperties: false,
    anyOf: [
      { required: ['defaultCanvasSize'], properties: { defaultCanvasSize: true } },
      { required: ['diagnostics'], properties: { diagnostics: true } }
    ],
    properties: {
      defaultCanvasSize: { $ref: '#/components/schemas/CanvasBounds' },
      diagnostics: DIAGNOSTICS_CONFIGURATION_SCHEMA,
      actor: { type: 'string' }
    }
  },
  create: {
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
  },
  bounds: {
    type: 'object',
    additionalProperties: false,
    required: ['bounds'],
    properties: {
      bounds: { $ref: '#/components/schemas/CanvasBounds' },
      expectedRevision: { type: 'integer', minimum: 1 },
      actor: { type: 'string' }
    }
  },
  title: {
    type: 'object',
    additionalProperties: false,
    required: ['title'],
    properties: {
      title: { type: 'string', minLength: 1 },
      expectedRevision: { type: 'integer', minimum: 1 },
      actor: { type: 'string' }
    }
  },
  theme: {
    type: 'object',
    additionalProperties: false,
    required: ['theme'],
    properties: {
      theme: { oneOf: [{ $ref: '#/components/schemas/CanvasThemeV1' }, { type: 'null' }] },
      expectedRevision: { type: 'integer', minimum: 1 },
      actor: { type: 'string' }
    }
  },
  batch: {
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
  },
  share: {
    type: 'object',
    additionalProperties: false,
    properties: { label: { type: 'string' }, expiresAt: { type: ['string', 'null'] } }
  },
  viewport: CANVAS_VIEWPORT_INPUT_SCHEMA,
  focus: CANVAS_VIEWPORT_INPUT_SCHEMA,
  viewerPresence: { ...CANVAS_VIEWPORT_INPUT_SCHEMA, additionalProperties: false }
};
