import type {
  BrowserElementRenderer,
  BrowserPluginHost,
  CanvasElement,
  PluginDiagnostic
} from '@agentcanvas/plugin-sdk';
import { DEFAULT_CANVAS_THEME } from '@agentcanvas/plugin-sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import plugin from '../src/browser/entry.mjs';

function element(fit: string = 'contain'): CanvasElement {
  return {
    id: 'asset-1',
    type: 'agentcanvas.assets2/asset',
    schemaVersion: 1,
    x: 0,
    y: 0,
    width: 320,
    height: 240,
    data: {
      assetRef: {
        type: 'asset',
        project: 'demo',
        assetId: '00000000-0000-4000-8000-000000000001'
      },
      fit,
      caption: 'Example'
    }
  };
}

function context(value: CanvasElement, signal: AbortSignal, diagnostics: PluginDiagnostic[] = []) {
  return {
    element: value,
    runtime: {
      contentHandle: 'resource_12345678',
      contentUrl: '/api/v1/resources/resource_12345678/content'
    },
    readOnly: false,
    selected: false,
    signal,
    lifecycle: { signal: new AbortController().signal, active: true, reducedMotion: false },
    frames: { subscribe: () => () => {} },
    theme: DEFAULT_CANVAS_THEME,
    geometry: { getElementFrame: () => null, resolveAnchor: () => null },
    overlays: { open: () => ({ update: vi.fn(), close: vi.fn() }) },
    reportDiagnostic: (diagnostic: PluginDiagnostic) => diagnostics.push(diagnostic)
  };
}

describe('Assets-2 browser renderer', () => {
  let renderer: BrowserElementRenderer;

  beforeEach(async () => {
    const renderers: BrowserElementRenderer[] = [];
    await plugin.activate({ registerRenderer: (value) => renderers.push(value) } as BrowserPluginHost);
    renderer = renderers[0];
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('loads through a same-origin handle, applies fit semantics, and revokes object URLs', async () => {
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:asset-1');
    const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(new Blob(['image']), { headers: { 'content-type': 'image/png' } }))
    );
    const frame = document.createElement('div');
    const root = frame.attachShadow({ mode: 'open' });
    const controller = new AbortController();
    const mounted = renderer.mount(root, context(element('original'), controller.signal));
    await vi.waitFor(() => expect(createObjectURL).toHaveBeenCalledOnce());
    expect(root.querySelector('img')?.style.objectFit).toBe('none');
    await mounted.dispose();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:asset-1');
  });

  it('resets the semantic figure margin to stay inside the canonical element frame', async () => {
    vi.stubGlobal('fetch', vi.fn());
    const root = document.createElement('div').attachShadow({ mode: 'open' });
    const mounted = renderer.mount(root, context(element(), new AbortController().signal));
    expect(root.querySelector('style')?.textContent).toContain('margin:0');
    await mounted.dispose();
  });

  it('refuses a runtime content URL that is not the host resource route', async () => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    const frame = document.createElement('div');
    const root = frame.attachShadow({ mode: 'open' });
    const rendererContext = context(element(), new AbortController().signal);
    rendererContext.runtime.contentUrl = 'https://evil.example/image.png';
    const mounted = renderer.mount(root, rendererContext);
    await Promise.resolve();
    expect(fetcher).not.toHaveBeenCalled();
    expect(root.textContent).toContain('asset unavailable');
    await mounted.dispose();
  });

  it('loads safe details through the typed procedure into the host overlay service', async () => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:asset-1');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/resources/'))
        return new Response(new Blob(['image']), { headers: { 'content-type': 'image/png' } });
      if (url.endsWith('/procedures/details')) {
        return new Response(
          JSON.stringify({
            ok: true,
            details: {
              asset: { project: 'demo', assetId: 'asset-id', filename: 'example.png', width: 640, height: 480 },
              generation: { provider: 'openai', model: 'gpt-image', prompt: 'A safe prompt' },
              cost: { currency: 'USD', amount: 0.04 }
            }
          }),
          { headers: { 'content-type': 'application/json' } }
        );
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    vi.stubGlobal('fetch', fetcher);
    const update = vi.fn();
    const close = vi.fn();
    const detailsController = new AbortController();
    const rendererContext = context(element(), detailsController.signal);
    rendererContext.overlays = { open: () => ({ update, close }) };
    const root = document.createElement('div').attachShadow({ mode: 'open' });
    const mounted = renderer.mount(root, rendererContext);
    expect(root.querySelector('button')).toBeNull();
    await renderer.details?.open(rendererContext);
    expect(update).toHaveBeenCalled();
    const panel = update.mock.calls[0][0] as HTMLElement;
    expect(panel.textContent).toContain('openai / gpt-image');
    expect(panel.textContent).toContain('A safe prompt');
    expect(fetcher).toHaveBeenCalledWith(
      '/api/v1/plugins/agentcanvas.assets2/procedures/details',
      expect.objectContaining({ method: 'POST', credentials: 'same-origin' })
    );
    detailsController.abort();
    await mounted.dispose();
    expect(close).toHaveBeenCalled();
  });
});
