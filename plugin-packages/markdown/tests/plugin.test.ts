import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type {
  CanvasElement,
  ElementTypeDescriptor,
  PluginInvocationContext,
  PluginToolDescriptor,
  ServerPluginHost
} from '@agentcanvas/plugin-sdk';
import { validatePluginManifestStructure } from '@agentcanvas/plugin-testkit';
import { describe, expect, it, vi } from 'vitest';
import { importLegacyMarkdown } from '../src/legacy.js';
import plugin from '../src/server.mjs';

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
      elements: ['document'],
      tools: ['add-document'],
      migrations: ['legacy-markdown-v1']
    });
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
});
