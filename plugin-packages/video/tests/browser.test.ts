import type { RendererContext } from '@agentcanvas/plugin-sdk';
import { DEFAULT_CANVAS_THEME } from '@agentcanvas/plugin-sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createVideoRenderer } from '../src/browser/entry.mjs';

function context(runtime: RendererContext['runtime']): RendererContext {
  return {
    element: {
      id: 'v',
      type: 'agentcanvas.video/video',
      schemaVersion: 1,
      x: 0,
      y: 0,
      data: { assetRef: {}, controls: true, autoplay: false, loop: false, muted: true, caption: 'Video' }
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

describe('video browser lifecycle', () => {
  it('pauses, detaches, aborts, and revokes object URLs during update and dispose', async () => {
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
    vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => undefined);
    const signals: AbortSignal[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
        if (init?.signal) signals.push(init.signal);
        const isPoster = String(url).includes('poster');
        return new Response(new Blob(['bytes'], { type: isPoster ? 'image/png' : 'video/mp4' }), {
          status: 200,
          headers: { 'content-type': isPoster ? 'image/png' : 'video/mp4' }
        });
      })
    );
    const create = vi.fn(() => `blob:${Math.random()}`);
    const revoke = vi.fn();
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: create });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revoke });
    const root = document.createElement('div').attachShadow({ mode: 'open' });
    const mounted = createVideoRenderer().mount(root, context(null));
    await mounted.update(
      context({
        source: { handle: 's', url: '/source', mimeType: 'video/mp4' },
        poster: { handle: 'p', url: '/poster', mimeType: 'image/png' }
      })
    );
    expect(create).toHaveBeenCalledTimes(2);
    await mounted.update(context(null));
    expect(signals.every((signal) => signal.aborted)).toBe(true);
    expect(revoke).toHaveBeenCalledTimes(2);
    await mounted.dispose();
    expect(root.childNodes).toHaveLength(0);
  });
});
