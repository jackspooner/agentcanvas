import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { AssetsCapabilityV1, ServerPluginHost } from '@agentcanvas/plugin-sdk';
import { validatePluginManifestStructure } from '@agentcanvas/plugin-testkit';
import { describe, expect, it, vi } from 'vitest';
import { importLegacyVideo } from '../src/legacy.js';
import plugin from '../src/server.mjs';
import { renderVideoSnapshot } from '../src/snapshot.js';

const ref = { type: 'asset', project: 'demo', assetId: '00000000-0000-4000-8000-000000000000' };

describe('video plugin', () => {
  it('ships a conforming manifest and exact registrations', async () => {
    const manifest = JSON.parse(readFileSync(resolve(process.cwd(), 'agentcanvas.plugin.json'), 'utf8'));
    expect(validatePluginManifestStructure(manifest)).toEqual({ ok: true, issues: [] });
    const registrations = { elements: [] as string[], tools: [] as string[], migrations: [] as string[] };
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
      registerProcedure: vi.fn(),
      provideCapability: vi.fn(),
      consumeCapability: () => ({ get: () => assets }),
      config: {},
      kv: {},
      diagnostics: { emit: vi.fn() }
    } as unknown as ServerPluginHost;
    await plugin.activate(host);
    expect(registrations).toEqual({ elements: ['video'], tools: ['place'], migrations: ['legacy-video-v1'] });
  });

  it('imports playback defaults and audits runtime-only fields', () => {
    const result = importLegacyVideo({
      id: 'v1',
      type: 'video',
      x: 1,
      y: 2,
      assetRef: ref,
      resolvedUrl: '/old',
      posterResolvedUrl: '/poster'
    });
    expect(result.element).toMatchObject({
      type: 'agentcanvas.video/video',
      data: { assetRef: ref, controls: true, autoplay: false, loop: false, muted: false }
    });
    expect(result.strippedFields).toEqual(['resolvedUrl', 'posterResolvedUrl']);
  });

  it('renders a deterministic poster-backed snapshot', () => {
    const element = importLegacyVideo({
      id: 'v1',
      type: 'video',
      x: 0,
      y: 0,
      assetRef: ref,
      posterAssetRef: ref,
      caption: 'Demo'
    }).element;
    expect(
      renderVideoSnapshot(element, { poster: { handle: 'poster_handle', url: '/p', mimeType: 'image/png' } }).nodes
    ).toContainEqual(expect.objectContaining({ kind: 'imageHandle', handle: 'poster_handle' }));
  });
});
