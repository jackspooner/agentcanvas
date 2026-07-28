import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { AssetsCapabilityV1, ServerPluginHost } from '@agentcanvas/plugin-sdk';
import { validatePluginManifestStructure } from '@agentcanvas/plugin-testkit';
import { describe, expect, it, vi } from 'vitest';
import { importLegacyModel } from '../src/legacy.js';
import plugin from '../src/server.mjs';
import { renderModelSnapshot } from '../src/snapshot.js';

const ref = { type: 'asset', project: 'demo', assetId: '00000000-0000-4000-8000-000000000000' };

describe('GLB viewer plugin', () => {
  it('ships a conforming manifest and exact registrations', async () => {
    const manifest = JSON.parse(readFileSync(resolve(process.cwd(), 'agentcanvas.plugin.json'), 'utf8'));
    expect(validatePluginManifestStructure(manifest)).toEqual({ ok: true, issues: [] });
    const registrations = {
      elements: [] as string[],
      tools: [] as string[],
      procedures: [] as string[],
      migrations: [] as string[]
    };
    const assets = {
      validateReference: (value: unknown) => value,
      contentHandle: vi.fn(),
      details: vi.fn(),
      boundedJson: vi.fn(),
      providerStatus: vi.fn()
    } as unknown as AssetsCapabilityV1;
    const host = {
      registerElementType: (item: { name: string }) => registrations.elements.push(item.name),
      registerTool: (item: { name: string }) => registrations.tools.push(item.name),
      registerMigration: (item: { name: string }) => registrations.migrations.push(item.name),
      registerProcedure: (item: { name: string }) => registrations.procedures.push(item.name),
      provideCapability: vi.fn(),
      consumeCapability: () => ({ get: () => assets }),
      config: {},
      kv: {},
      diagnostics: { emit: vi.fn() }
    } as unknown as ServerPluginHost;
    await plugin.activate(host);
    expect(registrations).toEqual({
      elements: ['model'],
      tools: ['place'],
      procedures: ['details'],
      migrations: ['legacy-glb-v1']
    });
  });

  it('projects model and poster metadata through the Assets capability', async () => {
    const details = vi.fn(async (reference: unknown) => ({ asset: reference }));
    let procedure:
      | {
          invoke(input: Record<string, unknown>, context: { signal: AbortSignal }): Promise<unknown>;
        }
      | undefined;
    const assets = {
      validateReference: (value: unknown) => value,
      contentHandle: vi.fn(),
      details,
      boundedJson: vi.fn(),
      providerStatus: vi.fn()
    } as unknown as AssetsCapabilityV1;
    const host = {
      registerElementType: vi.fn(),
      registerTool: vi.fn(),
      registerMigration: vi.fn(),
      registerProcedure: (item: typeof procedure) => {
        procedure = item;
      },
      provideCapability: vi.fn(),
      consumeCapability: () => ({ get: () => assets }),
      config: {},
      kv: {},
      diagnostics: { emit: vi.fn() }
    } as unknown as ServerPluginHost;
    await plugin.activate(host);
    const output = await procedure?.invoke(
      { assetRef: ref, posterAssetRef: { ...ref, assetId: '00000000-0000-4000-8000-000000000002' } },
      { signal: new AbortController().signal }
    );
    expect(output).toMatchObject({
      ok: true,
      details: {
        model: { asset: ref },
        poster: { asset: { assetId: '00000000-0000-4000-8000-000000000002' } }
      }
    });
    expect(details).toHaveBeenCalledTimes(2);
  });

  it('imports camera defaults and strips response-only URLs', () => {
    const result = importLegacyModel({ id: 'g1', type: 'glbViewer', x: 1, y: 2, assetRef: ref, resolvedUrl: '/old' });
    expect(result.element).toMatchObject({
      type: 'agentcanvas.glb-viewer/model',
      data: { assetRef: ref, cameraControls: true, autoRotate: false }
    });
    expect(result.strippedFields).toEqual(['resolvedUrl']);
  });

  it('uses a deterministic cube placeholder without a poster', () => {
    const element = importLegacyModel({
      id: 'g1',
      type: 'glbViewer',
      x: 0,
      y: 0,
      assetRef: ref,
      caption: 'Robot'
    }).element;
    const scene = renderModelSnapshot(element, null);
    expect(scene.nodes.filter((node) => node.kind === 'path')).toHaveLength(3);
    expect(scene.nodes).toContainEqual(expect.objectContaining({ kind: 'text', text: 'Robot' }));
  });
});
