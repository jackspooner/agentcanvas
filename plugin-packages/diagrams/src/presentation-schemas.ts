import type { JsonSchema } from '@agentcanvas/extension-sdk';

export const coordinateSchema: JsonSchema = { type: 'number', minimum: -100_000, maximum: 100_000 };
export const pointSchema: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['x', 'y'],
  properties: { x: coordinateSchema, y: coordinateSchema }
};
const color = { type: 'string', pattern: '^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$' };
export const appearanceSchema: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    fill: color,
    headerFill: color,
    textColor: color,
    borderColor: color,
    borderWidth: { type: 'number', minimum: 0, maximum: 12 },
    borderStyle: { enum: ['solid', 'dashed', 'dotted'] },
    fontFamily: { type: 'string', minLength: 1, maxLength: 100, pattern: '^[A-Za-z0-9 ,_-]+$' },
    fontSize: { type: 'number', minimum: 8, maximum: 48 }
  }
};
export const boxProperties = {
  width: { type: 'number', minimum: 200, maximum: 4096 },
  height: { type: 'number', minimum: 64, maximum: 8192 },
  appearance: appearanceSchema
};
export const connectorProperties = {
  bends: { type: 'array', maxItems: 16, items: pointSchema },
  labelPosition: pointSchema,
  appearance: appearanceSchema
};
export const boxPresentationSchema: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: boxProperties
};
export const connectorPresentationSchema: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: connectorProperties
};
export const mermaidPresentationSchema: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['source', 'nodes', 'edges'],
  properties: {
    source: { type: 'string', minLength: 1, maxLength: 20000 },
    nodes: {
      type: 'array',
      maxItems: 200,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id'],
        properties: {
          id: { type: 'string', minLength: 1, maxLength: 500 },
          x: coordinateSchema,
          y: coordinateSchema,
          ...boxProperties,
          width: { type: 'number', minimum: 16, maximum: 4096 },
          height: { type: 'number', minimum: 16, maximum: 4096 }
        }
      }
    },
    edges: {
      type: 'array',
      maxItems: 500,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id'],
        properties: {
          id: { type: 'string', minLength: 1, maxLength: 500 },
          ...connectorProperties
        }
      }
    }
  }
};
