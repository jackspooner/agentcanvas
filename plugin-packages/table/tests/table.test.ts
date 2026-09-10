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
import { importLegacyTable } from '../src/legacy.js';
import plugin from '../src/server.mjs';
import { renderTableSnapshot } from '../src/snapshot.js';

describe('table plugin', () => {
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
    expect(registrations).toEqual({ elements: ['table'], tools: ['add-table'], migrations: ['legacy-table-v1'] });
  });

  it('preserves the legacy caption and renders it in snapshots', () => {
    const element = importLegacyTable({
      id: 't1',
      type: 'table',
      x: 0,
      y: 0,
      columns: ['A', 'B'],
      rows: [['1', '2']],
      caption: 'Numbers'
    }).element;
    expect(element.data.caption).toBe('Numbers');
    expect(renderTableSnapshot(element).nodes).toContainEqual(
      expect.objectContaining({ kind: 'text', text: 'Numbers' })
    );
  });

  it('auto-sizes omitted heights and rejects accidental scrolling tables', async () => {
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
    const addTable = tools.find((tool) => tool.name === 'add-table') as PluginToolDescriptor;
    const upsertElementReceipt = vi.fn(async (_canvasId: string, _element: CanvasElement) => ({ revision: 2 }));
    const context = { canvas: { upsertElementReceipt } } as unknown as PluginInvocationContext;
    const input = {
      canvasId: 'canvas_1',
      x: 0,
      y: 0,
      width: 520,
      columns: ['Option', 'Evidence'],
      rows: [
        ['A', 'Verified'],
        ['B', 'Assumption'],
        ['C', 'Unknown']
      ],
      caption: 'Comparison'
    };

    await addTable.invoke(input, context);
    expect(upsertElementReceipt.mock.calls[0]?.[1]).toMatchObject({ height: 204 });

    await expect(addTable.invoke({ ...input, height: 160 }, context)).rejects.toThrow('is likely to hide rows');

    const undersized = {
      id: 'table_1',
      type: 'agentcanvas.table/table',
      schemaVersion: 1,
      x: 0,
      y: 0,
      width: input.width,
      height: 160,
      data: { columns: input.columns, rows: input.rows, caption: input.caption }
    } as CanvasElement;
    expect(
      elements[0].inspect?.(undersized, {
        pluginId: 'agentcanvas.table',
        type: undersized.type,
        schemaVersion: 1
      })
    ).toEqual([expect.objectContaining({ code: 'table_content_may_clip' })]);

    upsertElementReceipt.mockClear();
    await addTable.invoke({ ...input, height: 160, allowScroll: true }, context);
    expect(upsertElementReceipt.mock.calls[0]?.[1]).toMatchObject({ data: { allowScroll: true } });
  });
});
