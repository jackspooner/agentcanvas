import { CanvasError } from '@agentcanvas/core/errors';
import type { ErdData, ErdOperation, ErdRelationship } from '../contracts.js';
import { layoutErd } from './layout.js';
import { assertErd, assertErdOperation } from './validation.js';

/** Applies a batch on a clone. Invalid operations throw without changing the caller's document. */
export function applyErdOperations(
  data: ErdData,
  operations: readonly ErdOperation[]
): {
  data: ErdData;
  affectedIds: string[];
  removedRelationshipIds: string[];
} {
  assertErd(data);
  if (!Array.isArray(operations) || operations.length > 200) fail('Expected an array of at most 200 ERD operations');
  let result = structuredClone(data);
  const affected = new Set<string>();
  const removed = new Set<string>();
  const entity = (id: string) => {
    const found = result.entities.find((item) => item.id === id);
    if (!found) fail(`Unknown entity: ${id}`);
    affected.add(id);
    return found;
  };
  const removeRelationships = (predicate: (relationship: ErdRelationship) => boolean) => {
    result.relationships = result.relationships.filter((relationship) => {
      if (!predicate(relationship)) return true;
      removed.add(relationship.id);
      affected.add(relationship.id);
      return false;
    });
  };
  for (const raw of operations) {
    assertErdOperation(raw);
    const op = structuredClone(raw);
    switch (op.op) {
      case 'set-title':
        result.title = op.title;
        break;
      case 'add-entity':
        if (result.entities.some((item) => item.id === op.entity.id)) fail(`Entity already exists: ${op.entity.id}`);
        result.entities.push(op.entity);
        affected.add(op.entity.id);
        break;
      case 'update-entity': {
        const item = entity(op.entityId);
        item.name = op.name;
        if (op.alias === undefined) delete item.alias;
        else item.alias = op.alias;
        break;
      }
      case 'move-entity':
        Object.assign(entity(op.entityId), { x: op.x, y: op.y });
        break;
      case 'present-entity': {
        const item = entity(op.entityId);
        delete item.width;
        delete item.height;
        delete item.appearance;
        Object.assign(item, op.presentation);
        break;
      }
      case 'present-relationship': {
        const item = result.relationships.find((item) => item.id === op.relationshipId);
        if (!item) fail(`Unknown relationship: ${op.relationshipId}`);
        delete item.bends;
        delete item.labelPosition;
        delete item.appearance;
        Object.assign(item, op.presentation);
        affected.add(item.id);
        break;
      }
      case 'delete-entity':
        entity(op.entityId);
        result.entities = result.entities.filter((item) => item.id !== op.entityId);
        removeRelationships((item) => item.source.entityId === op.entityId || item.target.entityId === op.entityId);
        break;
      case 'add-attribute': {
        const item = entity(op.entityId);
        if (item.attributes.some((attribute) => attribute.id === op.attribute.id))
          fail(`Attribute already exists: ${op.attribute.id}`);
        if (op.index > item.attributes.length) fail('Attribute insertion index is out of range');
        item.attributes.splice(op.index, 0, op.attribute);
        affected.add(op.attribute.id);
        break;
      }
      case 'update-attribute': {
        const item = entity(op.entityId);
        const index = item.attributes.findIndex((attribute) => attribute.id === op.attribute.id);
        if (index < 0) fail(`Unknown attribute: ${op.attribute.id}`);
        item.attributes[index] = op.attribute;
        affected.add(op.attribute.id);
        break;
      }
      case 'reorder-attributes': {
        const item = entity(op.entityId);
        const byId = new Map(item.attributes.map((attribute) => [attribute.id, attribute]));
        if (op.attributeIds.length !== byId.size || op.attributeIds.some((id) => !byId.has(id)))
          fail('Attribute order must be an exact permutation');
        item.attributes = op.attributeIds.map(
          (id) => item.attributes[item.attributes.findIndex((attribute) => attribute.id === id)]
        );
        break;
      }
      case 'delete-attribute': {
        const item = entity(op.entityId);
        if (!item.attributes.some((attribute) => attribute.id === op.attributeId))
          fail(`Unknown attribute: ${op.attributeId}`);
        item.attributes = item.attributes.filter((attribute) => attribute.id !== op.attributeId);
        affected.add(op.attributeId);
        removeRelationships((relationship) =>
          [relationship.source, relationship.target].some(
            (endpoint) => endpoint.entityId === op.entityId && endpoint.attributeId === op.attributeId
          )
        );
        break;
      }
      case 'add-relationship':
        if (result.relationships.some((item) => item.id === op.relationship.id))
          fail(`Relationship already exists: ${op.relationship.id}`);
        result.relationships.push(op.relationship);
        affected.add(op.relationship.id);
        break;
      case 'update-relationship': {
        const index = result.relationships.findIndex((item) => item.id === op.relationship.id);
        if (index < 0) fail(`Unknown relationship: ${op.relationship.id}`);
        result.relationships[index] = op.relationship;
        affected.add(op.relationship.id);
        break;
      }
      case 'delete-relationship':
        if (!result.relationships.some((item) => item.id === op.relationshipId))
          fail(`Unknown relationship: ${op.relationshipId}`);
        removeRelationships((item) => item.id === op.relationshipId);
        break;
      case 'auto-layout':
        for (const item of result.relationships) if (item.bends || item.labelPosition) affected.add(item.id);
        result = layoutErd(result, op.direction);
        for (const item of result.entities) affected.add(item.id);
        break;
    }
  }
  assertErd(result);
  return { data: result, affectedIds: [...affected], removedRelationshipIds: [...removed] };
}

function fail(message: string): never {
  throw new CanvasError('validation_error', message, 'validation');
}
