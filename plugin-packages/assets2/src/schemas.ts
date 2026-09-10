import { CANVAS_MUTATION_RECEIPT_SCHEMA, type JsonObject } from '@agentcanvas/plugin-sdk';

export const assetReferenceSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['type', 'project'],
  properties: {
    type: { const: 'asset' },
    project: { type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$' },
    assetId: {
      type: 'string',
      pattern: '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'
    },
    assetKey: {
      type: 'string',
      pattern: '^[A-Za-z0-9][A-Za-z0-9_.:@-]{0,127}(?:/[A-Za-z0-9][A-Za-z0-9_.:@-]{0,127})*$'
    },
    assetBaseUrl: { type: 'string', pattern: '^https?://[^\\s]+$' }
  },
  anyOf: [
    { required: ['assetId'], properties: { assetId: {} } },
    { required: ['assetKey'], properties: { assetKey: {} } }
  ]
} as const;

export const assetDataSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'object',
  additionalProperties: false,
  required: ['assetRef'],
  properties: {
    assetRef: assetReferenceSchema,
    caption: { type: ['string', 'null'], maxLength: 2000 },
    fit: { type: ['string', 'null'], enum: ['contain', 'cover', 'stretch', 'original', null] },
    alt: { type: ['string', 'null'], maxLength: 2000 }
  }
} as const;

export const assetStyleSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'object',
  additionalProperties: false,
  properties: {
    color: { type: 'string', maxLength: 100 },
    background: { type: 'string', maxLength: 100 },
    borderColor: { type: 'string', maxLength: 100 },
    borderWidth: { type: 'number', minimum: 0, maximum: 100 },
    borderRadius: { type: 'number', minimum: 0, maximum: 10000 },
    fontSize: { type: 'number', minimum: 1, maximum: 1000 },
    fontWeight: { anyOf: [{ type: 'string' }, { type: 'number' }] },
    fontFamily: { type: 'string', maxLength: 500 },
    stroke: { type: 'string', maxLength: 100 },
    strokeWidth: { type: 'number', minimum: 0, maximum: 100 },
    fill: { type: 'string', maxLength: 100 }
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
  style: assetStyleSchema,
  metadata: { type: 'object' },
  expectedRevision: { type: 'integer', minimum: 1 }
} as const;

export const placeAssetInputSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'object',
  additionalProperties: false,
  required: ['canvasId', 'assetRef', 'x', 'y'],
  properties: {
    ...frameProperties,
    assetRef: assetReferenceSchema,
    caption: { type: ['string', 'null'], maxLength: 2000 },
    fit: { type: ['string', 'null'], enum: ['contain', 'cover', 'stretch', 'original', null] },
    alt: { type: ['string', 'null'], maxLength: 2000 }
  }
} as const;

export const assetDetailsInputSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'object',
  additionalProperties: false,
  required: ['assetRef'],
  properties: { assetRef: assetReferenceSchema }
} as const;

export const mutationOutputSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['ok', 'canvasId', 'elementId', 'result'],
  properties: {
    ok: { const: true },
    canvasId: { type: 'string' },
    elementId: { type: 'string' },
    result: CANVAS_MUTATION_RECEIPT_SCHEMA
  }
} as const;

export const detailsOutputSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['ok', 'details'],
  properties: {
    ok: { const: true },
    details: { type: 'object' }
  }
} as const;

export function asJsonSchema(value: object): JsonObject {
  return value as JsonObject;
}
