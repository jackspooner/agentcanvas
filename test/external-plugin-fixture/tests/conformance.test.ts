import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { BrowserPluginHost, PluginManifest, ServerPluginHost } from '@agentcanvas/plugin-sdk';
import { assertContributionRegistrations, assertPluginManifestStructure } from '@agentcanvas/plugin-testkit';
import { describe, expect, it } from 'vitest';
import browserPlugin from '../src/browser/entry.mjs';
import serverPlugin, { importLegacy, snapshot } from '../src/server.mjs';

describe('external plugin fixture', () => {
  it('uses public activation contracts for all declared contributions', async () => {
    const manifest = JSON.parse(
      await readFile(resolve(process.cwd(), 'agentcanvas.plugin.json'), 'utf8')
    ) as PluginManifest;
    assertPluginManifestStructure(manifest);
    const registrations = {
      elements: [] as string[],
      tools: [] as string[],
      procedures: [] as string[],
      migrations: [] as string[]
    };
    const host = {
      registerElementType: (value) => registrations.elements.push(value.name),
      registerTool: (value) => registrations.tools.push(value.name),
      registerProcedure: (value) => registrations.procedures.push(value.name),
      registerMigration: (value) => registrations.migrations.push(value.name),
      provideCapability: () => {
        throw new Error('not used');
      },
      consumeCapability: () => {
        throw new Error('not used');
      },
      config: { accentColor: '#7c3aed' },
      kv: {
        get: async () => undefined,
        set: async () => {},
        delete: async () => false,
        list: async () => ({ entries: [] })
      },
      diagnostics: { emit() {} }
    } satisfies ServerPluginHost;
    await serverPlugin.activate(host);
    assertContributionRegistrations(manifest.contributes, registrations);
  });

  it('provides deterministic migration, snapshot, and browser lifecycle', async () => {
    const legacy = { id: 'signal-1', x: 1, y: 2, label: 'Build', status: 'active' };
    const element = importLegacy(legacy).element;
    expect(importLegacy(legacy)).toEqual(importLegacy(legacy));
    expect(snapshot(element).nodes).toHaveLength(2);
    const renderers: Parameters<BrowserPluginHost['registerRenderer']>[0][] = [];
    await browserPlugin.activate({ registerRenderer: (value) => renderers.push(value) });
    const root = document.createElement('div').attachShadow({ mode: 'open' });
    const renderer = renderers[0];
    if (!renderer) throw new Error('External plugin did not register its browser renderer.');
    const mounted = renderer.mount(root, {
      element,
      runtime: null,
      readOnly: false,
      selected: false,
      signal: new AbortController().signal,
      theme: {},
      geometry: { getElementFrame: () => null, resolveAnchor: () => null },
      overlays: { open: () => ({ update() {}, close() {} }) },
      reportDiagnostic() {}
    });
    expect(root.textContent).toContain('Build · active');
    await mounted.dispose();
    expect(root.childNodes).toHaveLength(0);
  });
});
