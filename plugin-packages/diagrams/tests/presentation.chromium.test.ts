import { readFile } from 'node:fs/promises';
import { DEFAULT_CANVAS_THEME } from '@agentcanvas/extension-sdk';
import { chromium } from 'playwright';
import { expect, it } from 'vitest';
import type { MermaidPresentation } from '../src/contracts.js';

it('edits all five pinned renderers with stable identities and identical source across repeated renders', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent('<html><body></body></html>');
    await page.addScriptTag({
      content: await readFile(new URL('../dist/headless/engine.js', import.meta.url), 'utf8')
    });
    for (const source of [
      'flowchart LR\nA[First] -->|label| B[Second]',
      'classDiagram\nA "1" --> "*" B : label',
      'stateDiagram-v2\nA --> B : label',
      'erDiagram\nA ||--o{ B : label',
      'sequenceDiagram\nAlice->>Bob: label'
    ]) {
      const result = await page.evaluate(
        async ({ source, theme }) => {
          const engine = (
            globalThis as unknown as { AgentCanvasDiagramsEngine: typeof import('../src/mermaid/engine.js') }
          ).AgentCanvasDiagramsEngine;
          const base = await engine.renderMermaid(source, theme, undefined, undefined, true);
          const layout = base.layout!;
          const presentation: MermaidPresentation = {
            source,
            nodes: [
              {
                id: layout.nodes[0].id,
                x: 300,
                ...(base.diagramType === 'sequence' ? {} : { y: 400 }),
                width: 250,
                height: 150,
                appearance: { fill: '#aa3344', borderColor: '#3344aa', fontSize: 18 }
              }
            ],
            edges: [
              {
                id: layout.edges[0].id,
                bends: [{ x: 600, y: 500 }],
                labelPosition: { x: 700, y: 500 },
                appearance: { borderColor: '#112233' }
              }
            ]
          };
          const moved = await engine.renderMermaid(source, theme, undefined, presentation, true);
          const again = await engine.renderMermaid(source, theme, undefined, presentation, true);
          document.body.innerHTML = moved.svg;
          const shapes = [...document.querySelectorAll('svg rect,svg path,svg line,svg polygon')];
          return {
            layout: moved.layout,
            again: again.layout,
            svgHasColor: shapes.some((shape) => getComputedStyle(shape).fill === 'rgb(170, 51, 68)'),
            svgHasEdgeColor: shapes.some((shape) => getComputedStyle(shape).stroke === 'rgb(17, 34, 51)'),
            originalSource: presentation.source
          };
        },
        { source, theme: DEFAULT_CANVAS_THEME }
      );
      expect(result.layout).toEqual(result.again);
      expect(result.layout?.nodes[0]).toMatchObject({ x: 300, width: 250, height: 150 });
      expect(result.layout?.edges[0]).toMatchObject({ labelPosition: { x: 700, y: 500 } });
      expect(result.layout?.edges[0].points).toContainEqual({ x: 600, y: 500 });
      expect(result.svgHasColor && result.svgHasEdgeColor).toBe(true);
      expect(result.originalSource).toBe(source);
    }
  } finally {
    await browser.close();
  }
});

it('validates presentation targets and source binding and renders actual PNGs with overrides', async () => {
  const { inspectMermaidLayout, renderMermaidPng } = (await import(
    new URL('../dist/mermaid/headless.js', import.meta.url).href
  )) as typeof import('../src/mermaid/headless.js');
  const source = 'flowchart LR\nA-->B';
  const original = await renderMermaidPng(source, DEFAULT_CANVAS_THEME, 600, 400);
  const inspected = await inspectMermaidLayout(source, DEFAULT_CANVAS_THEME);
  const presentation: MermaidPresentation = {
    source,
    nodes: [
      { id: inspected.layout.nodes[0].id, x: 350, y: 300, width: 300, height: 150, appearance: { fill: '#aa3344' } }
    ],
    edges: []
  };
  const changed = await renderMermaidPng(source, DEFAULT_CANVAS_THEME, 600, 400, undefined, presentation);
  expect([...changed.bytes.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  expect(changed.bytes).not.toEqual(original.bytes);
  expect(changed.width).toBeLessThanOrEqual(1200);
  await expect(
    inspectMermaidLayout(source, DEFAULT_CANVAS_THEME, undefined, {
      ...presentation,
      nodes: [{ id: 'missing', x: 50 }]
    })
  ).rejects.toThrow('Unknown nodes');
  await expect(
    inspectMermaidLayout(source, DEFAULT_CANVAS_THEME, undefined, { ...presentation, source: 'flowchart LR\nA' })
  ).rejects.toThrow('source changed');
  const sequence = 'sequenceDiagram\nA->>B: first\nB->>A: second';
  const base = await inspectMermaidLayout(sequence, DEFAULT_CANVAS_THEME);
  await expect(
    inspectMermaidLayout(sequence, DEFAULT_CANVAS_THEME, undefined, {
      source: sequence,
      nodes: [{ id: base.layout.nodes[0].id, y: 300 }],
      edges: []
    })
  ).rejects.toThrow('horizontally');
});

it('retains aliases, parallel and self connectors in the visual projection', async () => {
  const { inspectMermaidLayout } = (await import(
    new URL('../dist/mermaid/headless.js', import.meta.url).href
  )) as typeof import('../src/mermaid/headless.js');
  for (const source of [
    'graph LR\nA-->A\nA-->B\nA-->B',
    'stateDiagram\nA --> B : next',
    'classDiagram\nA --> A : self\nA --> B : one\nA --> B : two',
    'erDiagram\nA[Alias]\nA ||--o{ A : self\nA ||--o{ B : owns\nA ||--o{ B : also',
    'sequenceDiagram\nactor A\nparticipant B\nA->>A: self\nA->>B: next'
  ]) {
    const base = await inspectMermaidLayout(source, DEFAULT_CANVAS_THEME);
    expect(new Set(base.layout.nodes.map((item) => item.id)).size).toBe(base.layout.nodes.length);
    expect(new Set(base.layout.edges.map((item) => item.id)).size).toBe(base.layout.edges.length);
    const node = base.layout.nodes[0];
    const moved = await inspectMermaidLayout(source, DEFAULT_CANVAS_THEME, undefined, {
      source,
      nodes: [{ id: node.id, x: node.x + 40 }],
      edges: []
    });
    expect(moved.layout.edges.length).toBe(base.layout.edges.length);
    expect(
      moved.layout.edges.every((edge) =>
        edge.points.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y))
      )
    ).toBe(true);
  }
});
