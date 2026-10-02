import { CANVAS_MUTATION_RECEIPT_SCHEMA, type JsonObject } from '@agentcanvas/extension-sdk';

export const idSchema: JsonObject = { type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$' };
const elementId = { type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$' };
export const bindInputSchema: JsonObject = {
  type: 'object',
  additionalProperties: false,
  required: ['bindingId', 'canvasId', 'runId', 'target'],
  properties: {
    bindingId: idSchema,
    canvasId: { type: 'string', minLength: 1, maxLength: 128 },
    runId: { type: 'string', minLength: 1, maxLength: 256 },
    outputIndex: { type: 'integer', minimum: 0 },
    caption: { type: 'string', maxLength: 2000 },
    alt: { type: 'string', maxLength: 2000 },
    target: {
      oneOf: [
        {
          type: 'object',
          additionalProperties: false,
          required: ['kind', 'x', 'y'],
          properties: {
            kind: { const: 'image' },
            x: { type: 'number' },
            y: { type: 'number' },
            width: { type: 'number', exclusiveMinimum: 0 },
            height: { type: 'number', exclusiveMinimum: 0 },
            elementId
          }
        },
        {
          type: 'object',
          additionalProperties: false,
          required: ['kind', 'elementId'],
          properties: {
            kind: { const: 'append' },
            elementId,
            itemId: elementId
          }
        },
        {
          type: 'object',
          additionalProperties: false,
          required: ['kind', 'elementId', 'itemId'],
          properties: {
            kind: { const: 'replace' },
            elementId,
            itemId: elementId
          }
        }
      ]
    }
  }
};

export const publicBindingSchema: JsonObject = {
  type: 'object',
  additionalProperties: false,
  required: ['bindingId', 'canvasId', 'runId', 'outputIndex', 'elementId', 'itemId', 'status'],
  properties: {
    bindingId: idSchema,
    canvasId: { type: 'string' },
    runId: { type: 'string' },
    outputIndex: { type: 'integer', minimum: 0 },
    elementId,
    itemId: elementId,
    status: { enum: ['attaching', 'queued', 'running', 'collected', 'completed', 'failed', 'superseded'] },
    error: {
      type: 'object',
      additionalProperties: false,
      required: ['code', 'message', 'retryable'],
      properties: {
        code: { type: 'string' },
        message: { type: 'string' },
        retryable: { type: 'boolean' }
      }
    },
    source: {
      type: 'object',
      additionalProperties: false,
      required: ['provider', 'reference'],
      properties: {
        provider: { type: 'string' },
        reference: { type: 'object' }
      }
    }
  }
};

export const bindOutputSchema: JsonObject = {
  type: 'object',
  additionalProperties: false,
  required: ['binding'],
  properties: { binding: publicBindingSchema, receipt: CANVAS_MUTATION_RECEIPT_SCHEMA }
};
export const getInputSchema: JsonObject = {
  type: 'object',
  additionalProperties: false,
  required: ['bindingId'],
  properties: { bindingId: idSchema }
};
export const listInputSchema: JsonObject = {
  type: 'object',
  additionalProperties: false,
  properties: {
    canvasId: { type: 'string', minLength: 1, maxLength: 128 },
    cursor: { type: 'string', maxLength: 128 },
    limit: { type: 'integer', minimum: 1, maximum: 100 }
  }
};
export const listOutputSchema: JsonObject = {
  type: 'object',
  additionalProperties: false,
  required: ['bindings'],
  properties: {
    bindings: { type: 'array', maxItems: 100, items: publicBindingSchema },
    nextCursor: { type: 'string' }
  }
};
