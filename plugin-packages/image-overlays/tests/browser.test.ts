import type { BrowserPluginHost, RendererContext } from '@agentcanvas/plugin-sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';
import plugin from '../src/browser/entry.mjs';

const zipFile = vi.fn();
const zipGenerate = vi.fn(async () => new Blob(['zip'], { type: 'application/zip' }));
vi.mock('jszip', () => ({
  default: class FakeZip {
    folder() {
      return { file: zipFile };
    }
    generateAsync() {
      return zipGenerate();
    }
  }
}));

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  zipFile.mockClear();
  zipGenerate.mockClear();
});

function context(type: 'bbox' | 'path', data: Record<string, unknown>, reportDiagnostic = vi.fn()): RendererContext {
  return {
    element: {
      id: `${type}_1`,
      type: `agentcanvas.image-overlays/${type}`,
      schemaVersion: 1,
      x: 0,
      y: 0,
      data
    },
    runtime: null,
    readOnly: false,
    selected: false,
    signal: new AbortController().signal,
    theme: {},
    geometry: { getElementFrame: () => null, resolveAnchor: () => null },
    overlays: { open: () => ({ update() {}, close() {} }) },
    reportDiagnostic
  } as RendererContext;
}

describe('image overlays browser plugin', () => {
  it('registers isolated bbox/path renderers with labels, legends, and interactive exports', async () => {
    const renderers: Parameters<BrowserPluginHost['registerRenderer']>[0][] = [];
    await plugin.activate({ registerRenderer: (renderer) => renderers.push(renderer) });
    expect(renderers.map((renderer) => renderer.type)).toEqual([
      'agentcanvas.image-overlays/bbox',
      'agentcanvas.image-overlays/path'
    ]);

    const bboxHost = document.createElement('div');
    const bboxRoot = bboxHost.attachShadow({ mode: 'open' });
    renderers[0]?.mount(
      bboxRoot,
      context('bbox', {
        canvasWidth: 100,
        canvasHeight: 100,
        boxes: [{ id: 'face', x: 10, y: 10, width: 20, height: 30, label: 'Face' }]
      })
    );
    expect(bboxRoot.querySelector('[data-bbox-id="face"]')).toBeTruthy();
    expect(bboxRoot.textContent).toContain('Face');
    expect(bboxRoot.querySelectorAll('[data-agentcanvas-interactive="true"]')).toHaveLength(3);

    const pathHost = document.createElement('div');
    const pathRoot = pathHost.attachShadow({ mode: 'open' });
    renderers[1]?.mount(
      pathRoot,
      context('path', {
        canvasWidth: 100,
        canvasHeight: 100,
        paths: [{ id: 'outline', d: 'M0 0 L100 100', label: 'Outline' }]
      })
    );
    expect(pathRoot.querySelector('[data-path-id="outline"]')).toBeTruthy();
    expect(pathRoot.querySelector('.legend')?.textContent).toContain('Outline');
  });

  it('reports renderer errors instead of leaving an empty catch or blanking the host', async () => {
    let bboxRenderer: Parameters<BrowserPluginHost['registerRenderer']>[0] | undefined;
    await plugin.activate({
      registerRenderer(renderer) {
        if (renderer.type.endsWith('/bbox')) bboxRenderer = renderer;
      }
    });
    const reportDiagnostic = vi.fn();
    const host = document.createElement('div');
    const root = host.attachShadow({ mode: 'open' });
    bboxRenderer?.mount(root, context('bbox', { boxes: [] }, reportDiagnostic));
    expect(reportDiagnostic).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'bbox_render_failed', severity: 'error', elementId: 'bbox_1' })
    );
    expect(root.querySelector('.error')?.textContent).toMatch(/canvasWidth/i);
  });

  it('encodes every bbox mask with deterministic ZIP names', async () => {
    let bboxRenderer: Parameters<BrowserPluginHost['registerRenderer']>[0] | undefined;
    await plugin.activate({
      registerRenderer(renderer) {
        if (renderer.type.endsWith('/bbox')) bboxRenderer = renderer;
      }
    });
    const fillRect = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      fillRect
    } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((_callback, _type) => {
      const callback = _callback as BlobCallback;
      callback(new Blob(['png'], { type: 'image/png' }));
    });
    const createObjectURL = vi.fn(() => 'blob:overlay-export');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    const host = document.createElement('div');
    const root = host.attachShadow({ mode: 'open' });
    bboxRenderer?.mount(
      root,
      context('bbox', {
        canvasWidth: 100,
        canvasHeight: 200,
        boxes: [
          { id: 'face', x: 10, y: 20, width: 30, height: 40, label: 'Main Face' },
          { id: 'title', x: 5, y: 100, width: 80, height: 20 }
        ]
      })
    );
    (root.querySelector('[aria-label="Export bbox masks as ZIP"]') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(zipGenerate).toHaveBeenCalledTimes(1));
    expect(zipFile).toHaveBeenNthCalledWith(1, '01-main-face.png', expect.any(Blob));
    expect(zipFile).toHaveBeenNthCalledWith(2, '02-title.png', expect.any(Blob));
    expect(fillRect).toHaveBeenCalledTimes(4);
    expect(createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:overlay-export');
  });
});
