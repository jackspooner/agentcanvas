import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ServerPluginHost } from '@agentcanvas/plugin-sdk';
import { validatePluginManifestStructure } from '@agentcanvas/plugin-testkit';
import { describe, expect, it, vi } from 'vitest';
import { importLegacyPrimitive } from '../src/legacy.js';
import plugin from '../src/server.mjs';
import { renderShapeSnapshot } from '../src/snapshot.js';

describe('primitives plugin', () => {
  it('ships a conforming public manifest', () => {
    const manifest = JSON.parse(readFileSync(resolve(process.cwd(), 'agentcanvas.plugin.json'), 'utf8'));
    expect(validatePluginManifestStructure(manifest)).toEqual({ ok: true, issues: [] });
  });

  it('registers exactly the declared contributions', async () => {
    const elements: string[] = [];
    const tools: string[] = [];
    const migrations: string[] = [];
    const host = {
      registerElementType: (item: { name: string }) => elements.push(item.name),
      registerTool: (item: { name: string }) => tools.push(item.name),
      registerProcedure: vi.fn(),
      registerMigration: (item: { name: string }) => migrations.push(item.name),
      provideCapability: vi.fn(),
      consumeCapability: vi.fn(),
      config: {},
      kv: {},
      diagnostics: { emit: vi.fn() }
    } as unknown as ServerPluginHost;
    await plugin.activate(host);
    expect(elements).toEqual(['text', 'shape', 'line', 'arrow']);
    expect(tools).toEqual(['add-text', 'add-shape', 'add-line', 'add-arrow']);
    expect(migrations).toEqual(['legacy-primitives-v1']);
  });

  it('imports legacy primitives without changing ids or frames', () => {
    const result = importLegacyPrimitive({
      id: 'shape-1',
      type: 'shape',
      x: 12,
      y: 24,
      width: 300,
      height: 180,
      shape: 'diamond',
      label: 'Decision'
    });
    expect(result.element).toMatchObject({
      id: 'shape-1',
      type: 'agentcanvas.primitives/shape',
      schemaVersion: 1,
      x: 12,
      y: 24,
      width: 300,
      height: 180,
      data: { shape: 'diamond', label: 'Decision' }
    });
  });

  it('renders rectangle, ellipse, and diamond as distinct snapshot nodes', () => {
    const base = {
      id: 's',
      type: 'agentcanvas.primitives/shape' as const,
      schemaVersion: 1,
      x: 0,
      y: 0,
      width: 100,
      height: 80,
      data: { shape: 'rect' }
    };
    const kinds = ['rect', 'ellipse', 'diamond'].map(
      (shape) => renderShapeSnapshot({ ...base, data: { shape } }).nodes[0].kind
    );
    expect(kinds).toEqual(['rect', 'ellipse', 'path']);
  });
});
