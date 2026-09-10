import { CANVAS_MUTATION_RECEIPT_SCHEMA, type JsonSchema } from '@agentcanvas/plugin-sdk';

export const dataSchema: JsonSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'object',
  required: ['label', 'status'],
  additionalProperties: false,
  properties: {
    label: { type: 'string', minLength: 1, maxLength: 120 },
    status: { type: 'string', enum: ['idle', 'active', 'blocked'] }
  }
};
export const toolInputSchema: JsonSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'object',
  required: ['canvasId', 'id', 'label', 'status'],
  additionalProperties: false,
  properties: {
    canvasId: { type: 'string', minLength: 1 },
    id: { type: 'string', minLength: 1 },
    label: { type: 'string', minLength: 1, maxLength: 120 },
    status: { type: 'string', enum: ['idle', 'active', 'blocked'] }
  }
};
export const toolOutputSchema: JsonSchema = {
  type: 'object',
  required: ['receipt'],
  additionalProperties: false,
  properties: { receipt: CANVAS_MUTATION_RECEIPT_SCHEMA }
};
export const procedureInputSchema: JsonSchema = {
  type: 'object',
  required: ['label', 'status'],
  additionalProperties: false,
  properties: { label: { type: 'string' }, status: { type: 'string', enum: ['idle', 'active', 'blocked'] } }
};
export const procedureOutputSchema: JsonSchema = {
  type: 'object',
  required: ['summary'],
  additionalProperties: false,
  properties: { summary: { type: 'string' } }
};
