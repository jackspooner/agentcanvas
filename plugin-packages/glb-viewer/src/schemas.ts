import type { JsonObject, JsonSchema } from '@agentcanvas/plugin-sdk';

export const assetReferenceSchema: JsonObject = {
  type: 'object',
  additionalProperties: false,
  required: ['type', 'project'],
  properties: {
    type: { const: 'asset' },
    project: { type: 'string', minLength: 1, maxLength: 128 },
    assetId: { type: 'string', minLength: 1, maxLength: 128 },
    assetKey: { type: 'string', minLength: 1, maxLength: 512 },
    assetBaseUrl: { type: 'string', minLength: 1, maxLength: 2048 }
  }
};

export const modelDataSchema: JsonSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'object',
  additionalProperties: false,
  required: ['assetRef', 'cameraControls', 'autoRotate'],
  properties: {
    assetRef: assetReferenceSchema,
    posterAssetRef: { anyOf: [assetReferenceSchema, { type: 'null' }] },
    caption: { type: ['string', 'null'], maxLength: 2_000 },
    alt: { type: ['string', 'null'], maxLength: 2_000 },
    cameraControls: { type: 'boolean' },
    autoRotate: { type: 'boolean' }
  }
};

export const modelStyleSchema: JsonSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'object',
  additionalProperties: false,
  properties: {
    background: { type: ['string', 'null'] },
    borderColor: { type: ['string', 'null'] },
    borderWidth: { type: ['number', 'null'] },
    borderRadius: { type: ['number', 'null'] },
    color: { type: ['string', 'null'] }
  }
};

export const placeModelInputSchema: JsonSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'object',
  additionalProperties: false,
  required: ['canvasId', 'assetRef', 'x', 'y'],
  properties: {
    canvasId: { type: 'string', minLength: 1 },
    id: { type: 'string', minLength: 1 },
    assetRef: assetReferenceSchema,
    posterAssetRef: { anyOf: [assetReferenceSchema, { type: 'null' }] },
    caption: { type: ['string', 'null'], maxLength: 2_000 },
    alt: { type: ['string', 'null'], maxLength: 2_000 },
    cameraControls: { type: 'boolean' },
    autoRotate: { type: 'boolean' },
    x: { type: 'number' },
    y: { type: 'number' },
    width: { type: ['number', 'null'] },
    height: { type: ['number', 'null'] },
    zIndex: { type: ['number', 'null'] },
    rotation: { type: ['number', 'null'] },
    opacity: { type: ['number', 'null'] },
    locked: { type: ['boolean', 'null'] },
    style: { anyOf: [modelStyleSchema, { type: 'null' }] },
    metadata: { type: 'object' },
    expectedRevision: { type: 'integer', minimum: 0 }
  }
};

export const mutationOutputSchema: JsonSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'object',
  additionalProperties: false,
  required: ['ok', 'canvasId', 'elementId', 'result'],
  properties: {
    ok: { const: true },
    canvasId: { type: 'string' },
    elementId: { type: 'string' },
    result: { type: 'object' }
  }
};

export const detailsInputSchema: JsonSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'object',
  additionalProperties: false,
  required: ['assetRef'],
  properties: {
    assetRef: assetReferenceSchema,
    posterAssetRef: { anyOf: [assetReferenceSchema, { type: 'null' }] }
  }
};

export const detailsOutputSchema: JsonSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'object',
  additionalProperties: false,
  required: ['ok', 'details'],
  properties: {
    ok: { const: true },
    details: { type: 'object' }
  }
};
