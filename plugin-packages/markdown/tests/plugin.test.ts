import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type {
  CanvasElement,
  ElementTypeDescriptor,
  PluginInvocationContext,
  PluginToolDescriptor,
  ServerPluginHost
} from '@agentcanvas/plugin-sdk';
import { DEFAULT_CANVAS_THEME } from '@agentcanvas/plugin-sdk';
import { validatePluginManifestStructure } from '@agentcanvas/plugin-testkit';
import { describe, expect, it, vi } from 'vitest';
import { importLegacyMarkdown } from '../src/legacy.js';
import { requiredMarkdownHeight } from '../src/markdown.js';
import plugin from '../src/server.mjs';
import { renderMarkdownCarouselSnapshot } from '../src/snapshot.js';

describe('Markdown plugin', () => {
  it('ships a conforming public manifest', () => {
    const manifest = JSON.parse(readFileSync(resolve(process.cwd(), 'agentcanvas.plugin.json'), 'utf8'));
    expect(validatePluginManifestStructure(manifest)).toEqual({ ok: true, issues: [] });
  });

  it('registers its element, tool, and migration', async () => {
    const registrations = { elements: [] as string[], tools: [] as string[], migrations: [] as string[] };
    const host = {
      registerElementType: (item: { name: string }) => registrations.elements.push(item.name),
      registerTool: (item: { name: string }) => registrations.tools.push(item.name),
      registerMigration: (item: { name: string }) => registrations.migrations.push(item.name),
      registerProcedure: vi.fn(),
      provideCapability: vi.fn(),
      consumeCapability: vi.fn(),
      config: {},
      kv: {},
      diagnostics: { emit: vi.fn() }
    } as unknown as ServerPluginHost;
    await plugin.activate(host);
    expect(registrations).toEqual({
      elements: ['document', 'carousel'],
      tools: ['add-document'],
      migrations: ['legacy-markdown-v1']
    });
  });

  it('validates, inspects, summarizes, and snapshots Markdown carousels', async () => {
    const elements: ElementTypeDescriptor[] = [];
    const host = {
      registerElementType: (item: ElementTypeDescriptor) => elements.push(item),
      registerTool: vi.fn(),
      registerMigration: vi.fn(),
      registerProcedure: vi.fn(),
      provideCapability: vi.fn(),
      consumeCapability: vi.fn(),
      config: {},
      kv: {},
      diagnostics: { emit: vi.fn() }
    } as unknown as ServerPluginHost;
    await plugin.activate(host);
    const carouselDescriptor = elements.find((element) => element.name === 'carousel') as ElementTypeDescriptor;
    const longMarkdown = `# First\n\n${'Long carousel content '.repeat(80)}`;
    const carousel = {
      id: 'carousel_1',
      type: 'agentcanvas.markdown/carousel',
      schemaVersion: 1,
      x: 0,
      y: 0,
      width: 360,
      height: 180,
      data: {
        slides: [
          { id: 'same', schemaVersion: 1, data: { markdown: longMarkdown }, frame: { x: 0, y: 0 } },
          { id: 'same', schemaVersion: 1, data: { markdown: '# Second' }, frame: { x: 400, y: 0 } }
        ],
        initialIndex: 2
      }
    } as CanvasElement;
    const validation = carouselDescriptor.validate?.(carousel, {
      pluginId: 'agentcanvas.markdown',
      type: carousel.type,
      schemaVersion: 1
    });
    expect(validation).toEqual([
      expect.objectContaining({ code: 'markdown_carousel_slide_id_duplicate' }),
      expect.objectContaining({ code: 'markdown_carousel_initial_index_invalid' })
    ]);
    expect(
      carouselDescriptor.inspect?.(carousel, {
        pluginId: 'agentcanvas.markdown',
        type: carousel.type,
        schemaVersion: 1
      })
    ).toContainEqual(expect.objectContaining({ code: 'markdown_carousel_slide_may_clip', path: '/data/slides/0' }));
    expect(carouselDescriptor.summarize({ ...carousel, data: { ...carousel.data, initialIndex: 0 } })).toEqual({
      title: expect.stringMatching(/^First/u),
      detail: '2 Markdown cards'
    });

    const snapshot = renderMarkdownCarouselSnapshot(
      { ...carousel, height: 300, data: { ...carousel.data, initialIndex: 1 } },
      DEFAULT_CANVAS_THEME
    );
    expect(snapshot.nodes).toContainEqual(expect.objectContaining({ kind: 'text', text: '2 / 2' }));
    expect(snapshot.nodes).toContainEqual(expect.objectContaining({ kind: 'text', text: 'Second' }));
  });

  it('imports the legacy Markdown field into canonical data', () => {
    expect(importLegacyMarkdown({ id: 'm1', type: 'markdown', x: 1, y: 2, markdown: '# Hello' }).element).toMatchObject(
      { id: 'm1', type: 'agentcanvas.markdown/document', schemaVersion: 1, data: { markdown: '# Hello' } }
    );
  });

  it('auto-sizes omitted heights and rejects accidental scrolling frames', async () => {
    const tools: PluginToolDescriptor[] = [];
    const elements: ElementTypeDescriptor[] = [];
    const host = {
      registerElementType: (item: ElementTypeDescriptor) => elements.push(item),
      registerTool: (item: PluginToolDescriptor) => tools.push(item),
      registerMigration: vi.fn(),
      registerProcedure: vi.fn(),
      provideCapability: vi.fn(),
      consumeCapability: vi.fn(),
      config: {},
      kv: {},
      diagnostics: { emit: vi.fn() }
    } as unknown as ServerPluginHost;
    await plugin.activate(host);
    const addDocument = tools.find((tool) => tool.name === 'add-document') as PluginToolDescriptor;
    const upsertElementReceipt = vi.fn(async (_canvasId: string, _element: CanvasElement) => ({
      canvasId: 'canvas_1',
      revision: 2,
      inspectionSummary: { errorCount: 0, warningCount: 0, infoCount: 0 }
    }));
    const context = { canvas: { upsertElementReceipt } } as unknown as PluginInvocationContext;
    const markdown = ['# Heading', '- One', '- Two', '- Three', '- Four', '- Five', '- Six', '- Seven'].join('\n');

    const output = await addDocument.invoke({ canvasId: 'canvas_1', x: 0, y: 0, markdown }, context);
    expect(output).toEqual({
      canvasId: 'canvas_1',
      elementId: expect.any(String),
      revision: 2,
      inspectionSummary: { errorCount: 0, warningCount: 0, infoCount: 0 }
    });
    expect(JSON.stringify(output)).not.toContain(markdown);
    expect(upsertElementReceipt.mock.calls[0]?.[1]).toEqual(expect.objectContaining({ height: expect.any(Number) }));
    expect((upsertElementReceipt.mock.calls[0]?.[1] as { height: number }).height).toBeGreaterThan(220);

    await expect(
      addDocument.invoke({ canvasId: 'canvas_1', x: 0, y: 0, height: 220, markdown }, context)
    ).rejects.toThrow('is likely to hide content');

    const undersized = {
      id: 'markdown_1',
      type: 'agentcanvas.markdown/document',
      schemaVersion: 1,
      x: 0,
      y: 0,
      width: 360,
      height: 220,
      data: { markdown }
    } as CanvasElement;
    expect(
      elements[0].inspect?.(undersized, {
        pluginId: 'agentcanvas.markdown',
        type: undersized.type,
        schemaVersion: 1
      })
    ).toEqual([expect.objectContaining({ code: 'markdown_content_may_clip' })]);

    upsertElementReceipt.mockClear();
    await addDocument.invoke({ canvasId: 'canvas_1', x: 0, y: 0, height: 220, markdown, allowScroll: true }, context);
    expect(upsertElementReceipt.mock.calls[0]?.[1]).toMatchObject({ data: { allowScroll: true } });

    upsertElementReceipt.mockClear();
    const taskTable = [
      '#### Proposed Tasks',
      '| Task | Owner |',
      '|------|-------|',
      '| Post in local groups & social media | Unassigned |',
      '| Collect volunteer skill profiles | Unassigned |',
      '| Prepare a safety briefing | Unassigned |',
      '| Test the workstation layout | Unassigned |'
    ].join('\n');
    await addDocument.invoke({ canvasId: 'canvas_1', x: 0, y: 0, width: 310, markdown: taskTable }, context);
    expect((upsertElementReceipt.mock.calls[0]?.[1] as { height: number }).height).toBeGreaterThan(300);
  });

  it('accounts for rendered styles and reports content beyond the automatic height limit', async () => {
    const definitions =
      '## 1. Agent definition\n\nA configured agent is its **saved model**, **standing prompt**, **permissions & skills**, and **primary/subagent mode**.\n\nA **session** is one run/conversation using that definition.\n\n**Astra:** standing instructions to plan, delegate implementation, review, and integrate.\n\n**DeepSeek v4.1 Flash:** a proposed worker model; exact availability is unverified.';
    const context =
      '## 2. Prompt & rule layers\n\n| Layer | Carries |\n|---|---|\n| Agent standing prompt | role & operating rules |\n| Per-task assignment | objective, scope & criteria |\n| Shared repo rules | local engineering constraints |\n\nThese layers apply **separately**. Astra’s system prompt is **not automatically inherited** by an implementation worker.';
    const review =
      '## 3. Reviewer brief\n\nGive the reviewer:\n\n- user objective & acceptance criteria\n- repository/worktree and base + implementation commits\n- decisions and constraints\n- test outcomes\n\nThen inspect the **diff**, surrounding code, callers, tests, and repository rules directly.';
    const style = { padding: 20, border: '2px solid #C9D4E3' };

    expect(requiredMarkdownHeight(definitions, 450, { ...style, fontSize: 17 })).toBeGreaterThan(340);
    expect(requiredMarkdownHeight(context, 450, { ...style, fontSize: 16 })).toBeGreaterThan(340);
    expect(requiredMarkdownHeight(review, 450, { ...style, fontSize: 16 })).toBeGreaterThan(340);

    const tools: PluginToolDescriptor[] = [];
    const elements: ElementTypeDescriptor[] = [];
    const host = {
      registerElementType: (item: ElementTypeDescriptor) => elements.push(item),
      registerTool: (item: PluginToolDescriptor) => tools.push(item),
      registerMigration: vi.fn(),
      registerProcedure: vi.fn(),
      provideCapability: vi.fn(),
      consumeCapability: vi.fn(),
      config: {},
      kv: {},
      diagnostics: { emit: vi.fn() }
    } as unknown as ServerPluginHost;
    await plugin.activate(host);
    const addDocument = tools[0];
    const contextWithReceipt = {
      canvas: {
        upsertElementReceipt: vi.fn(async () => ({
          canvasId: 'canvas_1',
          revision: 2,
          inspectionSummary: { errorCount: 0, warningCount: 0, infoCount: 0 }
        }))
      }
    } as unknown as PluginInvocationContext;
    await expect(
      addDocument.invoke(
        {
          canvasId: 'canvas_1',
          x: 0,
          y: 0,
          width: 450,
          height: 340,
          markdown: definitions,
          style: { ...style, fontSize: 17 }
        },
        contextWithReceipt
      )
    ).rejects.toThrow('is likely to hide content');

    const richMarkdown =
      '# Heading\n\nA wrapped paragraph with enough words to use several lines at a narrow width.\n\n- First list item\n- Second list item\n\n| A | B |\n|---|---|\n| one | two |\n\n```ts\nconst value = true;\n```\n\n![Preview](https://example.test/image.png)';
    expect(requiredMarkdownHeight(richMarkdown, 240, { fontSize: 18, padding: 24 })).toBeGreaterThan(
      requiredMarkdownHeight('A short paragraph.', 240, { fontSize: 18, padding: 24 }) + 400
    );

    const longMarkdown = Array.from(
      { length: 80 },
      (_, index) => `Paragraph ${index}: ${'long content '.repeat(12)}`
    ).join('\n\n');
    const issue = elements[0].inspect?.(
      {
        id: 'long',
        type: 'agentcanvas.markdown/document',
        schemaVersion: 1,
        x: 0,
        y: 0,
        width: 450,
        height: 1200,
        data: { markdown: longMarkdown }
      },
      { pluginId: 'agentcanvas.markdown', type: 'agentcanvas.markdown/document', schemaVersion: 1 }
    );
    expect(issue).toEqual([expect.objectContaining({ code: 'markdown_content_may_clip' })]);
    expect(
      elements[0].inspect?.(
        {
          id: 'long',
          type: 'agentcanvas.markdown/document',
          schemaVersion: 1,
          x: 0,
          y: 0,
          width: 450,
          height: 1200,
          data: { markdown: longMarkdown, allowScroll: true }
        },
        { pluginId: 'agentcanvas.markdown', type: 'agentcanvas.markdown/document', schemaVersion: 1 }
      )
    ).toEqual([]);
  });
});
