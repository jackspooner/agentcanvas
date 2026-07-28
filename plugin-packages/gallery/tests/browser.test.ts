import type { RendererContext } from '@agentcanvas/plugin-sdk';
import { DEFAULT_CANVAS_THEME } from '@agentcanvas/plugin-sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGalleryRenderer } from '../src/browser/entry.mjs';

function context(): RendererContext {
  return {
    element: {
      id: 'gallery',
      type: 'agentcanvas.gallery/gallery',
      schemaVersion: 1,
      x: 0,
      y: 0,
      width: 400,
      height: 260,
      data: {
        items: [
          { id: 'first', source: { provider: 'example.images', reference: { key: 'first' } }, alt: 'First image' },
          { id: 'second', source: { provider: 'example.images', reference: { key: 'second' } }, alt: 'Second image' }
        ],
        presentation: 'carousel',
        fit: 'contain',
        initialIndex: 0,
        autoplay: false,
        intervalMs: 5000,
        showControls: true,
        showIndicators: true
      }
    },
    runtime: {
      items: [
        {
          id: 'first',
          contentHandle: 'first-handle',
          contentUrl: '/api/v1/resources/first-handle/content',
          mimeType: 'image/png'
        },
        {
          id: 'second',
          contentHandle: 'second-handle',
          contentUrl: '/api/v1/resources/second-handle/content',
          mimeType: 'image/png'
        }
      ]
    },
    readOnly: false,
    selected: false,
    signal: new AbortController().signal,
    lifecycle: { signal: new AbortController().signal, active: true, reducedMotion: false },
    frames: { subscribe: () => () => {} },
    theme: DEFAULT_CANVAS_THEME,
    geometry: { getElementFrame: () => null, resolveAnchor: () => null },
    overlays: { open: () => ({ update() {}, close() {} }) },
    reportDiagnostic: vi.fn()
  };
}

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(new Blob(['image'], { type: 'image/png' }), {
          status: 200,
          headers: { 'content-type': 'image/png' }
        })
    )
  );
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:gallery') });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
});

afterEach(() => vi.restoreAllMocks());

describe('gallery browser lifecycle', () => {
  it('navigates locally with accessible controls and revokes fetched resources', async () => {
    const rendererContext = context();
    const root = document.createElement('div').attachShadow({ mode: 'open' });
    const mounted = createGalleryRenderer().mount(root, rendererContext);
    await mounted.update(rendererContext);
    await vi.waitFor(() => expect(root.querySelector('img')?.alt).toBe('First image'));
    const next = root.querySelector<HTMLButtonElement>('button.next');
    expect(next?.getAttribute('aria-label')).toBe('Next image');
    next?.click();
    await vi.waitFor(() => expect(root.querySelector('img')?.alt).toBe('Second image'));
    expect(root.querySelector('.indicator')?.textContent).toBe('2 / 2');
    expect(rendererContext.element.data.initialIndex).toBe(0);
    await mounted.dispose();
    expect(URL.revokeObjectURL).toHaveBeenCalled();
    expect(root.childNodes).toHaveLength(0);
  });
});
