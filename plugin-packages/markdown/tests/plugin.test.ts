import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ServerPluginHost } from '@agentcanvas/plugin-sdk';
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
});
