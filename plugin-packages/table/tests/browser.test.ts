import type { BrowserPluginHost, RendererContext } from '@agentcanvas/plugin-sdk';
import { describe, expect, it } from 'vitest';
import plugin from '../src/browser/entry.mjs';

describe('table browser renderer', () => {
  it('renders a semantic caption in Shadow DOM', async () => {
    let renderer: Parameters<BrowserPluginHost['registerRenderer']>[0] | undefined;
    await plugin.activate({
      registerRenderer(value) {
        renderer = value;
      }
    });
    const host = document.createElement('div');
    const root = host.attachShadow({ mode: 'open' });
    renderer?.mount(root, {
      element: {
        id: 't',
        type: 'agentcanvas.table/table',
        schemaVersion: 1,
        x: 0,
        y: 0,
        data: { columns: ['A'], rows: [['1']], caption: 'Values' }
      },
      runtime: null,
      readOnly: false,
      selected: false,
      signal: new AbortController().signal,
      theme: {},
      geometry: { getElementFrame: () => null, resolveAnchor: () => null },
      overlays: { open: () => ({ update() {}, close() {} }) },
      reportDiagnostic() {}
    } as RendererContext);
    expect(root.querySelector('caption')?.textContent).toBe('Values');
  });
});
