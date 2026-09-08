import { CanvasError } from '@agentcanvas/core/errors';
import type { ValidateFunction } from 'ajv';
import type { DiagramIssue, ErdData, ErdOperation } from '../contracts.js';
import { ERD_LIMITS } from '../erd-schemas.js';
import { validShape as validateShape, validOperation as validateOperation } from './schema-validators.js';

const validShape = validateShape as ValidateFunction<ErdData>;
const validOperation = validateOperation as ValidateFunction<ErdOperation>;

export function validateErd(value: unknown): DiagramIssue[] {
  if (!validShape(value))
    return (validShape.errors ?? []).map((error) => ({
      path: error.instancePath || '/',
      code: error.keyword,
      message: error.message ?? 'Invalid ERD data'
    }));
  const issues: DiagramIssue[] = [];
  const add = (path: string, code: string, message: string) => issues.push({ path, code, message });
  const entities = new Map(value.entities.map((entity) => [entity.id, entity]));
  const seen = new Set<string>();
  let attributeCount = 0;
  value.entities.forEach((entity, index) => {
    if (seen.has(entity.id)) add(`/entities/${index}/id`, 'duplicate_id', `Duplicate entity ID: ${entity.id}`);
    seen.add(entity.id);
    const attributes = new Set<string>();
    attributeCount += entity.attributes.length;
    entity.attributes.forEach((attribute, row) => {
      if (attributes.has(attribute.id))
        add(`/entities/${index}/attributes/${row}/id`, 'duplicate_id', `Duplicate attribute ID: ${attribute.id}`);
      attributes.add(attribute.id);
    });
  });
  if (attributeCount > ERD_LIMITS.attributes)
    add('/entities', 'limit', `At most ${ERD_LIMITS.attributes} attributes are allowed in total`);
  seen.clear();
  value.relationships.forEach((relationship, index) => {
    if (seen.has(relationship.id))
      add(`/relationships/${index}/id`, 'duplicate_id', `Duplicate relationship ID: ${relationship.id}`);
    seen.add(relationship.id);
    for (const side of ['source', 'target'] as const) {
      const endpoint = relationship[side];
      const entity = entities.get(endpoint.entityId);
      if (!entity)
        add(`/relationships/${index}/${side}/entityId`, 'missing_entity', `Unknown entity: ${endpoint.entityId}`);
      else if (
        endpoint.attributeId !== undefined &&
        !entity.attributes.some((attribute) => attribute.id === endpoint.attributeId)
      ) {
        add(
          `/relationships/${index}/${side}/attributeId`,
          'missing_attribute',
          `Unknown attribute in ${entity.id}: ${endpoint.attributeId}`
        );
      }
    }
  });
  return issues;
}

export function assertErd(value: unknown): asserts value is ErdData {
  const issues = validateErd(value);
  if (issues.length)
    throw new CanvasError(
      'validation_error',
      issues
        .slice(0, 20)
        .map((issue) => `${issue.path}: ${issue.message}`)
        .join('; ')
        .slice(0, 4000),
      'validation'
    );
}

export function assertErdOperation(value: unknown): asserts value is ErdOperation {
  if (!validOperation(value))
    throw new CanvasError(
      'validation_error',
      `Invalid ERD operation: ${(validOperation.errors ?? [])
        .slice(0, 20)
        .map((error) => `${error.instancePath || '/'} ${error.message}`)
        .join('; ')
        .slice(0, 4000)}`,
      'validation'
    );
}
