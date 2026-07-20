import { CANVAS_THEME_V1_SCHEMA, type JsonObject, type JsonSchema } from '@agentcanvas/plugin-sdk';

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
    x: { type: 'number' },
    y: { type: 'number' },
    width: nullableNumber,
    height: nullableNumber,
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

export const API_ERROR_SCHEMA: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['ok', 'code', 'message', 'stage', 'retryable', 'correlationId'],
  properties: {
    ok: { const: false },
    code: { type: 'string' },
    message: { type: 'string' },
    stage: { type: 'string' },
    retryable: { type: 'boolean' },
    correlationId: { type: 'string' }
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

export const VIEWPORT_SCHEMA: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['source', 'centerX', 'centerY', 'zoom', 'width', 'height', 'updatedAt'],
  properties: {
    source: { type: 'string', enum: ['user', 'agent'] },
    centerX: { type: 'number' },
    centerY: { type: 'number' },
    zoom: { type: 'number', exclusiveMinimum: 0 },
    width: { type: 'integer', minimum: 1 },
    height: { type: 'integer', minimum: 1 },
    updatedAt: { type: 'string', format: 'date-time' }
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
