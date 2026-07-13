import type { BrowserElementRenderer } from '@agentcanvas/plugin-sdk';
import { describe, expect, it, vi } from 'vitest';
import {
  type BrowserPluginCatalog,
  fetchBrowserPluginCatalog,
  loadBrowserPluginRegistry
} from '../src/web/plugins/catalog.js';

function catalog(entryUrl = '/api/v1/plugin-modules/acme.cards/abcdef12/entry.mjs'): BrowserPluginCatalog {
  return {
    plugins: [
      {
        id: 'acme.cards',
        version: '1.0.0',
        displayName: 'Cards',
        buildHash: 'abcdef12',
        browserEntryUrl: entryUrl,
        elements: [{ type: 'acme.cards/hello', schemaVersion: 1 }],
        diagnostics: []
      }
    ]
  };
}

const renderer: BrowserElementRenderer = {
  type: 'acme.cards/hello',
  schemaVersions: [1],
  placement: 'node',
  mount: () => ({ update() {}, dispose() {} })
};

describe('browser plugin catalog', () => {
  it('loads and validates the sanitized catalog projection', async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(JSON.stringify(catalog()), { status: 200, headers: { 'content-type': 'application/json' } })
    );
    const loaded = await fetchBrowserPluginCatalog(fetcher as typeof fetch);
    expect(loaded.plugins[0].id).toBe('acme.cards');
    expect(fetcher).toHaveBeenCalledWith('/api/v1/plugins', {
      headers: { accept: 'application/json' },
      credentials: 'same-origin'
    });
    expect(Object.isFrozen(loaded.plugins)).toBe(true);
  });

  it('imports same-origin build-addressed modules and freezes exact renderer registrations', async () => {
    const importer = vi.fn(async () => ({
      default: {
        activate: (host: { registerRenderer(value: BrowserElementRenderer): void }) => host.registerRenderer(renderer)
      }
    }));
    const registry = await loadBrowserPluginRegistry({
      catalog: catalog(),
      baseUrl: 'http://127.0.0.1:23003/canvases/one',
      importer
    });
    expect(importer).toHaveBeenCalledWith('http://127.0.0.1:23003/api/v1/plugin-modules/acme.cards/abcdef12/entry.mjs');
    expect(registry.renderers.get('acme.cards/hello')).toBe(renderer);
  });

  it.each([
    'https://evil.example/api/v1/plugin-modules/acme.cards/abcdef12/entry.mjs',
    '/api/v1/plugin-modules/other.plugin/abcdef12/entry.mjs',
    '/api/v1/plugin-modules/acme.cards/deadbeef/entry.mjs',
    '/api/v1/plugin-modules/acme.cards/abcdef12/entry.mjs?token=secret'
  ])('rejects a module URL outside its same-origin catalog identity: %s', async (entryUrl) => {
    const loaded = await loadBrowserPluginRegistry({
      catalog: catalog(entryUrl),
      baseUrl: 'http://127.0.0.1:23003/canvases/one',
      importer: vi.fn()
    });
    expect(loaded.renderers.size).toBe(0);
    expect(loaded.diagnostics[0]).toMatchObject({ code: 'browser_plugin_activation_failed', pluginId: 'acme.cards' });
  });

  it('fails activation when registration does not exactly match declarations', async () => {
    for (const importer of [
      async () => ({ default: { activate() {} } }),
      async () => ({
        default: {
          activate(host: { registerRenderer(value: BrowserElementRenderer): void }) {
            host.registerRenderer({ ...renderer, type: 'acme.cards/undeclared' });
          }
        }
      })
    ]) {
      const loaded = await loadBrowserPluginRegistry({
        catalog: catalog(),
        baseUrl: 'http://127.0.0.1:23003/',
        importer
      });
      expect(loaded.renderers.size).toBe(0);
      expect(loaded.diagnostics[0]?.code).toBe('browser_plugin_activation_failed');
    }
  });
});
