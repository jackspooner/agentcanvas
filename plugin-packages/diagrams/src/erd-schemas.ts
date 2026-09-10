import type { JsonSchema } from '@agentcanvas/extension-sdk';
import {
  boxProperties,
  connectorProperties,
  boxPresentationSchema,
  connectorPresentationSchema
} from './presentation-schemas.js';

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
    ...boxProperties,
    attributes: { type: 'array', maxItems: ERD_LIMITS.attributesPerEntity, items: attribute }
  },
  ['id', 'name', 'x', 'y', 'attributes']
);
const endpoint = object(
  { entityId: id, attributeId: id, cardinality: { enum: ['zero-or-one', 'one', 'zero-or-many', 'one-or-many'] } },
  ['entityId', 'cardinality']
);
const relationship = object(
  {
    id,
    source: endpoint,
    target: endpoint,
    label: { type: 'string', maxLength: 500 },
    identifying: { type: 'boolean' },
    ...connectorProperties
  },
  ['id', 'source', 'target', 'label', 'identifying']
);

export const erdDataSchema: JsonSchema = object({
  title,
  entities: { type: 'array', maxItems: ERD_LIMITS.entities, items: entity },
  relationships: { type: 'array', maxItems: ERD_LIMITS.relationships, items: relationship }
});

const operation = (op: string, properties: Record<string, JsonSchema>, required = Object.keys(properties)) =>
  object({ op: { const: op }, ...properties }, ['op', ...required]);

export const erdOperationDefinitions = {
  ErdAttribute: attribute,
  ErdEntity: entity,
  ErdRelationship: relationship
} satisfies Record<string, JsonSchema>;

export const erdOperationVariants: JsonSchema[] = [
  operation('set-title', { title }),
  operation('add-entity', { entity: { $ref: '#/$defs/ErdEntity' } }),
  operation('update-entity', { entityId: id, name, alias: { type: 'string', maxLength: 200 } }, ['entityId', 'name']),
  operation('move-entity', { entityId: id, x: coordinate, y: coordinate }),
  operation('present-entity', { entityId: id, presentation: boxPresentationSchema }),
  operation('present-relationship', { relationshipId: id, presentation: connectorPresentationSchema }),
  operation('delete-entity', { entityId: id }),
  operation('add-attribute', {
    entityId: id,
    attribute: { $ref: '#/$defs/ErdAttribute' },
    index: { type: 'integer', minimum: 0, maximum: ERD_LIMITS.attributesPerEntity }
  }),
  operation('update-attribute', { entityId: id, attribute: { $ref: '#/$defs/ErdAttribute' } }),
  operation('reorder-attributes', {
    entityId: id,
    attributeIds: { type: 'array', maxItems: ERD_LIMITS.attributesPerEntity, uniqueItems: true, items: id }
  }),
  operation('delete-attribute', { entityId: id, attributeId: id }),
  operation('add-relationship', { relationship: { $ref: '#/$defs/ErdRelationship' } }),
  operation('update-relationship', { relationship: { $ref: '#/$defs/ErdRelationship' } }),
  operation('delete-relationship', { relationshipId: id }),
  operation('auto-layout', { direction: { enum: ['LR', 'TB'] } })
];

export const erdOperationSchema: JsonSchema = {
  $defs: erdOperationDefinitions,
  oneOf: erdOperationVariants
};
