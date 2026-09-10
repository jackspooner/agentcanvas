import { CANVAS_MUTATION_RECEIPT_SCHEMA, type JsonObject } from '@agentcanvas/plugin-sdk';

export const sourceSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['rootId', 'path'],
  properties: {
    rootId: { type: 'string', pattern: '^[a-z][a-z0-9-]{0,63}$' },
    path: { type: 'string', minLength: 1, maxLength: 4096, not: { pattern: '\\\\' } }
  }
} as const;

export const imageDataSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'object',
  additionalProperties: false,
  required: ['source'],
  properties: {
    source: sourceSchema,
    caption: { type: ['string', 'null'], maxLength: 2000 },
    fit: { type: ['string', 'null'], enum: ['contain', 'cover', 'stretch', 'original', null] },
    alt: { type: ['string', 'null'], maxLength: 2000 }
  }
} as const;

export const imageStyleSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'object',
  additionalProperties: false,
  properties: {
    background: { type: 'string', maxLength: 100 },
    borderColor: { type: 'string', maxLength: 100 },
    borderWidth: { type: 'number', minimum: 0, maximum: 100 },
    borderRadius: { type: 'number', minimum: 0, maximum: 10000 }
  }
} as const;

const frameProperties = {
  canvasId: { type: 'string', minLength: 1, maxLength: 128 },
  id: { type: 'string', minLength: 1, maxLength: 128 },
  x: { type: 'number' },
  y: { type: 'number' },
  width: { type: ['number', 'null'], minimum: 1 },
  height: { type: ['number', 'null'], minimum: 1 },
  zIndex: { type: ['number', 'null'] },
  rotation: { type: ['number', 'null'] },
  opacity: { type: ['number', 'null'], minimum: 0, maximum: 1 },
  locked: { type: ['boolean', 'null'] },
  style: imageStyleSchema,
  metadata: { type: 'object' },
  expectedRevision: { type: 'integer', minimum: 1 }
} as const;

export const placeImageInputSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'object',
  additionalProperties: false,
  required: ['canvasId', 'source', 'x', 'y'],
  properties: {
    ...frameProperties,
    source: sourceSchema,
    caption: { type: ['string', 'null'], maxLength: 2000 },
    fit: { type: ['string', 'null'], enum: ['contain', 'cover', 'stretch', 'original', null] },
    alt: { type: ['string', 'null'], maxLength: 2000 }
  }
} as const;

export const mutationOutputSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['canvasId', 'elementId', 'revision', 'inspectionSummary'],
  properties: {
    elementId: { type: 'string' },
    ...(CANVAS_MUTATION_RECEIPT_SCHEMA.properties as JsonObject)
  }
} as const;

export const listRootsInputSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {}
} as const;

export const listRootsOutputSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['roots'],
  properties: {
    roots: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id'],
        properties: { id: { type: 'string' } }
      }
    }
  }
} as const;

export function asJsonSchema(value: object): JsonObject {
  return value as JsonObject;
}
