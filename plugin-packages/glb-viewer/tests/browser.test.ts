import type { RendererContext } from '@agentcanvas/plugin-sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createModelRenderer, ensureModelViewerRegistered } from '../src/browser/entry.js';

function context(runtime: RendererContext['runtime']): RendererContext {
  return {
    element: {
      id: 'g',
      type: 'agentcanvas.glb-viewer/model',
      schemaVersion: 1,
      x: 0,
      y: 0,
      data: { assetRef: {}, cameraControls: true, autoRotate: true, caption: 'Robot' }
    },
    runtime,
    readOnly: false,
    selected: false,
    signal: new AbortController().signal,
    theme: {},
    geometry: { getElementFrame: () => null, resolveAnchor: () => null },
    overlays: { open: () => ({ update() {}, close() {} }) },
    reportDiagnostic: vi.fn()
  };
}

afterEach(() => vi.restoreAllMocks());

describe('GLB browser lifecycle', () => {
  it('does not re-import model-viewer after the custom element is registered', async () => {
    if (!customElements.get('model-viewer')) customElements.define('model-viewer', class extends HTMLElement {});
    const importer = vi.fn(async () => ({}));
    await ensureModelViewerRegistered(importer);
    expect(importer).not.toHaveBeenCalled();
  });

  it('revokes model and poster object URLs during update and dispose', async () => {
    if (!customElements.get('model-viewer')) customElements.define('model-viewer', class extends HTMLElement {});
    const signals: AbortSignal[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
        if (init?.signal) signals.push(init.signal);
        const isPoster = String(url).includes('poster');
        return new Response(new Blob(['bytes'], { type: isPoster ? 'image/png' : 'model/gltf-binary' }), {
          status: 200,
          headers: { 'content-type': isPoster ? 'image/png' : 'model/gltf-binary' }
        });
      })
    );
    const create = vi.fn(() => `blob:${Math.random()}`);
    const revoke = vi.fn();
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: create });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revoke });
    const root = document.createElement('div').attachShadow({ mode: 'open' });
    const mounted = createModelRenderer().mount(root, context(null));
    await mounted.update(
      context({
        source: { handle: 's', url: '/model', mimeType: 'model/gltf-binary' },
        poster: { handle: 'p', url: '/poster', mimeType: 'image/png' }
      })
    );
    expect(root.querySelector('model-viewer')?.getAttribute('camera-controls')).toBe('');
    expect(create).toHaveBeenCalledTimes(2);
    await mounted.update(context(null));
    expect(signals.every((signal) => signal.aborted)).toBe(true);
    expect(revoke).toHaveBeenCalledTimes(2);
    await mounted.dispose();
    expect(root.childNodes).toHaveLength(0);
  });
});
