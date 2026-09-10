import { CANVAS_MUTATION_RECEIPT_SCHEMA, type JsonSchema } from '@agentcanvas/plugin-sdk';

export const markdownDataSchema: JsonSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'object',
  additionalProperties: false,
  required: ['markdown'],
  properties: {
    markdown: { type: 'string', maxLength: 20_000 },
    allowImages: {
      type: 'boolean',
      description:
        'Whether supported image references may render. This setting does not prove that a remote image loaded.'
    },
    allowScroll: {
      type: 'boolean',
      description: 'Whether a deliberately undersized frame may use its internal scrollbar.'
    }
  }
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
    markdown: {
      type: 'string',
      maxLength: 20_000,
      description: 'Markdown source displayed inside this fixed-size frame.'
    },
    allowImages: {
      type: 'boolean',
      description:
        'Whether supported image references may render. This setting does not prove that a remote image loaded.'
    },
    x: {
      type: 'number',
      description: 'Left edge in canvas world coordinates. Fresh unlimited canvases initially open around (0, 0).'
    },
    y: {
      type: 'number',
      description: 'Top edge in canvas world coordinates. Fresh unlimited canvases initially open around (0, 0).'
    },
    width: {
      type: ['number', 'null'],
      description: 'Visible frame width. Set explicitly when composing a multi-column layout.'
    },
    height: {
      type: ['number', 'null'],
      description:
        'Fixed visible height. Omit it to auto-size from content; explicit undersizing is rejected unless allowScroll is true.'
    },
    allowScroll: {
      type: 'boolean',
      description: 'Set true only when a deliberately compact, internally scrolling Markdown frame is required.'
    },
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
    result: CANVAS_MUTATION_RECEIPT_SCHEMA
  }
};
