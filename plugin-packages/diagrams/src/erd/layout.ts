import { graphlib, layout } from '@dagrejs/dagre';
import type { ErdData } from '../contracts.js';
import { entityGeometry } from './geometry.js';
import { assertErd } from './validation.js';
import { CanvasError } from '@agentcanvas/core/errors';

/** Dagre returns centers; canonical ERD coordinates always store each entity's top-left. */
export function layoutErd(data: ErdData, direction: 'LR' | 'TB' = 'LR'): ErdData {
  assertErd(data);
  if (direction !== 'LR' && direction !== 'TB')
    throw new CanvasError('validation_error', 'Layout direction must be LR or TB', 'validation');
  const graph = new graphlib.Graph({ multigraph: true });
  graph.setGraph({ rankdir: direction, nodesep: 48, ranksep: 96, marginx: 24, marginy: 24 });
  graph.setDefaultEdgeLabel(() => ({}));
  for (const entity of [...data.entities].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
    const { width, height } = entityGeometry(entity);
    graph.setNode(entity.id, { width, height });
  }
  for (const relationship of [...data.relationships].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
    graph.setEdge(relationship.source.entityId, relationship.target.entityId, {}, relationship.id);
  }
  layout(graph);
  const result = structuredClone(data);
  for (const entity of result.entities) {
    const node = graph.node(entity.id);
    entity.x = node.x - node.width / 2;
    entity.y = node.y - node.height / 2;
  }
  assertErd(result);
  return result;
}
