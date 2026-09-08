import { describe, expect, it } from 'vitest';
import type { ErdData } from '../src/contracts.js';
import { exportErdMermaid } from '../src/mermaid/export.js';
import { validateMermaidSource } from '../src/mermaid/policy.js';

describe('Mermaid source policy', () => {
  it('accepts all five families and labels containing click', () => {
    for (const source of [
      'flowchart LR\nA[click here]-->B',
      'sequenceDiagram\nA->>B: click here',
      'classDiagram\nclass click',
      'stateDiagram-v2\n[*] --> click',
      'erDiagram\nclick ||--o{ B : click'
    ])
      expect(validateMermaidSource(source)).toEqual([]);
  });
  it('rejects unsupported and unsafe sources without mistaking quoted labels for commands', () => {
    for (const source of [
      '',
      'pie\n"a":1',
      'flowchart LR\n%%{init: {}}%%\nA',
      '---\nconfig: {}\n---\nflowchart LR',
      'flowchart LR\nclick A "https://example.com"',
      'flowchart LR\nA@{ img: "https://example.com/a.png" }',
      'flowchart LR\nA@{ "img": "https://example.com/a.png" }',
      'flowchart LR\nstyle A fill:url(https://example.com/a)',
      'flowchart LR\nstyle A fill:u\\72l(https://example.com/a)',
      `flowchart LR\n${'A'.repeat(20_001)}`
    ])
      expect(validateMermaidSource(source).length).toBeGreaterThan(0);
    expect(validateMermaidSource('flowchart LR\nA["click A url(x)"]')).toEqual([]);
  });
});

describe('native ER export', () => {
  const data: ErdData = {
    title: 'Catalog',
    entities: [
      {
        id: 'a',
        name: 'Customer',
        alias: 'Customers',
        x: 0,
        y: 0,
        attributes: [
          { id: 'pk', name: 'id', dataType: 'int', keys: ['PK', 'UK'], nullable: false, comment: 'identity' }
        ]
      },
      { id: 'b', name: 'Order', x: 0, y: 0, attributes: [] }
    ],
    relationships: [
      {
        id: 'r',
        source: { entityId: 'a', attributeId: 'pk', cardinality: 'one' },
        target: { entityId: 'b', cardinality: 'zero-or-many' },
        label: 'places',
        identifying: false
      }
    ]
  };
  it('preserves representable values and reports lossy fields', () => {
    const result = exportErdMermaid(data);
    expect(result.source).toContain('int id PK, UK "identity"');
    expect(result.source).toContain('"Customer" ||..o{ "Order" : "places"');
    expect(result.warnings.map((warning) => warning.code)).toEqual([
      'mermaid.erd.title',
      'mermaid.erd.nullability',
      'mermaid.erd.attribute-endpoint',
      'mermaid.erd.layout'
    ]);
  });
  it('fails rather than silently sanitizing unrepresentable values', () => {
    const copy = structuredClone(data);
    copy.entities[0].name = 'A"B';
    expect(() => exportErdMermaid(copy)).toThrow('cannot preserve');
    copy.entities[0].name = 'Order';
    expect(() => exportErdMermaid(copy)).toThrow('same name');
  });
});
