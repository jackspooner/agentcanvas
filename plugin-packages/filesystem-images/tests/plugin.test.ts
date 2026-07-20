import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type {
  ImageSourcesCapabilityV1,
  ServerPluginHost,
  SnapshotResourcesCapabilityV1
} from '@agentcanvas/plugin-sdk';
import { validatePluginManifestStructure } from '@agentcanvas/plugin-testkit';
import { describe, expect, it, vi } from 'vitest';
import plugin from '../src/server.mjs';
import { renderFileSystemImageSnapshot } from '../src/snapshot.js';

describe('filesystem images plugin', () => {
  it('ships a conforming, self-contained browser distribution', () => {
    const manifest = JSON.parse(readFileSync(resolve('agentcanvas.plugin.json'), 'utf8'));
    expect(validatePluginManifestStructure(manifest)).toEqual({ ok: true, issues: [] });
    expect(manifest.permissions).toContain('filesystem.read');
    const entry = readFileSync(resolve('dist/browser/entry.mjs'), 'utf8');
    expect(entry).not.toMatch(/(?:from\s*|import\s*\()['"]\.\.\//);
    expect(entry).toContain('margin:0');
  });

  it('registers the image element and both tools with an empty safe root set', async () => {
    const elements: string[] = [];
    const tools: string[] = [];
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
      config: { roots: [], contentMaxBytes: 67108864, resourceTtlMs: 3600000 },
      registerElementType: (value: { name: string }) => elements.push(value.name),
      registerTool: (value: { name: string }) => tools.push(value.name),
      consumeCapability: (name: string) => ({
        get: () => (name === 'agentcanvas.image-sources' ? imageSources : resources)
      })
    } as unknown as ServerPluginHost;
    await plugin.activate(host);
    expect(elements).toEqual(['image']);
    expect(tools).toEqual(['place', 'list-roots']);
    expect(imageSources.registerProvider).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'agentcanvas.filesystem-images' })
    );
  });

  it('uses the expected fit mode in snapshots', () => {
    const snapshot = renderFileSystemImageSnapshot(
      {
        id: 'image',
        type: 'agentcanvas.filesystem-images/image',
        schemaVersion: 1,
        x: 0,
        y: 0,
        width: 100,
        height: 80,
        data: { source: { rootId: 'pictures', path: 'mug.png' }, fit: 'stretch' }
      },
      { contentHandle: 'res_abcdefghijklmnopqrstuvwxyzABCDEF' }
    );
    expect(snapshot.nodes.find((node) => node.kind === 'imageHandle')).toMatchObject({ fit: 'fill' });
  });
});
