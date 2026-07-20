import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type {
  AssetsCapabilityV1,
  CapabilityProvider,
  ImageSourcesCapabilityV1,
  ServerPluginHost,
  SnapshotResourcesCapabilityV1
} from '@agentcanvas/plugin-sdk';
import { validatePluginManifestStructure } from '@agentcanvas/plugin-testkit';
import { describe, expect, it, vi } from 'vitest';
import { importLegacyAsset } from '../src/legacy.js';
import plugin from '../src/server.mjs';
import { renderAssetSnapshot } from '../src/snapshot.js';

const config = {
  baseUrl: 'http://127.0.0.1:23000',
  fetchTimeoutMs: 1000,
  metadataMaxBytes: 4096,
  previewMaxBytes: 8192,
  contentMaxBytes: 1024
};

const validateReference = (value: unknown) => value as ReturnType<AssetsCapabilityV1['validateReference']>;

describe('Assets-2 plugin', () => {
  it('ships a browser entry contained within the browser module subtree', () => {
    const entry = readFileSync(resolve('dist/browser/entry.mjs'), 'utf8');
    expect(entry).not.toMatch(/(?:from\s*|import\s*\()['"]\.\.\//);
  });

  it('ships a conforming manifest that requires the shared resource broker', () => {
    const manifest = JSON.parse(readFileSync(resolve('agentcanvas.plugin.json'), 'utf8'));
    expect(validatePluginManifestStructure(manifest)).toEqual({ ok: true, issues: [] });
    expect(manifest.requires.capabilities).toEqual({
      'agentcanvas.image-sources': '^1.0.0',
      'agentcanvas.snapshot-resources': '^1.0.0'
    });
    expect(manifest.provides.capabilities).toEqual({ 'agentcanvas.assets': '1.0.0' });
    expect(manifest.configuration.environment).toEqual([
      'ASSETS_BASE_URL',
      'AGENT_CANVAS_ASSET_FETCH_TIMEOUT_MS',
      'AGENT_CANVAS_ASSET_METADATA_MAX_BYTES',
      'AGENT_CANVAS_ASSET_PREVIEW_MAX_BYTES',
      'AGENT_CANVAS_ASSET_PROXY_MAX_BYTES'
    ]);
  });

  it('registers the exact element, tools, procedure, migration, and capability', async () => {
    const elements: string[] = [];
    const tools: string[] = [];
    const procedures: string[] = [];
    const migrations: string[] = [];
    const capabilities: CapabilityProvider<unknown>[] = [];
    const resources: SnapshotResourcesCapabilityV1 = {
      register: vi.fn(),
      details: vi.fn(),
      load: vi.fn()
    };
    const imageSources: ImageSourcesCapabilityV1 = {
      registerProvider: vi.fn(),
      hasProvider: vi.fn(),
      listProviders: vi.fn(),
      validateReference: vi.fn(),
      resolve: vi.fn()
    };
    const host = {
      config,
      kv: {},
      diagnostics: { emit: vi.fn() },
      registerElementType: (value: { name: string }) => elements.push(value.name),
      registerTool: (value: { name: string }) => tools.push(value.name),
      registerProcedure: (value: { name: string }) => procedures.push(value.name),
      registerMigration: (value: { name: string }) => migrations.push(value.name),
      provideCapability: (value: CapabilityProvider<unknown>) => capabilities.push(value),
      consumeCapability: (name: string) => ({
        get: () => (name === 'agentcanvas.image-sources' ? imageSources : resources)
      })
    } as unknown as ServerPluginHost;
    await plugin.activate(host);
    expect(elements).toEqual(['asset']);
    expect(tools).toEqual(['place', 'get-details']);
    expect(procedures).toEqual(['details']);
    expect(migrations).toEqual(['legacy-asset-v1']);
    expect(capabilities.map(({ name, version }) => ({ name, version }))).toEqual([
      { name: 'agentcanvas.assets', version: '1.0.0' }
    ]);
    expect(imageSources.registerProvider).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'agentcanvas.assets2' })
    );
  });

  it('imports legacy assets and audits response-only URL removal', () => {
    const result = importLegacyAsset(
      {
        id: 'asset-1',
        type: 'asset',
        x: 12,
        y: 24,
        width: 320,
        height: 240,
        assetRef: { type: 'asset', project: 'demo', assetId: '00000000-0000-4000-8000-000000000001' },
        caption: 'Reference',
        fit: 'original',
        alt: 'Alt',
        resolvedUrl: '/api/assets/private/content'
      },
      validateReference
    );
    expect(result.element).toMatchObject({
      id: 'asset-1',
      type: 'agentcanvas.assets2/asset',
      schemaVersion: 1,
      x: 12,
      y: 24,
      width: 320,
      height: 240,
      data: { caption: 'Reference', fit: 'original', alt: 'Alt' }
    });
    expect(result.strippedFields).toEqual(['resolvedUrl']);
    expect(result.element.data).not.toHaveProperty('resolvedUrl');
  });

  it('maps all fit modes precisely in deterministic snapshot nodes', () => {
    const fits = ['contain', 'cover', 'stretch', 'original'] as const;
    expect(
      fits.map((fit) => {
        const snapshot = renderAssetSnapshot(
          {
            id: fit,
            type: 'agentcanvas.assets2/asset',
            schemaVersion: 1,
            x: 0,
            y: 0,
            width: 100,
            height: 80,
            data: { assetRef: { type: 'asset', project: 'demo', assetId: 'id' }, fit }
          },
          { contentHandle: 'resource_12345678' }
        );
        return snapshot.nodes.find((node) => node.kind === 'imageHandle')?.fit;
      })
    ).toEqual(['contain', 'cover', 'fill', 'none']);
  });
});
