import { CANVAS_MUTATION_RECEIPT_SCHEMA, type JsonObject, type JsonSchema } from '@agentcanvas/plugin-sdk';

export const imageSourceSchema: JsonObject = {
  type: 'object',
  additionalProperties: false,
  required: ['provider', 'reference'],
  properties: {
    provider: { type: 'string', pattern: '^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$', maxLength: 128 },
    reference: { type: 'object' }
  }
};

export const galleryItemInputSchema: JsonObject = {
  type: 'object',
  additionalProperties: false,
  required: ['source'],
  properties: {
    id: { type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$' },
    source: imageSourceSchema,
    caption: { type: ['string', 'null'], maxLength: 2_000 },
    alt: { type: ['string', 'null'], maxLength: 2_000 }
  }
};

const storedGalleryItemSchema: JsonObject = {
  ...galleryItemInputSchema,
  required: ['id', 'source']
};

export const galleryDataSchema: JsonSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'object',
  additionalProperties: false,
  required: [
    'items',
    'presentation',
    'fit',
    'initialIndex',
    'autoplay',
    'intervalMs',
    'showControls',
    'showIndicators'
  ],
  properties: {
    items: { type: 'array', minItems: 1, maxItems: 50, items: storedGalleryItemSchema },
    presentation: { const: 'carousel' },
    fit: { enum: ['contain', 'cover', 'stretch', 'original'] },
    initialIndex: { type: 'integer', minimum: 0, maximum: 49 },
    autoplay: { type: 'boolean' },
    intervalMs: { type: 'integer', minimum: 2_000, maximum: 60_000 },
    showControls: { type: 'boolean' },
    showIndicators: { type: 'boolean' }
  }
};

export const galleryStyleSchema: JsonSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'object',
  additionalProperties: false,
  properties: {
    background: { type: ['string', 'null'] },
    borderColor: { type: ['string', 'null'] },
    borderWidth: { type: ['number', 'null'], minimum: 0, maximum: 24 },
    borderRadius: { type: ['number', 'null'], minimum: 0, maximum: 64 },
    color: { type: ['string', 'null'] },
    accentColor: { type: ['string', 'null'] },
    captionBackground: { type: ['string', 'null'] }
  }
};

const mutationFrameProperties: Record<string, JsonObject> = {
  x: { type: 'number' },
  y: { type: 'number' },
  width: { type: ['number', 'null'] },
  height: { type: ['number', 'null'] },
  zIndex: { type: ['number', 'null'] },
  rotation: { type: ['number', 'null'] },
  opacity: { type: ['number', 'null'] },
  locked: { type: ['boolean', 'null'] },
  style: { anyOf: [galleryStyleSchema, { type: 'null' }] },
  metadata: { type: 'object' },
  expectedRevision: { type: 'integer', minimum: 0 }
};

const settingsProperties: Record<string, JsonObject> = {
  fit: { enum: ['contain', 'cover', 'stretch', 'original'] },
  autoplay: { type: 'boolean' },
  intervalMs: { type: 'integer', minimum: 2_000, maximum: 60_000 },
  showControls: { type: 'boolean' },
  showIndicators: { type: 'boolean' }
};

export const createGalleryInputSchema: JsonSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'object',
  additionalProperties: false,
  required: ['canvasId', 'items', 'x', 'y'],
  properties: {
    canvasId: { type: 'string', minLength: 1 },
    id: { type: 'string', minLength: 1 },
    items: { type: 'array', minItems: 1, maxItems: 50, items: galleryItemInputSchema },
    ...settingsProperties,
    ...mutationFrameProperties
  }
};

function editSchema(properties: Record<string, JsonObject>, required: string[]): JsonSchema {
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    type: 'object',
    additionalProperties: false,
    required: ['canvasId', 'elementId', ...required],
    properties: {
      canvasId: { type: 'string', minLength: 1 },
      elementId: { type: 'string', minLength: 1 },
      expectedRevision: { type: 'integer', minimum: 0 },
      ...properties
    }
  };
}

export const appendItemsInputSchema = editSchema(
  { items: { type: 'array', minItems: 1, maxItems: 50, items: galleryItemInputSchema } },
  ['items']
);
export const removeItemInputSchema = editSchema({ itemId: { type: 'string', minLength: 1 } }, ['itemId']);
export const reorderItemsInputSchema = editSchema(
  { itemIds: { type: 'array', minItems: 1, maxItems: 50, uniqueItems: true, items: { type: 'string' } } },
  ['itemIds']
);
export const setCoverInputSchema = editSchema({ itemId: { type: 'string', minLength: 1 } }, ['itemId']);
export const updateSettingsInputSchema = editSchema(settingsProperties, []);

export const mutationOutputSchema: JsonSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'object',
  additionalProperties: false,
  required: ['ok', 'canvasId', 'elementId', 'result'],
  properties: {
    ok: { const: true },
    canvasId: { type: 'string' },
    elementId: { type: 'string' },
    result: CANVAS_MUTATION_RECEIPT_SCHEMA
  }
};
