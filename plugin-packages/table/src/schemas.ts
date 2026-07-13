import type { JsonSchema } from '@agentcanvas/plugin-sdk';

const columns = {
  type: 'array',
  maxItems: 50,
  items: { type: 'string', maxLength: 2_000 }
} as const;

const rows = {
  type: 'array',
  maxItems: 500,
  items: {
    type: 'array',
    maxItems: 50,
    items: { type: 'string', maxLength: 2_000 }
  }
} as const;

export const tableDataSchema: JsonSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'object',
  additionalProperties: false,
  required: ['columns', 'rows'],
  properties: {
    columns,
    rows,
    caption: { type: ['string', 'null'], maxLength: 2_000 }
  }
};

export const tableStyleSchema: JsonSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'object',
  additionalProperties: false,
  properties: {
    color: { type: ['string', 'null'] },
    background: { type: ['string', 'null'] },
    borderColor: { type: ['string', 'null'] },
    borderWidth: { type: ['number', 'null'] },
    borderRadius: { type: ['number', 'null'] },
    fontSize: { type: ['number', 'null'] },
    fontFamily: { type: ['string', 'null'] },
    headerBackground: { type: ['string', 'null'] },
    headerColor: { type: ['string', 'null'] },
    captionColor: { type: ['string', 'null'] }
  }
};

export const addTableInputSchema: JsonSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'object',
  additionalProperties: false,
  required: ['canvasId', 'x', 'y', 'columns', 'rows'],
  properties: {
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
    style: { anyOf: [tableStyleSchema, { type: 'null' }] },
    metadata: { type: 'object' },
    expectedRevision: { type: 'integer', minimum: 0 },
    columns,
    rows,
    caption: { type: ['string', 'null'], maxLength: 2_000 }
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
