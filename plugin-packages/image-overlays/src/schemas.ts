import type { JsonObject, JsonSchema } from '@agentcanvas/plugin-sdk';

const assetReference: JsonObject = {
  type: 'object',
  additionalProperties: false,
  required: ['type', 'project'],
  anyOf: [
    { required: ['assetId'], properties: { assetId: {} } },
    { required: ['assetKey'], properties: { assetKey: {} } }
  ],
  properties: {
    type: { const: 'asset' },
    project: { type: 'string', minLength: 1, maxLength: 256 },
    assetId: { type: 'string', minLength: 1, maxLength: 256 },
    assetKey: { type: 'string', minLength: 1, maxLength: 512 },
    assetBaseUrl: { type: 'string', maxLength: 2_000 }
  }
};

const optionalText: JsonObject = { type: ['string', 'null'], maxLength: 2_000 };
const color: JsonObject = { type: ['string', 'null'], maxLength: 128 };
const metadata: JsonObject = { type: 'object', maxProperties: 200 };

const bbox: JsonObject = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'x', 'y', 'width', 'height'],
  properties: {
    id: { type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$' },
    x: { type: 'number' },
    y: { type: 'number' },
    width: { type: 'number', exclusiveMinimum: 0 },
    height: { type: 'number', exclusiveMinimum: 0 },
    label: optionalText,
    color,
    fill: color,
    strokeWidth: { type: ['number', 'null'], minimum: 0, maximum: 1_000 },
    labelAlign: { type: ['string', 'null'], enum: ['left', 'center', 'right', null] },
    labelVerticalAlign: { type: ['string', 'null'], enum: ['top', 'middle', 'bottom', null] },
    labelPadding: { type: ['number', 'null'], minimum: 0, maximum: 10_000 },
    metadata
  }
};

const overlayPath: JsonObject = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'd'],
  properties: {
    id: { type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$' },
    d: { type: 'string', minLength: 1, maxLength: 20_000 },
    label: optionalText,
    color,
    fill: color,
    strokeWidth: { type: ['number', 'null'], minimum: 0, maximum: 1_000 },
    metadata
  }
};

const commonOverlayProperties: JsonObject = {
  caption: optionalText,
  alt: optionalText,
  showLabels: { type: ['boolean', 'null'] },
  background: color
};

export const bboxDataSchema: JsonSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'object',
  additionalProperties: false,
  properties: {
    canvasWidth: { type: 'number', exclusiveMinimum: 0, maximum: 100_000 },
    canvasHeight: { type: 'number', exclusiveMinimum: 0, maximum: 100_000 },
    boxes: { type: 'array', maxItems: 500, items: bbox },
    layoutAssetRef: assetReference,
    imageAssetRef: { anyOf: [assetReference, { type: 'null' }] },
    ...commonOverlayProperties
  },
  oneOf: [
    {
      required: ['canvasWidth', 'canvasHeight', 'boxes'],
      properties: { canvasWidth: {}, canvasHeight: {}, boxes: {}, layoutAssetRef: false }
    },
    {
      required: ['layoutAssetRef'],
      properties: { layoutAssetRef: assetReference, canvasWidth: false, canvasHeight: false, boxes: false }
    }
  ]
};

export const pathDataSchema: JsonSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'object',
  additionalProperties: false,
  required: ['canvasWidth', 'canvasHeight', 'paths'],
  properties: {
    canvasWidth: { type: 'number', exclusiveMinimum: 0, maximum: 100_000 },
    canvasHeight: { type: 'number', exclusiveMinimum: 0, maximum: 100_000 },
    paths: { type: 'array', maxItems: 500, items: overlayPath },
    ...commonOverlayProperties
  }
};

const frameProperties: JsonObject = {
  canvasId: { type: 'string', minLength: 1 },
  id: { type: 'string', minLength: 1 },
  x: { type: 'number' },
  y: { type: 'number' },
  width: { type: ['number', 'null'] },
  height: { type: ['number', 'null'] },
  zIndex: { type: ['number', 'null'] },
  rotation: { type: ['number', 'null'] },
  opacity: { type: ['number', 'null'] },
  locked: { type: ['boolean', 'null'] },
  metadata,
  expectedRevision: { type: 'integer', minimum: 0 }
};

export const addBBoxInputSchema: JsonSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'object',
  additionalProperties: false,
  required: ['canvasId', 'x', 'y'],
  properties: {
    ...frameProperties,
    canvasWidth: { type: 'number', exclusiveMinimum: 0, maximum: 100_000 },
    canvasHeight: { type: 'number', exclusiveMinimum: 0, maximum: 100_000 },
    boxes: { type: 'array', maxItems: 500, items: bbox },
    layoutAssetRef: assetReference,
    imageAssetRef: { anyOf: [assetReference, { type: 'null' }] },
    ...commonOverlayProperties
  },
  oneOf: [
    {
      required: ['canvasWidth', 'canvasHeight', 'boxes'],
      properties: { canvasWidth: {}, canvasHeight: {}, boxes: {}, layoutAssetRef: false }
    },
    {
      required: ['layoutAssetRef'],
      properties: { layoutAssetRef: assetReference, canvasWidth: false, canvasHeight: false, boxes: false }
    }
  ]
};

export const addPathInputSchema: JsonSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'object',
  additionalProperties: false,
  required: ['canvasId', 'x', 'y', 'canvasWidth', 'canvasHeight', 'paths'],
  properties: {
    ...frameProperties,
    canvasWidth: { type: 'number', exclusiveMinimum: 0, maximum: 100_000 },
    canvasHeight: { type: 'number', exclusiveMinimum: 0, maximum: 100_000 },
    paths: { type: 'array', maxItems: 500, items: overlayPath },
    ...commonOverlayProperties
  }
};

export const mutationOutputSchema: JsonSchema = {
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

export const exportInputSchema: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['canvasId', 'elementId'],
  properties: { canvasId: { type: 'string', minLength: 1 }, elementId: { type: 'string', minLength: 1 } }
};

export const exportOutputSchema: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['ok', 'export', 'diagnostics'],
  properties: {
    ok: { const: true },
    export: {
      type: 'object',
      additionalProperties: false,
      required: ['kind', 'elementId', 'filename', 'resource'],
      properties: {
        kind: { type: 'string', enum: ['png', 'mask-zip'] },
        elementId: { type: 'string' },
        filename: { type: 'string' },
        resource: {
          type: 'object',
          additionalProperties: false,
          required: ['handle', 'url', 'mimeType', 'byteLength', 'sha256'],
          properties: {
            handle: { type: 'string', minLength: 1 },
            url: { type: 'string', pattern: '^/api/v1/resources/[^/]+/content$' },
            mimeType: { type: 'string', enum: ['image/png', 'application/zip'] },
            byteLength: { type: 'integer', minimum: 1 },
            width: { type: 'integer', minimum: 1 },
            height: { type: 'integer', minimum: 1 },
            sha256: { type: 'string', pattern: '^[a-f0-9]{64}$' }
          }
        }
      }
    },
    diagnostics: {
      type: 'array',
      maxItems: 10,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['code', 'severity', 'message', 'retryable', 'pluginId', 'elementId'],
        properties: {
          code: { type: 'string', minLength: 1, maxLength: 128 },
          severity: { type: 'string', enum: ['info', 'warning', 'error'] },
          message: { type: 'string', minLength: 1, maxLength: 2_000 },
          retryable: { type: 'boolean' },
          pluginId: { const: 'agentcanvas.image-overlays' },
          elementId: { type: 'string', minLength: 1 }
        }
      }
    }
  }
};
