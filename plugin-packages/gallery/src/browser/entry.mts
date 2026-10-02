import type {
  AgentCanvasBrowserPlugin,
  BrowserElementRenderer,
  JsonObject,
  RendererContext
} from '@agentcanvas/plugin-sdk';
import { fitToObjectFit, galleryData, type GalleryData, type GalleryItem } from '../contracts.js';

interface RuntimeGalleryItem {
  id: string;
  contentHandle?: string;
  contentUrl?: string;
  mimeType?: string;
  message?: string;
}

const styles = `
  :host{display:block;width:100%;height:100%;box-sizing:border-box;color:var(--gallery-color,#0f172a);font:13px/1.35 var(--gallery-font,system-ui,sans-serif)}
  .frame{position:relative;box-sizing:border-box;width:100%;height:100%;margin:0;overflow:hidden;border:var(--gallery-border-width,1px) solid var(--gallery-border,#cbd5e1);border-radius:var(--gallery-radius,8px);background:var(--gallery-background,#f8fafc)}
  .media,.placeholder{display:block;box-sizing:border-box;width:100%;height:100%;background:var(--gallery-background,#f8fafc)}
  .media{object-position:center}.placeholder{display:grid;place-items:center;color:var(--gallery-muted,#64748b);font-weight:600;text-align:center}
  .footer{position:absolute;right:0;bottom:0;left:0;display:flex;align-items:center;gap:10px;box-sizing:border-box;min-height:34px;padding:7px 10px;background:var(--gallery-caption-background,rgba(255,255,255,.94));color:var(--gallery-color,#334155)}
  .caption{min-width:0;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.indicator{flex:none;font-weight:650;font-variant-numeric:tabular-nums}
  .nav{position:absolute;top:50%;display:grid;width:34px;height:34px;place-items:center;transform:translateY(-50%);border:1px solid var(--gallery-border,#94a3b8);border-radius:50%;background:var(--gallery-surface,#fff);padding:0;color:var(--gallery-accent,#0f172a);font:700 24px/1 var(--gallery-font,system-ui,sans-serif);cursor:pointer}
  .nav.previous{left:10px}.nav.next{right:10px}.nav:focus-visible,.frame:focus-visible{outline:2px solid var(--gallery-accent,#2563eb);outline-offset:2px}
  [hidden]{display:none!important}
`;

function runtimeItems(runtime: Readonly<JsonObject> | null): RuntimeGalleryItem[] {
  if (!Array.isArray(runtime?.items)) return [];
  return runtime.items.flatMap((value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value) || typeof value.id !== 'string') return [];
    return [
      {
        id: value.id,
        ...(typeof value.contentHandle === 'string' ? { contentHandle: value.contentHandle } : {}),
        ...(typeof value.contentUrl === 'string' ? { contentUrl: value.contentUrl } : {}),
        ...(typeof value.mimeType === 'string' ? { mimeType: value.mimeType } : {}),
        ...(typeof value.message === 'string' ? { message: value.message } : {})
      }
    ];
  });
}

function safeResourceUrl(value: string | undefined): string | null {
  if (!value) return null;
  const url = new URL(value, window.location.href);
  if (
    url.origin !== window.location.origin ||
    !/^\/api\/v1\/resources\/[A-Za-z0-9_-]+\/content$/.test(url.pathname) ||
    url.search ||
    url.hash
  ) {
    return null;
  }
  return url.href;
}

export function createGalleryRenderer(): BrowserElementRenderer {
  return {
    type: 'agentcanvas.gallery/gallery',
    schemaVersions: [1],
    placement: 'node',
    mount(root, initial) {
      const style = document.createElement('style');
      style.textContent = styles;
      const frame = document.createElement('figure');
      frame.className = 'frame';
      frame.tabIndex = 0;
      frame.dataset.agentcanvasInteractive = '';
      frame.setAttribute('role', 'region');
      frame.setAttribute('aria-roledescription', 'carousel');
      frame.setAttribute('aria-label', 'Media gallery');
      const image = document.createElement('img');
      image.className = 'media';
      const placeholder = document.createElement('div');
      placeholder.className = 'placeholder';
      placeholder.setAttribute('role', 'status');
      placeholder.textContent = 'Image unavailable';
      const previous = document.createElement('button');
      previous.type = 'button';
      previous.className = 'nav previous';
      previous.dataset.agentcanvasInteractive = '';
      previous.setAttribute('aria-label', 'Previous image');
      previous.textContent = '\u2039';
      const next = document.createElement('button');
      next.type = 'button';
      next.className = 'nav next';
      next.dataset.agentcanvasInteractive = '';
      next.setAttribute('aria-label', 'Next image');
      next.textContent = '\u203a';
      const footer = document.createElement('figcaption');
      footer.className = 'footer';
      const caption = document.createElement('span');
      caption.className = 'caption';
      const indicator = document.createElement('span');
      indicator.className = 'indicator';
      indicator.setAttribute('aria-live', 'polite');
      footer.append(caption, indicator);
      frame.append(placeholder, previous, next, footer);
      root.replaceChildren(style, frame);

      let context = initial;
      let data: GalleryData = galleryData(initial.element.data);
      let activeIndex = Math.min(data.initialIndex, data.items.length - 1);
      let activeItemId: string | null = data.items[activeIndex]?.id ?? null;
      let objectUrl: string | null = null;
      let request: AbortController | null = null;
      let timer: ReturnType<typeof setInterval> | null = null;
      let hovered = false;
      let focused = false;
      let disposed = false;
      let requestVersion = 0;

      const revoke = () => {
        request?.abort();
        request = null;
        requestVersion += 1;
        if (objectUrl) URL.revokeObjectURL(objectUrl);
        objectUrl = null;
        image.removeAttribute('src');
      };

      const activeItem = (): GalleryItem => data.items[activeIndex] ?? data.items[0];

      const syncChrome = () => {
        const item = activeItem();
        const multiple = data.items.length > 1;
        previous.hidden = !data.showControls || !multiple;
        next.hidden = !data.showControls || !multiple;
        caption.textContent = item.caption ?? '';
        caption.hidden = !item.caption;
        indicator.textContent = `${activeIndex + 1} / ${data.items.length}`;
        indicator.hidden = !data.showIndicators;
        footer.hidden = !item.caption && !data.showIndicators;
        image.alt = item.alt ?? item.caption ?? `Gallery image ${activeIndex + 1}`;
        image.style.objectFit = fitToObjectFit(data.fit);
        frame.setAttribute('aria-label', item.caption ? `Media gallery: ${item.caption}` : 'Media gallery');
      };

      const showPlaceholder = () => {
        frame.replaceChildren(placeholder, previous, next, footer);
      };

      const loadActive = async () => {
        revoke();
        syncChrome();
        showPlaceholder();
        const item = activeItem();
        const runtime = runtimeItems(context.runtime).find((candidate) => candidate.id === item.id);
        placeholder.textContent = runtime?.message ?? 'Image unavailable';
        const url = safeResourceUrl(runtime?.contentUrl);
        if (!runtime?.contentHandle || !url || !runtime.mimeType?.toLowerCase().startsWith('image/')) return;
        const version = requestVersion;
        request = new AbortController();
        const signal = AbortSignal.any([request.signal, context.signal]);
        try {
          const response = await fetch(url, {
            headers: { accept: 'image/avif,image/webp,image/png,image/jpeg,image/gif' },
            credentials: 'same-origin',
            signal
          });
          if (!response.ok) throw new Error(`Gallery image request failed with HTTP ${response.status}`);
          const mimeType = String(response.headers.get('content-type') ?? runtime.mimeType)
            .split(';')[0]
            .trim()
            .toLowerCase();
          if (!mimeType.startsWith('image/')) throw new Error('Gallery resource did not return an image');
          const blob = await response.blob();
          if (disposed || signal.aborted || version !== requestVersion) return;
          objectUrl = URL.createObjectURL(blob);
          image.src = objectUrl;
          frame.replaceChildren(image, previous, next, footer);
        } catch {
          if (disposed || signal.aborted || version !== requestVersion) return;
          context.reportDiagnostic({
            code: 'gallery_image_content_failed',
            severity: 'warning',
            message: `Gallery image ${item.id} could not be loaded.`,
            retryable: true,
            pluginId: 'agentcanvas.gallery',
            elementId: context.element.id
          });
          showPlaceholder();
        }
      };

      const restartTimer = () => {
        if (timer) clearInterval(timer);
        timer = null;
        if (!data.autoplay || data.items.length < 2 || hovered || focused || context.lifecycle.reducedMotion) return;
        timer = setInterval(() => {
          activeIndex = (activeIndex + 1) % data.items.length;
          activeItemId = data.items[activeIndex].id;
          void loadActive();
        }, data.intervalMs);
      };

      const move = (delta: number) => {
        if (data.items.length < 2) return;
        activeIndex = (activeIndex + delta + data.items.length) % data.items.length;
        activeItemId = data.items[activeIndex].id;
        void loadActive();
        restartTimer();
      };

      const onPrevious = () => move(-1);
      const onNext = () => move(1);
      const onKeyDown = (event: KeyboardEvent) => {
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
        event.preventDefault();
        move(event.key === 'ArrowLeft' ? -1 : 1);
      };
      const onPointerEnter = () => {
        hovered = true;
        restartTimer();
      };
      const onPointerLeave = () => {
        hovered = false;
        restartTimer();
      };
      const onFocusIn = () => {
        focused = true;
        restartTimer();
      };
      const onFocusOut = (event: FocusEvent) => {
        focused = event.relatedTarget instanceof Node && frame.contains(event.relatedTarget);
        restartTimer();
      };
      previous.addEventListener('click', onPrevious);
      next.addEventListener('click', onNext);
      frame.addEventListener('keydown', onKeyDown);
      frame.addEventListener('pointerenter', onPointerEnter);
      frame.addEventListener('pointerleave', onPointerLeave);
      frame.addEventListener('focusin', onFocusIn);
      frame.addEventListener('focusout', onFocusOut);
      const update = async (nextContext: RendererContext) => {
        context = nextContext;
        const nextData = galleryData(nextContext.element.data);
        const retained = activeItemId ? nextData.items.findIndex((item) => item.id === activeItemId) : -1;
        data = nextData;
        activeIndex = retained >= 0 ? retained : Math.min(data.initialIndex, data.items.length - 1);
        activeItemId = data.items[activeIndex]?.id ?? null;
        const styleData = nextContext.element.style ?? {};
        const { colors, typography, shape } = nextContext.theme;
        frame.style.setProperty(
          '--gallery-background',
          typeof styleData.background === 'string' ? styleData.background : colors.surfaceMuted
        );
        frame.style.setProperty(
          '--gallery-border',
          typeof styleData.borderColor === 'string' ? styleData.borderColor : colors.border
        );
        frame.style.setProperty(
          '--gallery-border-width',
          `${typeof styleData.borderWidth === 'number' ? styleData.borderWidth : shape.borderWidth}px`
        );
        frame.style.setProperty(
          '--gallery-radius',
          `${typeof styleData.borderRadius === 'number' ? styleData.borderRadius : shape.radius}px`
        );
        frame.style.setProperty('--gallery-color', typeof styleData.color === 'string' ? styleData.color : colors.text);
        frame.style.setProperty(
          '--gallery-accent',
          typeof styleData.accentColor === 'string' ? styleData.accentColor : colors.accent
        );
        frame.style.setProperty(
          '--gallery-caption-background',
          typeof styleData.captionBackground === 'string' ? styleData.captionBackground : colors.surface
        );
        frame.style.setProperty('--gallery-surface', colors.surface);
        frame.style.setProperty('--gallery-muted', colors.textMuted);
        frame.style.setProperty('--gallery-font', typography.bodyFont);
        await loadActive();
        restartTimer();
      };

      void update(initial);
      return {
        update,
        dispose() {
          if (disposed) return;
          disposed = true;
          if (timer) clearInterval(timer);
          previous.removeEventListener('click', onPrevious);
          next.removeEventListener('click', onNext);
          frame.removeEventListener('keydown', onKeyDown);
          frame.removeEventListener('pointerenter', onPointerEnter);
          frame.removeEventListener('pointerleave', onPointerLeave);
          frame.removeEventListener('focusin', onFocusIn);
          frame.removeEventListener('focusout', onFocusOut);
          revoke();
          root.replaceChildren();
        }
      };
    }
  };
}

const plugin: AgentCanvasBrowserPlugin = {
  activate(host) {
    host.registerRenderer(createGalleryRenderer());
  }
};

export default plugin;
