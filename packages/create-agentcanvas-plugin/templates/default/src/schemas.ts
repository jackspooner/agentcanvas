import type { JsonSchema } from '@agentcanvas/extension-sdk';

export const helloCardDataSchema: JsonSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'object',
  required: ['title', 'message'],
  additionalProperties: false,
  properties: {
    title: { type: 'string', minLength: 1, maxLength: 120 },
    message: { type: 'string', maxLength: 2000 }
  }
};

export const helloCardStyleSchema: JsonSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'object',
  additionalProperties: false,
  properties: {
    accentColor: { type: 'string', pattern: '^#[0-9a-fA-F]{6}$' },
    backgroundColor: { type: 'string', pattern: '^#[0-9a-fA-F]{6}$' },
    textColor: { type: 'string', pattern: '^#[0-9a-fA-F]{6}$' }
  }
};

export const addHelloCardInputSchema: JsonSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'object',
  required: ['canvasId', 'id', 'x', 'y', 'title', 'message'],
  additionalProperties: false,
  properties: {
    canvasId: { type: 'string', minLength: 1 },
    id: { type: 'string', minLength: 1 },
    x: { type: 'number' },
    y: { type: 'number' },
    title: { type: 'string', minLength: 1, maxLength: 120 },
    message: { type: 'string', maxLength: 2000 }
  }
};

export const addHelloCardOutputSchema: JsonSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'object',
  required: ['canvas'],
  additionalProperties: false,
  properties: { canvas: { type: 'object' } }
};

export const describeCardInputSchema: JsonSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'object',
  required: ['title', 'message'],
  additionalProperties: false,
  properties: {
    title: { type: 'string', minLength: 1, maxLength: 120 },
    message: { type: 'string', maxLength: 2000 }
  }
};

export const describeCardOutputSchema: JsonSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'object',
  required: ['summary', 'characterCount'],
  additionalProperties: false,
  properties: {
    summary: { type: 'string' },
    characterCount: { type: 'integer', minimum: 0 }
  }
};
