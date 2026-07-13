import type { JsonObject, JsonSchema, JsonValue } from '@agentcanvas/plugin-sdk';

const nullableString: JsonObject = { type: ['string', 'null'] };
const nullableNumber: JsonObject = { type: ['number', 'null'] };

export const primitiveStyleSchema: JsonSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'object',
  additionalProperties: false,
  properties: {
    color: nullableString,
    background: nullableString,
    borderColor: nullableString,
    borderWidth: nullableNumber,
    borderRadius: nullableNumber,
    fontSize: nullableNumber,
    fontWeight: {
      anyOf: [{ type: 'string' }, { type: 'number' }, { type: 'null' }]
    },
    fontFamily: nullableString,
    stroke: nullableString,
    strokeWidth: nullableNumber,
    fill: nullableString
  }
};

export const textDataSchema: JsonSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'object',
  additionalProperties: false,
  required: ['text'],
  properties: { text: { type: 'string', maxLength: 20_000 } }
};

export const shapeDataSchema: JsonSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'object',
  additionalProperties: false,
  required: ['shape'],
  properties: {
    shape: { enum: ['rect', 'ellipse', 'diamond'] },
    label: nullableString
  }
};

export const endpointSchema: JsonObject = {
  type: 'object',
  additionalProperties: false,
  properties: {
    elementId: nullableString,
    x: nullableNumber,
    y: nullableNumber,
    anchor: { enum: ['center', 'top', 'right', 'bottom', 'left', null] }
  }
};

export const connectorDataSchema: JsonSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'object',
  additionalProperties: false,
  required: ['from', 'to'],
  properties: {
    from: endpointSchema,
    to: endpointSchema,
    label: nullableString,
    stroke: nullableString,
    strokeWidth: nullableNumber
  }
};

const frameProperties: Record<string, JsonValue> = {
  x: { type: 'number' },
  y: { type: 'number' },
  width: nullableNumber,
  height: nullableNumber,
  zIndex: nullableNumber,
  rotation: nullableNumber,
  opacity: nullableNumber,
  locked: { type: ['boolean', 'null'] },
  style: { anyOf: [primitiveStyleSchema, { type: 'null' }] },
  metadata: { type: 'object' }
};

function addToolSchema(dataProperties: Record<string, unknown>, dataRequired: readonly string[]): JsonSchema {
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    type: 'object',
    additionalProperties: false,
    required: ['canvasId', 'x', 'y', ...dataRequired],
    properties: {
      canvasId: { type: 'string', minLength: 1 },
      id: { type: 'string', minLength: 1 },
      expectedRevision: { type: 'integer', minimum: 0 },
      ...frameProperties,
      ...dataProperties
    }
  };
}

export const addTextInputSchema = addToolSchema({ text: { type: 'string', maxLength: 20_000 } }, ['text']);
export const addShapeInputSchema = addToolSchema(
  { shape: { enum: ['rect', 'ellipse', 'diamond'] }, label: nullableString },
  ['shape']
);
export const addConnectorInputSchema = addToolSchema(
  {
    from: endpointSchema,
    to: endpointSchema,
    label: nullableString,
    stroke: nullableString,
    strokeWidth: nullableNumber
  },
  ['from', 'to']
);

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
