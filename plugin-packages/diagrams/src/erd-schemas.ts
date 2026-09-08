import type { JsonSchema } from '@agentcanvas/extension-sdk';

export const ERD_LIMITS = Object.freeze({
  entities: 100,
  attributesPerEntity: 100,
  attributes: 1000,
  relationships: 200
});
const id = { type: 'string', minLength: 1, maxLength: 58, pattern: '^[A-Za-z][A-Za-z0-9_-]*$' };
const name = { type: 'string', minLength: 1, maxLength: 200 };
const title = { type: 'string', maxLength: 500 };
const coordinate = { type: 'number', minimum: -100_000, maximum: 100_000 };
const object = (properties: Record<string, JsonSchema>, required = Object.keys(properties)): JsonSchema => ({
  type: 'object',
  additionalProperties: false,
  required,
  properties
});
const attribute = object(
  {
    id,
    name,
    dataType: { type: 'string', maxLength: 200 },
    keys: { type: 'array', maxItems: 3, uniqueItems: true, items: { enum: ['PK', 'FK', 'UK'] } },
    nullable: { type: ['boolean', 'null'] },
    comment: { type: 'string', maxLength: 2000 }
  },
  ['id', 'name', 'dataType', 'keys', 'nullable']
);
const entity = object(
  {
    id,
    name,
    alias: { type: 'string', maxLength: 200 },
    x: coordinate,
    y: coordinate,
    attributes: { type: 'array', maxItems: ERD_LIMITS.attributesPerEntity, items: attribute }
  },
  ['id', 'name', 'x', 'y', 'attributes']
);
const endpoint = object(
  { entityId: id, attributeId: id, cardinality: { enum: ['zero-or-one', 'one', 'zero-or-many', 'one-or-many'] } },
  ['entityId', 'cardinality']
);
const relationship = object({
  id,
  source: endpoint,
  target: endpoint,
  label: { type: 'string', maxLength: 500 },
  identifying: { type: 'boolean' }
});

export const erdDataSchema: JsonSchema = object({
  title,
  entities: { type: 'array', maxItems: ERD_LIMITS.entities, items: entity },
  relationships: { type: 'array', maxItems: ERD_LIMITS.relationships, items: relationship }
});

const operation = (op: string, properties: Record<string, JsonSchema>, required = Object.keys(properties)) =>
  object({ op: { const: op }, ...properties }, ['op', ...required]);

export const erdOperationSchema: JsonSchema = {
  oneOf: [
    operation('set-title', { title }),
    operation('add-entity', { entity }),
    operation('update-entity', { entityId: id, name, alias: { type: 'string', maxLength: 200 } }, ['entityId', 'name']),
    operation('move-entity', { entityId: id, x: coordinate, y: coordinate }),
    operation('delete-entity', { entityId: id }),
    operation('add-attribute', {
      entityId: id,
      attribute,
      index: { type: 'integer', minimum: 0, maximum: ERD_LIMITS.attributesPerEntity }
    }),
    operation('update-attribute', { entityId: id, attribute }),
    operation('reorder-attributes', {
      entityId: id,
      attributeIds: { type: 'array', maxItems: ERD_LIMITS.attributesPerEntity, uniqueItems: true, items: id }
    }),
    operation('delete-attribute', { entityId: id, attributeId: id }),
    operation('add-relationship', { relationship }),
    operation('update-relationship', { relationship }),
    operation('delete-relationship', { relationshipId: id }),
    operation('auto-layout', { direction: { enum: ['LR', 'TB'] } })
  ]
};
