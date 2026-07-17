import type {
  BrowserCommandDescriptor,
  BrowserPluginHost,
  CanvasElement,
  RendererContext
} from '@agentcanvas/extension-sdk';
import { describe, expect, it } from 'vitest';
import plugin from '../src/browser/entry.mjs';

describe('__DISPLAY_NAME__ browser renderer', () => {
  it('mounts, updates, and disposes without importing host UI code', async () => {
    const renderers: Parameters<BrowserPluginHost['registerRenderer']>[0][] = [];
    const commands: BrowserCommandDescriptor[] = [];
    await plugin.activate({
      registerRenderer: (renderer) => renderers.push(renderer),
      registerCommand: (command) => commands.push(command)
    });
    expect(commands.map((command) => command.name)).toEqual(['show-selection-count']);
    const element: CanvasElement = {
      id: 'card-1',
      type: '__PLUGIN_ID__/hello-card',
      schemaVersion: 1,
      x: 0,
      y: 0,
      data: { title: 'Hello', message: 'World' }
    };
    const host = document.createElement('div');
    const root = host.attachShadow({ mode: 'open' });
    const context = {
      element,
      runtime: null,
      readOnly: false,
      selected: false,
      signal: new AbortController().signal,
      theme: {},
      geometry: { getElementFrame: () => null, resolveAnchor: () => null },
      overlays: { open: () => ({ update() {}, close() {} }) },
      reportDiagnostic() {}
    } satisfies RendererContext;
    const renderer = renderers[0];
    if (!renderer) throw new Error('Browser plugin did not register a renderer.');
    const mounted = renderer.mount(root, context);
    expect(root.textContent).toContain('Hello');
    await mounted.update({
      ...context,
      readOnly: true,
      element: { ...element, data: { title: 'Updated', message: 'Card' } }
    });
    expect(root.textContent).toContain('Updated');
    expect(root.querySelector('article')?.dataset.readOnly).toBe('true');
    await mounted.dispose();
    expect(root.childNodes).toHaveLength(0);
  });
});
