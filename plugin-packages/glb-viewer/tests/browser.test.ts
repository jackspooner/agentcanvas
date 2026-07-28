import type { RendererContext } from '@agentcanvas/plugin-sdk';
import { DEFAULT_CANVAS_THEME } from '@agentcanvas/plugin-sdk';
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
    theme: DEFAULT_CANVAS_THEME,
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

  it('uses a same-origin URL for the model and an object URL for the poster', async () => {
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
    expect(root.querySelector('model-viewer')?.className).toBe('viewer');
    expect(root.querySelector('model-viewer')?.dataset.agentcanvasInteractive).toBe('');
    expect(create).toHaveBeenCalledTimes(1);
    expect(root.querySelector('model-viewer')?.getAttribute('src')).toBe('http://localhost:3000/model');
    const viewer = root.querySelector('model-viewer');
    await mounted.update(
      context({
        source: { handle: 's', url: '/model', mimeType: 'model/gltf-binary' },
        poster: { handle: 'p', url: '/poster', mimeType: 'image/png' }
      })
    );
    expect(root.querySelector('model-viewer')).toBe(viewer);
    expect(create).toHaveBeenCalledTimes(1);
    expect(revoke).not.toHaveBeenCalled();
    await mounted.update(context(null));
    expect(signals.every((signal) => signal.aborted)).toBe(true);
    expect(revoke).toHaveBeenCalledTimes(1);
    await mounted.dispose();
    expect(root.childNodes).toHaveLength(0);
  });

  it('loads safe model details through its own typed procedure', async () => {
    const update = vi.fn();
    const close = vi.fn();
    const fetcher = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            ok: true,
            details: {
              model: {
                asset: {
                  project: 'demo',
                  assetKey: '3d/generated/robot.glb',
                  filename: 'robot.glb',
                  sizeBytes: 1_572_864,
                  createdAt: '2026-07-23T10:00:00.000Z'
                },
                generation: {
                  provider: 'meshy',
                  model: 'v6',
                  generatedAt: '2026-07-23T09:59:00.000Z',
                  contextImages: [{ assetId: 'source-1' }]
                }
              },
              poster: null
            }
          }),
          { headers: { 'content-type': 'application/json' } }
        )
    );
    vi.stubGlobal('fetch', fetcher);
    const rendererContext = context(null);
    rendererContext.element.data.assetRef = {
      type: 'asset',
      project: 'demo',
      assetId: '00000000-0000-4000-8000-000000000001'
    };
    rendererContext.overlays = { open: () => ({ update, close }) };
    await createModelRenderer().details?.open(rendererContext);
    const panel = update.mock.calls[0]?.[0] as HTMLElement;
    expect(panel.textContent).toContain('3d/generated/robot.glb');
    expect(panel.textContent).toContain('1.50 MB');
    expect(panel.textContent).toContain('Source images');
    expect(fetcher).toHaveBeenCalledWith(
      '/api/v1/plugins/agentcanvas.glb-viewer/procedures/details',
      expect.objectContaining({ method: 'POST', credentials: 'same-origin' })
    );
  });
});
