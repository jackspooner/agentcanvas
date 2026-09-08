import { DEFAULT_CANVAS_THEME, type SnapshotNode } from '@agentcanvas/extension-sdk';
import { CanvasError } from '@agentcanvas/core/errors';
import { describe, expect, it } from 'vitest';
import type { Cardinality, ErdData, ErdEntity, ErdOperation } from '../src/contracts.js';
import {
  applyErdOperations,
  assertErd,
  diagramGeometry,
  entityGeometry,
  layoutErd,
  renderErdScene,
  validateErd
} from '../src/erd/index.js';

const entity = (id: string, x = 0, y = 0): ErdEntity => ({
  id,
  name: id,
  x,
  y,
  attributes: [{ id: 'id', name: 'id', dataType: 'uuid', keys: ['PK'], nullable: null }]
});
const example = (): ErdData => ({
  title: 'Orders',
  entities: [entity('users'), entity('orders', 500, 100)],
  relationships: [
    {
      id: 'owns',
      source: { entityId: 'users', attributeId: 'id', cardinality: 'one' },
      target: { entityId: 'orders', cardinality: 'zero-or-many' },
      label: 'owns',
      identifying: false
    }
  ]
});
const flatten = (nodes: readonly SnapshotNode[]): SnapshotNode[] =>
  nodes.flatMap((node) => (node.kind === 'group' ? [node, ...flatten(node.children)] : [node]));

describe('native ERD validation and operations', () => {
  it('preserves explicit key and nullability meaning, permits self relations and local attribute IDs', () => {
    const data = example();
    data.relationships.push({
      ...data.relationships[0],
      id: 'self',
      target: { entityId: 'users', attributeId: 'id', cardinality: 'zero-or-one' }
    });
    expect(validateErd(data)).toEqual([]);
    const result = applyErdOperations(data, [
      { op: 'update-relationship', relationship: { ...data.relationships[0], identifying: true } }
    ]);
    expect(result.data.entities).toEqual(data.entities);
    expect(data.relationships[0].identifying).toBe(false);
  });

  it('rejects duplicate IDs in their actual scopes and dangling endpoints', () => {
    const data = example();
    data.entities.push(entity('users'));
    data.entities[1].attributes.push({ ...data.entities[1].attributes[0] });
    data.relationships.push({ ...data.relationships[0] });
    data.relationships[0].source.entityId = 'missing';
    data.relationships[0].target.attributeId = 'missing';
    const codes = validateErd(data).map((issue) => issue.code);
    expect(codes.filter((code) => code === 'duplicate_id')).toHaveLength(3);
    expect(codes).toContain('missing_entity');
    expect(codes).toContain('missing_attribute');
  });

  it.each([NaN, Infinity, -Infinity, 1_000_001])('rejects invalid coordinate %s', (x) => {
    const data = example();
    data.entities[0].x = x;
    expect(validateErd(data).length).toBeGreaterThan(0);
    expect(() => assertErd(data)).toThrow(CanvasError);
  });

  it('strictly bounds shapes, strings, attribute keys, and cardinalities', () => {
    for (const change of [
      (data: ErdData) => Object.assign(data, { extra: true }),
      (data: ErdData) => {
        data.title = 'x'.repeat(501);
      },
      (data: ErdData) => {
        data.entities[0].name = '';
      },
      (data: ErdData) => {
        data.entities[0].attributes[0].keys = ['PK', 'PK'];
      },
      (data: ErdData) => {
        data.relationships[0].source.cardinality = 'many' as Cardinality;
      }
    ]) {
      const data = example();
      change(data);
      expect(validateErd(data).length).toBeGreaterThan(0);
    }
  });

  it('enforces entity, per-entity attribute, total attribute, and relationship caps', () => {
    const data = example();
    data.entities = Array.from({ length: 100 }, (_, i) => entity(`e${i}`));
    data.relationships = [];
    expect(validateErd(data)).toEqual([]);
    data.entities.push(entity('overflow'));
    expect(validateErd(data).length).toBeGreaterThan(0);
    data.entities = [entity('one')];
    data.entities[0].attributes = Array.from({ length: 101 }, (_, i) => ({
      ...entity('e').attributes[0],
      id: `a${i}`
    }));
    expect(validateErd(data).length).toBeGreaterThan(0);
    data.entities = Array.from({ length: 11 }, (_, i) => ({
      ...entity(`e${i}`),
      attributes: data.entities[0].attributes.slice(0, 100)
    }));
    expect(validateErd(data).some((issue) => issue.code === 'limit')).toBe(true);
    const graph = example();
    graph.relationships = Array.from({ length: 201 }, (_, i) => ({ ...graph.relationships[0], id: `r${i}` }));
    expect(validateErd(graph).length).toBeGreaterThan(0);
  });

  it('updates titles, names, aliases, and exact attribute rows without aliasing input operations', () => {
    const data = example();
    const added = {
      ...data.entities[0].attributes[0],
      id: 'email',
      name: 'email',
      keys: ['UK' as const],
      nullable: false
    };
    const result = applyErdOperations(data, [
      { op: 'set-title', title: 'Accounts' },
      { op: 'update-entity', entityId: 'users', name: 'User', alias: 'account' },
      { op: 'move-entity', entityId: 'users', x: -30, y: 20 },
      { op: 'add-attribute', entityId: 'users', attribute: added, index: 0 },
      { op: 'reorder-attributes', entityId: 'users', attributeIds: ['id', 'email'] },
      { op: 'update-attribute', entityId: 'users', attribute: { ...added, comment: 'Unique email' } }
    ]);
    expect(result.data.title).toBe('Accounts');
    expect(result.data.entities[0]).toMatchObject({ name: 'User', alias: 'account', x: -30, y: 20 });
    expect(result.data.entities[0].attributes.map((item) => item.id)).toEqual(['id', 'email']);
    added.name = 'mutated';
    expect(result.data.entities[0].attributes[1].name).toBe('email');
    expect(data).toEqual(example());
  });

  it('cascades only incident entity and attribute relationships and reports removed IDs', () => {
    const data = example();
    data.relationships.push({
      ...data.relationships[0],
      id: 'entity-link',
      source: { entityId: 'users', cardinality: 'one' }
    });
    const deletedAttribute = applyErdOperations(data, [
      { op: 'delete-attribute', entityId: 'users', attributeId: 'id' }
    ]);
    expect(deletedAttribute.removedRelationshipIds).toEqual(['owns']);
    expect(deletedAttribute.data.relationships.map((item) => item.id)).toEqual(['entity-link']);
    const deletedEntity = applyErdOperations(data, [{ op: 'delete-entity', entityId: 'users' }]);
    expect(deletedEntity.removedRelationshipIds).toEqual(['owns', 'entity-link']);
    expect(deletedEntity.data.entities.map((item) => item.id)).toEqual(['orders']);
  });

  it('applies creates and explicit relationship deletion', () => {
    const data: ErdData = { title: '', entities: [], relationships: [] };
    const graph = example();
    const result = applyErdOperations(data, [
      ...graph.entities.map((item) => ({ op: 'add-entity' as const, entity: item })),
      { op: 'add-relationship', relationship: graph.relationships[0] },
      { op: 'delete-relationship', relationshipId: 'owns' }
    ]);
    expect(result.data.entities).toEqual(graph.entities);
    expect(result.removedRelationshipIds).toEqual(['owns']);
  });

  it.each([
    { op: 'move-entity', entityId: 'missing', x: 1, y: 2 },
    { op: 'add-entity', entity: entity('users') },
    { op: 'reorder-attributes', entityId: 'users', attributeIds: [] },
    { op: 'reorder-attributes', entityId: 'users', attributeIds: ['id', 'id'] },
    { op: 'add-attribute', entityId: 'users', attribute: entity('e').attributes[0], index: 0 },
    { op: 'delete-attribute', entityId: 'users', attributeId: 'missing' },
    { op: 'delete-relationship', relationshipId: 'missing' },
    { op: 'set-title', title: 'ok', unexpected: true },
    { op: 'arbitrary-code', code: 'bad' }
  ])('fails an entire batch atomically for invalid operation $op', (invalid) => {
    const data = example();
    expect(() => applyErdOperations(data, [{ op: 'set-title', title: 'Changed' }, invalid as ErdOperation])).toThrow(
      CanvasError
    );
    expect(data).toEqual(example());
  });
});

describe('native shared geometry and vector scenes', () => {
  it('anchors relationship endpoints to named rows and preserves negative-position bounds', () => {
    const data = example();
    data.entities[0].x = -300;
    data.entities[0].y = -100;
    const geometry = diagramGeometry(data);
    expect(geometry.relationships[0].points[0].y).toBe(geometry.entities[0].rows[0].centerY);
    expect(geometry.bounds.x).toBeLessThan(-300);
    expect(geometry.bounds.y).toBeLessThan(-100);
    expect(entityGeometry({ ...entity('a'), alias: 'Alias' }).headerHeight).toBe(56);
  });

  it('routes parallel and self relationships distinctly and deterministically', () => {
    const data = example();
    data.entities[1].y = 0;
    data.relationships[0].source.attributeId = undefined;
    data.relationships.push({ ...data.relationships[0], id: 'second' });
    data.relationships.push({ ...data.relationships[0], id: 'self', target: data.relationships[0].source });
    const geometry = diagramGeometry(data);
    expect(geometry.relationships[0].points).not.toEqual(geometry.relationships[1].points);
    expect(geometry.relationships[2].points.length).toBeGreaterThan(4);
    const reordered = diagramGeometry({ ...data, relationships: [...data.relationships].reverse() });
    for (const relationship of geometry.relationships)
      expect(reordered.relationships.find((item) => item.id === relationship.id)).toEqual(relationship);
    expect(JSON.stringify(geometry)).not.toMatch(/NaN|Infinity/);
  });

  it.each([
    'zero-or-one',
    'one',
    'zero-or-many',
    'one-or-many'
  ] as const)('renders unambiguous %s cardinality markers', (cardinality) => {
    const data = example();
    data.relationships[0].source.cardinality = cardinality;
    const markers = diagramGeometry(data).relationships[0].sourceMarkers;
    expect(markers.filter((node) => node.kind === 'ellipse')).toHaveLength(cardinality.startsWith('zero') ? 1 : 0);
    expect(markers.length).toBe(cardinality.endsWith('many') ? 4 : 2);
  });

  it('uses theme tokens, selection IDs, explicit NULL state and dashed nonidentifying primitives', () => {
    const scene = renderErdScene(example(), DEFAULT_CANVAS_THEME);
    const all = flatten(scene.nodes);
    expect(all.map((node) => node.id)).toContain('entity:users');
    expect(all.map((node) => node.id)).toContain('relationship:owns');
    expect(all.map((node) => node.id)).toContain('attribute:users:id');
    expect(all.some((node) => node.kind === 'text' && node.text === '?')).toBe(true);
    expect(all.some((node) => node.kind === 'line' && node.dash?.[0] === 6)).toBe(true);
    expect(all.some((node) => node.kind === 'rect' && node.fill === DEFAULT_CANVAS_THEME.colors.highlight)).toBe(true);
    expect(all.some((node) => node.kind === 'imageHandle')).toBe(false);
  });

  it('lays out disconnected nodes, multiple edges and self edges with dimensions and top-left coordinates', () => {
    const data = example();
    data.entities.push(entity('isolated'));
    data.relationships.push(
      { ...data.relationships[0], id: 'duplicate' },
      { ...data.relationships[0], id: 'self', target: data.relationships[0].source }
    );
    for (const direction of ['LR', 'TB'] as const) {
      const result = layoutErd(data, direction);
      expect(layoutErd(data, direction)).toEqual(result);
      const shuffled = layoutErd(
        { ...data, entities: [...data.entities].reverse(), relationships: [...data.relationships].reverse() },
        direction
      );
      for (const item of result.entities) expect(shuffled.entities.find((other) => other.id === item.id)).toEqual(item);
      expect(result.relationships).toEqual(data.relationships);
      expect(validateErd(result)).toEqual([]);
      const frames = result.entities.map(entityGeometry);
      for (let i = 0; i < frames.length; i++)
        for (let j = i + 1; j < frames.length; j++) {
          const a = frames[i];
          const b = frames[j];
          expect(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y).toBe(
            true
          );
        }
      expect(applyErdOperations(data, [{ op: 'auto-layout', direction }]).data).toEqual(result);
    }
    expect(data.entities[0].x).toBe(0);
  });

  it('handles an empty diagram without nonfinite bounds', () => {
    const data: ErdData = { title: '', entities: [], relationships: [] };
    expect(layoutErd(data)).toEqual(data);
    expect(renderErdScene(data, DEFAULT_CANVAS_THEME)).toEqual({
      nodes: [],
      bounds: { x: 0, y: 0, width: 320, height: 96 }
    });
  });

  it('keeps the maximum graph within host snapshot node, ID, text, and coordinate limits', () => {
    const data: ErdData = { title: 'T'.repeat(500), entities: [], relationships: [] };
    data.entities = Array.from({ length: 100 }, (_, index) => ({
      ...entity(`e${index}`.padEnd(58, 'x'), index % 2 ? 100000 : -100000, 100000),
      name: 'n'.repeat(200),
      alias: 'a'.repeat(200),
      attributes: Array.from({ length: 10 }, (_, row) => ({
        id: `a${row}`.padEnd(58, 'x'),
        name: '😀'.repeat(100),
        dataType: 't'.repeat(200),
        keys: ['PK', 'FK', 'UK'],
        nullable: false
      }))
    }));
    data.relationships = Array.from({ length: 200 }, (_, index) => ({
      id: `r${index}`.padEnd(58, 'x'),
      source: { entityId: data.entities[0].id, cardinality: 'one-or-many' },
      target: { entityId: data.entities[1].id, cardinality: 'zero-or-many' },
      label: 'L'.repeat(500),
      identifying: false
    }));
    const nodes = flatten(renderErdScene(data, DEFAULT_CANVAS_THEME).nodes);
    expect(nodes.length).toBeLessThanOrEqual(10000);
    expect(nodes.reduce((sum, node) => sum + (node.kind === 'text' ? node.text.length : 0), 0)).toBeLessThanOrEqual(
      100000
    );
    for (const node of nodes) {
      expect(node.id?.length ?? 0).toBeLessThanOrEqual(128);
      for (const value of Object.values(node))
        if (typeof value === 'number') expect(Math.abs(value)).toBeLessThanOrEqual(1000000);
    }
  });
});
