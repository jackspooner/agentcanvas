import { readFile } from 'node:fs/promises';
import { DEFAULT_CANVAS_THEME } from '@agentcanvas/extension-sdk';
import { chromium } from 'playwright';
import { describe, expect, it } from 'vitest';
import { exportErdMermaid } from '../src/mermaid/export.js';

// Exercise the emitted module and bundled IIFE; run the extension build before this optional suite.
const { convertMermaidErd, renderMermaidPng, validateMermaid } = (await import(
  new URL('../dist/mermaid/headless.js', import.meta.url).href
)) as typeof import('../src/mermaid/headless.js');

const erd =
  'erDiagram\n CUSTOMER[Customer] {\n int id PK, UK "identity"\n string email FK\n }\n CUSTOMER ||--o{ ORDER : places';

describe('pinned Mermaid in real Chromium', () => {
  it('parses and renders all supported diagram families', async () => {
    for (const source of [
      'flowchart LR\nA[click here]-->B',
      'sequenceDiagram\nA->>B: hello',
      'classDiagram\nclass Customer',
      'stateDiagram-v2\n[*] --> Ready',
      erd
    ]) {
      expect((await validateMermaid(source)).diagramType).toBeTruthy();
      const png = await renderMermaidPng(source, DEFAULT_CANVAS_THEME, 600, 400);
      expect([...png.bytes.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
      expect(png.width).toBeGreaterThan(0);
      expect(png.width).toBeLessThanOrEqual(1200);
      expect(png.height).toBeLessThanOrEqual(800);
      expect(png.diagnostics).toEqual([]);
    }
  });
  it('adapts parser IDs, asymmetric cardinalities, keys, aliases and comments and round trips', async () => {
    const { data, warnings } = await convertMermaidErd(erd);
    expect(warnings).toEqual([]);
    expect(data.entities[0]).toMatchObject({
      id: 'entity-1',
      name: 'CUSTOMER',
      alias: 'Customer',
      attributes: [
        { name: 'id', keys: ['PK', 'UK'], comment: 'identity' },
        { name: 'email', keys: ['FK'] }
      ]
    });
    expect(data.relationships[0]).toMatchObject({
      source: { entityId: 'entity-1', cardinality: 'one' },
      target: { entityId: 'entity-2', cardinality: 'zero-or-many' },
      identifying: true
    });
    data.title = 'Customer catalog';
    const exported = exportErdMermaid(data);
    expect(exported.warnings.map((warning) => warning.code)).toContain('mermaid.erd.title');
    expect(await validateMermaid(exported.source)).toEqual({ diagramType: 'er' });
    expect((await convertMermaidErd(exported.source)).data).toEqual({ ...data, title: '' });
  });
  it('reports style, comment, and direction losses and rejects subgraphs', async () => {
    const { warnings } = await convertMermaidErd(
      'erDiagram\n%% note\ndirection LR\nA ||--o{ B : has\nstyle A fill:#ff0000'
    );
    expect(warnings.map((warning: { code: string }) => warning.code)).toEqual(
      expect.arrayContaining(['mermaid.erd.comments', 'mermaid.erd.direction', 'mermaid.erd.styles'])
    );
    await expect(convertMermaidErd('erDiagram\nsubgraph group[Group]\nA\nend')).rejects.toThrow('subgraphs');
  });
  it('bounds physical PNG pixels and separates cancelled coalesced callers', async () => {
    const source = 'flowchart LR\nUniqueA --> UniqueB';
    const controller = new AbortController();
    const cancelled = validateMermaid(source, controller.signal);
    const survivor = validateMermaid(source);
    const rejection = expect(cancelled).rejects.toThrow();
    controller.abort();
    await rejection;
    expect((await survivor).diagramType).toBeTruthy();
    const png = await renderMermaidPng(source, DEFAULT_CANVAS_THEME, 100_000, 100_000);
    expect(png.width).toBeLessThanOrEqual(4096);
    expect(png.height).toBeLessThanOrEqual(4096);
    expect(png.width * png.height).toBeLessThanOrEqual(16_000_000);
    expect(png.diagnostics).toEqual([expect.objectContaining({ code: 'mermaid.render.resolution-limit' })]);
    png.bytes[0] = 0;
    expect((await renderMermaidPng(source, DEFAULT_CANVAS_THEME, 100_000, 100_000)).bytes[0]).toBe(137);
  });
  it('cleans scratch DOM after errors and serializes different themes without network requests', async () => {
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage();
      const requests: string[] = [];
      await page.route('**/*', (route) => {
        requests.push(route.request().url());
        return route.abort();
      });
      await page.setContent('<body><div id="unrelated">Keep me</div></body>');
      await page.addScriptTag({
        content: await readFile(new URL('../dist/mermaid/headless/engine.js', import.meta.url), 'utf8')
      });
      const result = await page.evaluate(async (theme) => {
        const engine = (
          globalThis as unknown as { AgentCanvasDiagramsEngine: typeof import('../src/mermaid/engine.js') }
        ).AgentCanvasDiagramsEngine;
        let failed = false;
        try {
          await engine.renderMermaid('flowchart LR\nA[', theme);
        } catch {
          failed = true;
        }
        const outputs = await Promise.all([
          engine.renderMermaid('flowchart LR\nA-->B', theme),
          engine.renderMermaid('flowchart LR\nA-->B', { ...theme, colors: { ...theme.colors, surface: '#112233' } })
        ]);
        await engine.renderMermaid('flowchart LR\nA["<img src=https://example.com/image.png>"] --> B', theme);
        return {
          failed,
          children: document.body.children.length,
          preserved: document.querySelector('#unrelated')?.textContent,
          first: outputs[0].svg.includes('#ffffff'),
          second: outputs[1].svg.includes('#112233')
        };
      }, DEFAULT_CANVAS_THEME);
      expect(result).toEqual({ failed: true, children: 1, preserved: 'Keep me', first: true, second: true });
      expect(requests).toEqual([]);
    } finally {
      await browser.close();
    }
  });
});
