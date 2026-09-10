import {
  CANVAS_MUTATION_RECEIPT_SCHEMA,
  type JsonObject,
  type JsonSchema,
  type JsonValue
} from '@agentcanvas/plugin-sdk';

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
  properties: {
    text: {
      type: 'string',
      maxLength: 20_000,
      description: 'Literal visible text. Use characters such as & directly; do not HTML-escape the value.'
    },
    allowClipping: { type: 'boolean' }
  }
};

export const shapeDataSchema: JsonSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'object',
  additionalProperties: false,
  required: ['shape'],
  properties: {
    shape: { enum: ['rect', 'ellipse', 'diamond'] },
    label: {
      type: ['string', 'null'],
      description: 'Literal visible label. Use characters such as & directly; do not HTML-escape the value.'
    },
    allowClipping: { type: 'boolean' }
  }
};

export const endpointSchema: JsonObject = {
  type: 'object',
  additionalProperties: false,
  properties: {
    elementId: {
      type: ['string', 'null'],
      description: 'ID of an existing element on this same canvas. Prefer this for anchored connectors.'
    },
    x: { type: ['number', 'null'], description: 'Absolute world x coordinate when elementId is not used.' },
    y: { type: ['number', 'null'], description: 'Absolute world y coordinate when elementId is not used.' },
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
    description: 'Visible frame width. Set explicitly when composing a layout so neighboring elements do not overlap.'
  },
  height: {
    type: ['number', 'null'],
    description: 'Visible frame height. Set explicitly for long text and media so content is not clipped.'
  },
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

export const addTextInputSchema = addToolSchema(
  {
    width: {
      type: ['number', 'null'],
      description: 'Fixed visible width. A large title normally needs 700-1200px, not the 240px default.'
    },
    height: {
      type: ['number', 'null'],
      description:
        'Fixed visible height. Explicit undersizing is rejected unless allowClipping is true; use at least 72px for a 32-48px title.'
    },
    allowClipping: {
      type: 'boolean',
      description: 'Set true only when a deliberately clipped or scrolling text frame is required.'
    },
    text: {
      type: 'string',
      maxLength: 20_000,
      description: 'Literal visible text. Use characters such as & directly; do not HTML-escape the value.'
    }
  },
  ['text']
);
export const addShapeInputSchema = addToolSchema(
  {
    width: {
      type: ['number', 'null'],
      description: 'Fixed visible width. Leave at least 32px before the next unrelated frame.'
    },
    height: {
      type: ['number', 'null'],
      description:
        'Fixed visible height. Explicit undersizing is rejected unless allowClipping is true; allow enough space for every literal label line.'
    },
    allowClipping: {
      type: 'boolean',
      description: 'Set true only when a deliberately clipped shape label is required.'
    },
    shape: { enum: ['rect', 'ellipse', 'diamond'] },
    label: {
      type: ['string', 'null'],
      description: 'Literal visible label. Use characters such as & directly; do not HTML-escape the value.'
    }
  },
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
  required: ['canvasId', 'elementId', 'revision', 'inspectionSummary'],
  properties: {
    elementId: { type: 'string' },
    ...(CANVAS_MUTATION_RECEIPT_SCHEMA.properties as JsonObject)
  }
};
