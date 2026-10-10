import type {
  BrowserCommandContext,
  BrowserCommandDescriptor,
  JsonObject,
  RendererContext
} from '@agentcanvas/plugin-sdk';
import { DEFAULT_CANVAS_THEME } from '@agentcanvas/plugin-sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGalleryRenderer, registerGalleryCommands } from '../src/browser/entry.mjs';

type RuntimeItem = {
  id: string;
  contentHandle?: string;
  contentUrl?: string;
  mimeType?: string;
  state?: string;
  message?: string;
};

function context(
  runtimeItems: RuntimeItem[] = [
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
  ],
  signal = new AbortController().signal,
  lifecycleSignal = new AbortController().signal,
  firstAlt = 'First image',
  firstSourceKey = 'first'
): RendererContext {
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
          { id: 'first', source: { provider: 'example.images', reference: { key: firstSourceKey } }, alt: firstAlt },
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
    runtime: { items: runtimeItems },
    readOnly: false,
    selected: false,
    signal,
    lifecycle: { signal: lifecycleSignal, active: true, reducedMotion: false },
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
  it('keeps one in-flight request through identical updates and syncs updated alt text', async () => {
    let resolveResponse!: (response: Response) => void;
    let fetchSignal!: AbortSignal;
    vi.mocked(fetch).mockImplementation((_input, init) => {
      fetchSignal = init?.signal as AbortSignal;
      return new Promise((resolve) => {
        resolveResponse = resolve;
      });
    });
    const lifecycleSignal = new AbortController().signal;
    let updateController = new AbortController();
    const rendererContext = context(undefined, updateController.signal, lifecycleSignal);
    const root = document.createElement('div').attachShadow({ mode: 'open' });
    const mounted = createGalleryRenderer().mount(root, rendererContext);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));

    for (let index = 0; index < 3; index += 1) {
      updateController.abort();
      updateController = new AbortController();
      await mounted.update(context(undefined, updateController.signal, lifecycleSignal, `Updated image ${index}`));
    }

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetchSignal.aborted).toBe(false);
    resolveResponse(
      new Response(new Blob(['image'], { type: 'image/png' }), {
        status: 200,
        headers: { 'content-type': 'image/png' }
      })
    );
    await vi.waitFor(() => expect(root.querySelector('img')?.alt).toBe('Updated image 2'));
    const imageSource = root.querySelector('img')?.getAttribute('src');
    await mounted.update(context(undefined, new AbortController().signal, lifecycleSignal));
    expect(root.querySelector('img')?.getAttribute('src')).toBe(imageSource);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetchSignal.aborted).toBe(false);
    await mounted.dispose();
  });

  it('aborts the previous resource request when its identity changes', async () => {
    const pending: Array<{ signal: AbortSignal; resolve: (response: Response) => void }> = [];
    vi.mocked(fetch).mockImplementation((_input, init) => {
      const signal = init?.signal as AbortSignal;
      return new Promise((resolve, reject) => {
        pending.push({ signal, resolve });
        signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
      });
    });
    const lifecycleSignal = new AbortController().signal;
    const rendererContext = context(undefined, new AbortController().signal, lifecycleSignal);
    const root = document.createElement('div').attachShadow({ mode: 'open' });
    const mounted = createGalleryRenderer().mount(root, rendererContext);
    await vi.waitFor(() => expect(pending).toHaveLength(1));

    const updatedBase = context(
      [
        {
          id: 'first',
          contentHandle: 'replacement-handle',
          contentUrl: '/api/v1/resources/replacement-handle/content',
          mimeType: 'image/png'
        }
      ],
      new AbortController().signal,
      lifecycleSignal,
      'First image',
      'replacement'
    );
    await mounted.update(updatedBase);
    await vi.waitFor(() => expect(pending).toHaveLength(2));
    expect(pending[0].signal.aborted).toBe(true);
    pending[1].resolve(
      new Response(new Blob(['replacement'], { type: 'image/png' }), {
        status: 200,
        headers: { 'content-type': 'image/png' }
      })
    );
    await vi.waitFor(() => expect(root.querySelector('img')?.alt).toBe('First image'));
    await mounted.dispose();
  });

  it('retries a failed resource request on the next update', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(
        new Response(new Blob(['image'], { type: 'image/png' }), {
          status: 200,
          headers: { 'content-type': 'image/png' }
        })
      );
    const rendererContext = context();
    const root = document.createElement('div').attachShadow({ mode: 'open' });
    const mounted = createGalleryRenderer().mount(root, rendererContext);
    await vi.waitFor(() =>
      expect(rendererContext.reportDiagnostic).toHaveBeenCalledWith(
        expect.objectContaining({
          code: 'gallery_image_content_failed',
          retryable: true
        })
      )
    );

    await mounted.update(context(undefined, new AbortController().signal, rendererContext.lifecycle.signal));
    await vi.waitFor(() => expect(root.querySelector('img')?.alt).toBe('First image'));
    expect(fetch).toHaveBeenCalledTimes(2);
    await mounted.dispose();
  });

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

  it('shows a pending item and keeps it active when runtime data arrives', async () => {
    const rendererContext = context([
      {
        id: 'first',
        contentHandle: 'first-handle',
        contentUrl: '/api/v1/resources/first-handle/content',
        mimeType: 'image/png'
      },
      { id: 'second', state: 'queued', message: 'Waiting for image…' }
    ]);
    const root = document.createElement('div').attachShadow({ mode: 'open' });
    const mounted = createGalleryRenderer().mount(root, rendererContext);
    await mounted.update(rendererContext);
    await vi.waitFor(() => expect(root.querySelector('img')?.alt).toBe('First image'));

    root.querySelector<HTMLButtonElement>('button.next')?.click();
    await vi.waitFor(() => expect(root.querySelector('.placeholder')?.textContent).toBe('Waiting for image…'));

    const completed = context([
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
    ]);
    await mounted.update(completed);
    await vi.waitFor(() => expect(root.querySelector('img')?.alt).toBe('Second image'));
    expect(root.querySelector('.indicator')?.textContent).toBe('2 / 2');

    await mounted.dispose();
  });

  function autoplayContext(intervalMs = 4_000, lifecycleSignal = new AbortController().signal): RendererContext {
    const base = context(undefined, new AbortController().signal, lifecycleSignal);
    return {
      ...base,
      element: { ...base.element, data: { ...base.element.data, autoplay: true, intervalMs } }
    };
  }

  it('keeps autoplay advancing while unrelated renderer updates arrive faster than the interval', async () => {
    vi.useFakeTimers();
    const lifecycleSignal = new AbortController().signal;
    const root = document.createElement('div').attachShadow({ mode: 'open' });
    const mounted = createGalleryRenderer().mount(root, autoplayContext(4_000, lifecycleSignal));
    await vi.advanceTimersByTimeAsync(0);
    const indicator = () => root.querySelector('.indicator')?.textContent;
    expect(indicator()).toBe('1 / 2');

    // The host re-renders every element on its 1.5s canvas refresh poll.
    for (let elapsed = 0; elapsed < 7_500; elapsed += 1_500) {
      await mounted.update(autoplayContext(4_000, lifecycleSignal));
      await vi.advanceTimersByTimeAsync(1_500);
    }

    expect(indicator()).toBe('2 / 2');
    await vi.advanceTimersByTimeAsync(4_000);
    expect(indicator()).toBe('1 / 2');
    await mounted.dispose();
  });

  it('pauses autoplay while hovered and starts a full dwell after leaving', async () => {
    vi.useFakeTimers();
    const root = document.createElement('div').attachShadow({ mode: 'open' });
    const mounted = createGalleryRenderer().mount(root, autoplayContext(4_000));
    await vi.advanceTimersByTimeAsync(0);
    const frame = root.querySelector('figure');
    await vi.advanceTimersByTimeAsync(2_000);
    frame?.dispatchEvent(new Event('pointerenter'));
    await vi.advanceTimersByTimeAsync(10_000);
    expect(root.querySelector('.indicator')?.textContent).toBe('1 / 2');

    frame?.dispatchEvent(new Event('pointerleave'));
    await vi.advanceTimersByTimeAsync(4_000);
    expect(root.querySelector('.indicator')?.textContent).toBe('2 / 2');
    await mounted.dispose();
  });

  it('registers its own settings command and commits a clamped settings patch', async () => {
    const registered: BrowserCommandDescriptor[] = [];
    registerGalleryCommands({ registerCommand: (command) => registered.push(command) });
    expect(registered.map((command) => command.name)).toEqual(['apply-settings']);

    const transact = vi.fn(async () => {});
    const element = context().element;
    const commandContext = {
      pluginId: 'agentcanvas.gallery',
      readOnly: false,
      selection: [],
      viewport: { centerX: 0, centerY: 0, zoom: 1 },
      signal: new AbortController().signal,
      overlays: { open: () => ({ update() {}, close() {} }) },
      executeCommand: async () => true,
      getElement: () => ({ element, revision: 7 }),
      reveal: () => {},
      transact,
      reportDiagnostic: vi.fn()
    } as unknown as BrowserCommandContext;

    await registered[0].execute(commandContext, { elementId: 'gallery', autoplay: true, intervalMs: 900 });

    expect(transact).toHaveBeenCalledWith(
      'Update gallery settings',
      [
        {
          op: 'replaceElementData',
          elementId: 'gallery',
          data: expect.objectContaining({
            autoplay: true,
            intervalMs: 2_000,
            fit: 'contain',
            showControls: true,
            showIndicators: true
          })
        }
      ],
      { expectedRevision: 7 }
    );
  });

  it('opens a settings panel that applies autoplay changes through the element command', async () => {
    const opened: HTMLElement[] = [];
    const dispatched: Array<{ id: string; input?: JsonObject }> = [];
    const rendererContext = {
      ...autoplayContext(),
      overlays: {
        open: (content: Node) => {
          opened.push(content as HTMLElement);
          return { update() {}, close() {} };
        }
      },
      executeCommand: async (id: string, input?: JsonObject) => {
        dispatched.push({ id, input });
        return true;
      }
    } as unknown as RendererContext;

    const renderer = createGalleryRenderer();
    await renderer.details?.open(rendererContext);

    const panel = opened[0];
    expect(panel.querySelector('h2')?.textContent).toBe('Gallery settings');
    const autoplay = panel.querySelector<HTMLInputElement>('input[type="checkbox"]');
    expect(autoplay?.checked).toBe(true);
    const apply = Array.from(panel.querySelectorAll('button')).find((button) => button.textContent === 'Apply');
    expect(apply).toBeDefined();

    if (autoplay) autoplay.checked = false;
    apply?.click();
    await vi.waitFor(() => expect(dispatched).toHaveLength(1));
    expect(dispatched[0].id).toBe('agentcanvas.gallery.apply-settings');
    expect(dispatched[0].input).toEqual(
      expect.objectContaining({ autoplay: false, intervalMs: 4_000, fit: 'contain', showControls: true })
    );
  });
});
