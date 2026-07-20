import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type {
  CanvasElement,
  ElementTypeDescriptor,
  ImageSourceReference,
  ImageSourcesCapabilityV1,
  JsonObject,
  PluginToolDescriptor,
  ServerPluginHost
} from '@agentcanvas/plugin-sdk';
import { validatePluginManifestStructure } from '@agentcanvas/plugin-testkit';
import { describe, expect, it, vi } from 'vitest';
import plugin from '../src/server.mjs';
import { renderGallerySnapshot } from '../src/snapshot.js';

const first = { provider: 'example.images', reference: { key: 'first' } };
const second = { provider: 'example.images', reference: { key: 'second' } };

function sources(): ImageSourcesCapabilityV1 {
  return {
    registerProvider: vi.fn(),
    hasProvider: () => true,
    listProviders: () => ['example.images'],
    validateReference: (value) => structuredClone(value) as ImageSourceReference,
    resolve: async (value) => {
      const source = value as ImageSourceReference;
      const key = String(source.reference.key);
      return {
        handle: `res_${key.padEnd(32, 'x')}`,
        url: `/api/v1/resources/res_${key.padEnd(32, 'x')}/content`,
        mimeType: 'image/png'
      };
    }
  };
}

async function registrations(): Promise<{
  element: ElementTypeDescriptor;
  tools: PluginToolDescriptor[];
}> {
  const elements: ElementTypeDescriptor[] = [];
  const tools: PluginToolDescriptor[] = [];
  const host = {
    registerElementType: (value: ElementTypeDescriptor) => elements.push(value),
    registerTool: (value: PluginToolDescriptor) => tools.push(value),
    consumeCapability: () => ({ get: sources })
  } as unknown as ServerPluginHost;
  await plugin.activate(host);
  return { element: elements[0], tools };
}

describe('Media Gallery extension', () => {
  it('ships a conforming manifest and self-contained browser distribution', () => {
    const manifest = JSON.parse(readFileSync(resolve('agentcanvas.plugin.json'), 'utf8'));
    expect(validatePluginManifestStructure(manifest)).toEqual({ ok: true, issues: [] });
    expect(manifest.requires.capabilities).toEqual({ 'agentcanvas.image-sources': '^1.0.0' });
    expect(manifest.contributes.tools).toEqual([
      'create',
      'append-items',
      'remove-item',
      'reorder-items',
      'set-cover',
      'update-settings'
    ]);
    const browser = readFileSync(resolve('dist/browser/entry.mjs'), 'utf8');
    expect(browser).not.toMatch(/(?:from\s*|import\s*\()['"]\.\.\//);
  });

  it('creates a provider-neutral gallery with safe defaults', async () => {
    const { tools } = await registrations();
    const upsertElement = vi.fn(async (_canvasId: string, _element: CanvasElement) => ({ revision: 2 }) as JsonObject);
    const create = tools.find((tool) => tool.name === 'create');
    const result = await create?.invoke(
      { canvasId: 'canvas', items: [{ source: first, caption: 'First' }, { source: second }], x: 10, y: 20 },
      {
        signal: new AbortController().signal,
        correlationId: 'test',
        canvas: {
          get: vi.fn(),
          upsertElement,
          replaceElementData: vi.fn(),
          deleteElement: vi.fn()
        }
      }
    );
    expect(result).toMatchObject({ ok: true, canvasId: 'canvas' });
    const element = upsertElement.mock.calls[0][1] as CanvasElement;
    expect(element).toMatchObject({
      type: 'agentcanvas.gallery/gallery',
      width: 480,
      height: 320,
      data: {
        presentation: 'carousel',
        fit: 'contain',
        initialIndex: 0,
        autoplay: false,
        intervalMs: 5000,
        showControls: true,
        showIndicators: true
      }
    });
    expect(element.data.items as unknown[]).toHaveLength(2);
  });

  it('resolves every provider item and snapshots the selected cover deterministically', async () => {
    const { element } = await registrations();
    const canvasElement: CanvasElement = {
      id: 'gallery',
      type: 'agentcanvas.gallery/gallery',
      schemaVersion: 1,
      x: 0,
      y: 0,
      width: 400,
      height: 260,
      data: {
        items: [
          { id: 'first', source: first },
          { id: 'second', source: second, caption: 'Cover', alt: 'Cover alt' }
        ],
        presentation: 'carousel',
        fit: 'cover',
        initialIndex: 1,
        autoplay: false,
        intervalMs: 5000,
        showControls: true,
        showIndicators: true
      }
    };
    const resolved = await element.resolve?.(canvasElement, {
      canvasId: 'canvas',
      readOnly: false,
      signal: new AbortController().signal,
      geometry: { getElementFrame: () => null, resolveAnchor: () => null }
    });
    expect(resolved?.diagnostics).toEqual([]);
    expect(resolved?.runtime.items).toHaveLength(2);
    const snapshot = renderGallerySnapshot(canvasElement, resolved?.runtime ?? null);
    expect(snapshot.nodes.find((node) => node.kind === 'imageHandle')).toMatchObject({
      handle: 'res_secondxxxxxxxxxxxxxxxxxxxxxxxxxx',
      fit: 'cover',
      alt: 'Cover alt'
    });
    expect(snapshot.nodes.find((node) => node.kind === 'text' && node.text === '2 / 2')).toBeTruthy();
  });

  it('mutates items, order, cover, and settings through the complete agent tool set', async () => {
    const { tools } = await registrations();
    const element: CanvasElement = {
      id: 'gallery',
      type: 'agentcanvas.gallery/gallery',
      schemaVersion: 1,
      x: 0,
      y: 0,
      data: {
        items: [
          { id: 'first', source: first },
          { id: 'second', source: second }
        ],
        presentation: 'carousel',
        fit: 'contain',
        initialIndex: 0,
        autoplay: false,
        intervalMs: 5000,
        showControls: true,
        showIndicators: true
      }
    };
    const replaceElementData = vi.fn(async (_canvasId: string, _elementId: string, data: JsonObject) => {
      element.data = structuredClone(data);
      return { revision: 2 };
    });
    const context = {
      signal: new AbortController().signal,
      correlationId: 'test',
      canvas: {
        get: async () => ({ elements: [element] }) as unknown as JsonObject,
        upsertElement: vi.fn(),
        replaceElementData,
        deleteElement: vi.fn()
      }
    };
    const invoke = async (name: string, input: JsonObject) => {
      const tool = tools.find((candidate) => candidate.name === name);
      if (!tool) throw new Error(`missing tool ${name}`);
      await tool.invoke({ canvasId: 'canvas', elementId: 'gallery', ...input }, context);
    };

    await invoke('append-items', {
      items: [{ id: 'third', source: { provider: 'example.images', reference: { key: 'third' } } }]
    });
    await invoke('reorder-items', { itemIds: ['third', 'first', 'second'] });
    await invoke('set-cover', { itemId: 'second' });
    await invoke('update-settings', { fit: 'cover', showControls: false, intervalMs: 8000 });
    await invoke('remove-item', { itemId: 'first' });

    expect(element.data).toMatchObject({
      items: [{ id: 'third' }, { id: 'second' }],
      initialIndex: 1,
      fit: 'cover',
      showControls: false,
      intervalMs: 8000
    });
    expect(replaceElementData).toHaveBeenCalledTimes(5);
  });
});
