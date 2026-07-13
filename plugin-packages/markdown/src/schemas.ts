import type { JsonSchema } from '@agentcanvas/plugin-sdk';

export const markdownDataSchema: JsonSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'object',
  additionalProperties: false,
  required: ['markdown'],
  properties: { markdown: { type: 'string', maxLength: 20_000 } }
};

export const markdownStyleSchema: JsonSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'object',
  additionalProperties: false,
  properties: {
    color: { type: ['string', 'null'] },
    background: { type: ['string', 'null'] },
    borderColor: { type: ['string', 'null'] },
    borderWidth: { type: ['number', 'null'] },
    borderRadius: { type: ['number', 'null'] },
    border: {
      type: ['string', 'null'],
      pattern: '^\\d+(?:\\.\\d+)?px\\s+(?:solid|dashed|dotted)\\s+#[0-9a-fA-F]{3,8}$'
    },
    padding: { type: ['number', 'null'], minimum: 0, maximum: 1000 },
    fontSize: { type: ['number', 'null'] },
    fontWeight: { anyOf: [{ type: 'string' }, { type: 'number' }, { type: 'null' }] },
    fontFamily: { type: ['string', 'null'] }
  }
};

export const addDocumentInputSchema: JsonSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'object',
  additionalProperties: false,
  required: ['canvasId', 'markdown', 'x', 'y'],
  properties: {
    canvasId: { type: 'string', minLength: 1 },
    id: { type: 'string', minLength: 1 },
    markdown: { type: 'string', maxLength: 20_000 },
    x: { type: 'number' },
    y: { type: 'number' },
    width: { type: ['number', 'null'] },
    height: { type: ['number', 'null'] },
    zIndex: { type: ['number', 'null'] },
    rotation: { type: ['number', 'null'] },
    opacity: { type: ['number', 'null'] },
    locked: { type: ['boolean', 'null'] },
    style: { anyOf: [markdownStyleSchema, { type: 'null' }] },
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
