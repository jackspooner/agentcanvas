import { expect, it } from 'vitest';
import { DEFAULT_CANVAS_THEME, type SnapshotNode } from '@agentcanvas/extension-sdk';
import type { ErdData } from '../src/contracts.js';
import { applyErdOperations, diagramGeometry, renderErdScene, validateErd } from '../src/erd/index.js';
import { validateMermaidData } from '../src/mermaid/policy.js';

const data: ErdData = {
  title: 'Boxes',
  entities: [
    { id: 'a', name: 'A', x: 0, y: 0, attributes: [] },
    { id: 'b', name: 'B', x: 500, y: 0, attributes: [] }
  ],
  relationships: [
    {
      id: 'r',
      source: { entityId: 'a', cardinality: 'one' },
      target: { entityId: 'b', cardinality: 'zero-or-many' },
      label: 'connects',
      identifying: false
    }
  ]
};
const flatten = (nodes: readonly SnapshotNode[]): SnapshotNode[] =>
  nodes.flatMap((node) => (node.kind === 'group' ? [node, ...flatten(node.children)] : [node]));
it('persists dimensions, appearance and routing atomically, and resets to current theme', () => {
  const changed = applyErdOperations(data, [
    {
      op: 'present-entity',
      entityId: 'a',
      presentation: { width: 400, height: 150, appearance: { fill: '#ff0000', fontSize: 18, borderStyle: 'dotted' } }
    },
    {
      op: 'present-relationship',
      relationshipId: 'r',
      presentation: {
        bends: [{ x: 430, y: 150 }],
        labelPosition: { x: 450, y: 170 },
        appearance: { borderColor: '#0000ff' }
      }
    }
  ]);
  expect(data.entities[0].width).toBeUndefined();
  const geometry = diagramGeometry(changed.data);
  expect(geometry.entities[0]).toMatchObject({ width: 400, height: 150 });
  expect(geometry.relationships[0]).toMatchObject({ label: { x: 450, y: 170 } });
  expect(geometry.relationships[0].points).toContainEqual({ x: 430, y: 150 });
  const nodes = flatten(renderErdScene(changed.data, DEFAULT_CANVAS_THEME).nodes);
  expect(nodes.some((node) => node.kind === 'rect' && node.fill === '#ff0000')).toBe(true);
  expect(nodes.some((node) => node.kind === 'line' && node.dash?.[0] === 2)).toBe(true);
  const reset = applyErdOperations(changed.data, [
    { op: 'present-entity', entityId: 'a', presentation: {} },
    { op: 'present-relationship', relationshipId: 'r', presentation: {} }
  ]);
  expect(reset.data).toEqual(data);
  expect(() =>
    applyErdOperations(data, [
      { op: 'move-entity', entityId: 'a', x: 99, y: 20 },
      { op: 'present-entity', entityId: 'missing', presentation: { width: 400 } }
    ])
  ).toThrow();
  expect(data.entities[0].x).toBe(0);
});
it('rejects unsafe appearance, invalid size/coordinates and stale Mermaid presentation sources', () => {
  for (const appearance of [
    { fill: 'url(https://invalid)' },
    { fontFamily: 'url(x)' },
    { fontSize: Infinity },
    { borderWidth: -1 }
  ])
    expect(
      validateErd({ ...data, entities: [{ ...data.entities[0], appearance }, data.entities[1]] }).length
    ).toBeGreaterThan(0);
  const source = 'flowchart LR\nA-->B';
  expect(
    validateMermaidData({ title: '', source, presentation: { source, nodes: [{ id: 'A', width: 100 }], edges: [] } })
  ).toEqual([]);
  expect(
    validateMermaidData({ title: '', source, presentation: { source: 'flowchart LR\nA', nodes: [], edges: [] } }).map(
      (issue) => issue.code
    )
  ).toContain('mermaid.presentation.source');
  expect(
    validateMermaidData({
      title: '',
      source,
      presentation: { source, nodes: [{ id: 'A' }, { id: 'A' }], edges: [] }
    }).map((issue) => issue.code)
  ).toContain('mermaid.presentation.duplicate');
});

it('keeps maximum presentation complexity within native snapshot safety budgets', () => {
  const maximum: ErdData = {
    title: 'T'.repeat(500),
    entities: Array.from({ length: 100 }, (_, index) => ({
      id: `e${index}`,
      name: 'N'.repeat(200),
      alias: 'A'.repeat(200),
      x: (index % 20) * 5000,
      y: Math.floor(index / 20) * 10000,
      width: 4096,
      height: 8192,
      appearance: { borderStyle: 'dashed', fontSize: 48 },
      attributes: Array.from({ length: 10 }, (_, row) => ({
        id: `a${row}`,
        name: 'N'.repeat(200),
        dataType: 'T'.repeat(200),
        keys: ['PK', 'FK', 'UK'],
        nullable: false
      }))
    })),
    relationships: Array.from({ length: 200 }, (_, index) => ({
      id: `r${index}`,
      source: { entityId: 'e0', cardinality: 'one-or-many' },
      target: { entityId: 'e1', cardinality: 'zero-or-many' },
      label: 'L'.repeat(500),
      identifying: false,
      ...(index < 40
        ? { bends: Array.from({ length: 15 }, (_, bend) => ({ x: 4300 + bend * 10, y: 1000 + bend * 100 })) }
        : {})
    }))
  };
  expect(validateErd(maximum)).toEqual([]);
  const nodes = flatten(renderErdScene(maximum, DEFAULT_CANVAS_THEME).nodes);
  expect(nodes.length).toBeLessThanOrEqual(10000);
  expect(nodes.reduce((sum, node) => sum + (node.kind === 'text' ? node.text.length : 0), 0)).toBeLessThanOrEqual(
    100000
  );
  maximum.relationships[40].bends = [{ x: 1, y: 2 }];
  expect(validateErd(maximum).map((issue) => issue.code)).toContain('scene_limit');
});
