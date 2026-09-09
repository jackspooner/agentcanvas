import type { JsonSchema } from '@agentcanvas/extension-sdk';
import { erdDataSchema, erdOperationSchema } from './erd-schemas.js';
import { mermaidPresentationSchema, pointSchema } from './presentation-schemas.js';
export { erdDataSchema, erdOperationSchema };
const id = { type: 'string', minLength: 1, maxLength: 128, pattern: '^[A-Za-z0-9_-]+$' };
const title = { type: 'string', maxLength: 200 };
const revision = { type: 'integer', minimum: 0 };
const number = { type: 'number', minimum: -100_000, maximum: 100_000 };
export const issueSchema: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['path', 'code', 'message'],
  properties: { path: { type: 'string' }, code: { type: 'string' }, message: { type: 'string' } }
};
const issues = { type: 'array', items: issueSchema };
export const mermaidDataSchema: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'source'],
  properties: {
    title,
    source: { type: 'string', minLength: 1, maxLength: 20_000 },
    presentation: mermaidPresentationSchema
  }
};
const object = (properties: Record<string, unknown>, required: string[]): JsonSchema =>
  ({ type: 'object', additionalProperties: false, required, properties }) as JsonSchema;
const placement = {
  canvasId: id,
  id,
  x: number,
  y: number,
  width: { type: 'number', exclusiveMinimum: 0, maximum: 100_000 },
  height: { type: 'number', exclusiveMinimum: 0, maximum: 100_000 },
  expectedRevision: revision
};
const target = { canvasId: id, elementId: id, expectedRevision: revision };
export const toolInputs: Record<string, JsonSchema> = {
  'create-erd': object({ ...placement, data: erdDataSchema, layout: { enum: ['preserve', 'LR', 'TB'] } }, [
    'canvasId',
    'x',
    'y',
    'data',
    'layout'
  ]),
  'edit-erd': object(
    { ...target, operations: { type: 'array', minItems: 1, maxItems: 200, items: erdOperationSchema } },
    ['canvasId', 'elementId', 'expectedRevision', 'operations']
  ),
  'create-mermaid': object({ ...placement, data: mermaidDataSchema }, ['canvasId', 'x', 'y', 'data']),
  'update-mermaid': object({ ...target, data: mermaidDataSchema }, [
    'canvasId',
    'elementId',
    'expectedRevision',
    'data'
  ]),
  'validate-mermaid': object(
    {
      source: { type: 'string', maxLength: 20_000 },
      purpose: { enum: ['render', 'convert-to-erd', 'layout'] },
      canvasId: id,
      presentation: mermaidPresentationSchema
    },
    ['source']
  ),
  'export-mermaid': object({ canvasId: id, elementId: id }, ['canvasId', 'elementId']),
  'convert-mermaid-erd': object(
    {
      ...placement,
      elementId: id,
      acknowledgeWarnings: { type: 'array', uniqueItems: true, items: { type: 'string' } }
    },
    ['canvasId', 'elementId', 'expectedRevision', 'x', 'y']
  )
};
export const mutationOutputSchema = object(
  {
    ok: { const: true },
    canvasId: id,
    elementId: id,
    revision,
    affectedIds: { type: 'array', items: id },
    removedRelationshipIds: { type: 'array', items: id },
    diagnostics: issues
  },
  ['ok', 'canvasId', 'elementId', 'revision', 'affectedIds', 'removedRelationshipIds', 'diagnostics']
);
export const validationOutputSchema = object(
  {
    ok: { type: 'boolean' },
    diagramType: { type: ['string', 'null'] },
    issues,
    warnings: issues,
    data: erdDataSchema,
    layout: object(
      {
        nodes: {
          type: 'array',
          items: object(
            {
              id: { type: 'string' },
              label: { type: 'string' },
              x: { type: 'number' },
              y: { type: 'number' },
              width: { type: 'number' },
              height: { type: 'number' }
            },
            ['id', 'label', 'x', 'y', 'width', 'height']
          )
        },
        edges: {
          type: 'array',
          items: object(
            {
              id: { type: 'string' },
              source: { type: 'string' },
              target: { type: 'string' },
              label: { type: 'string' },
              points: { type: 'array', items: pointSchema },
              labelPosition: pointSchema
            },
            ['id', 'source', 'target', 'label', 'points', 'labelPosition']
          )
        }
      },
      ['nodes', 'edges']
    )
  },
  ['ok', 'diagramType', 'issues', 'warnings']
);
export const exportOutputSchema = object({ ok: { const: true }, source: { type: 'string' }, warnings: issues }, [
  'ok',
  'source',
  'warnings'
]);
