import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ServerPluginHost } from '@agentcanvas/plugin-sdk';
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
});
