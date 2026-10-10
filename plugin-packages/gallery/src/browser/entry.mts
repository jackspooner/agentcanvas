import type {
  AgentCanvasBrowserPlugin,
  BrowserCommandContext,
  BrowserElementRenderer,
  JsonObject,
  RendererContext
} from '@agentcanvas/plugin-sdk';
import { fitToObjectFit, type GalleryData, type GalleryFit, type GalleryItem, galleryData } from '../contracts.js';

interface RuntimeGalleryItem {
  id: string;
  contentHandle?: string;
  contentUrl?: string;
  mimeType?: string;
  message?: string;
}

const GALLERY_ELEMENT_TYPE = 'agentcanvas.gallery/gallery';
const MINIMUM_INTERVAL_MS = 2_000;
const MAXIMUM_INTERVAL_MS = 60_000;

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

function clampInterval(value: number): number {
  return Math.min(MAXIMUM_INTERVAL_MS, Math.max(MINIMUM_INTERVAL_MS, Math.round(value)));
}

function isGalleryFit(value: unknown): value is GalleryFit {
  return value === 'contain' || value === 'cover' || value === 'stretch' || value === 'original';
}

/** Committed settings patch for one gallery element. */
function settingsPatch(input: JsonObject | undefined): Partial<GalleryData> {
  const patch: Partial<GalleryData> = {};
  if (typeof input?.autoplay === 'boolean') patch.autoplay = input.autoplay;
  if (typeof input?.intervalMs === 'number' && Number.isFinite(input.intervalMs)) {
    patch.intervalMs = clampInterval(input.intervalMs);
  }
  if (isGalleryFit(input?.fit)) patch.fit = input.fit;
  if (typeof input?.showControls === 'boolean') patch.showControls = input.showControls;
  if (typeof input?.showIndicators === 'boolean') patch.showIndicators = input.showIndicators;
  return patch;
}

async function applySettings(context: BrowserCommandContext, input?: JsonObject): Promise<void> {
  const elementId =
    typeof input?.elementId === 'string'
      ? input.elementId
      : context.selection.find((element) => element.type === GALLERY_ELEMENT_TYPE)?.id;
  if (!elementId) throw new Error('Select a gallery first.');
  const current = context.getElement?.(elementId);
  if (!current || current.element.type !== GALLERY_ELEMENT_TYPE) throw new Error('Select a gallery first.');
  const patch = settingsPatch(input);
  if (Object.keys(patch).length === 0) throw new Error('At least one gallery setting is required.');
  const data: GalleryData = { ...galleryData(current.element.data), ...patch };
  await context.transact(
    'Update gallery settings',
    [{ op: 'replaceElementData', elementId, data: data as unknown as JsonObject }],
    { expectedRevision: current.revision }
  );
}

async function dispatch(context: RendererContext, name: string, input?: JsonObject): Promise<void> {
  if (!context.executeCommand) throw new Error('Gallery settings require host renderer commands.');
  const okay = await context.executeCommand(`agentcanvas.gallery.${name}`, input);
  if (!okay) throw new Error('The gallery command is unavailable.');
}

function labelledRow(label: string, control: HTMLElement): HTMLLabelElement {
  const row = document.createElement('label');
  row.style.cssText = 'display:grid;grid-template-columns:max-content 1fr;align-items:center;gap:10px;padding:6px 0';
  const text = document.createElement('span');
  text.textContent = label;
  row.append(text, control);
  return row;
}

function checkbox(checked: boolean, disabled: boolean): HTMLInputElement {
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = checked;
  input.disabled = disabled;
  input.dataset.agentcanvasInteractive = '';
  input.style.cssText = 'justify-self:start;width:18px;height:18px';
  return input;
}

/** Element-owned settings panel: the editor affordance for gallery autoplay. */
function settingsPanel(context: RendererContext, close: () => void): HTMLElement {
  const data = galleryData(context.element.data);
  const locked = context.readOnly || Boolean(context.element.locked);
  const panel = document.createElement('section');
  panel.dataset.agentcanvasInteractive = '';
  panel.style.cssText =
    'box-sizing:border-box;width:min(460px,calc(100vw - 32px));max-height:calc(100vh - 32px);overflow:auto;border:1px solid #cbd5e1;border-radius:12px;background:#fff;padding:18px;color:#0f172a;font:13px/1.4 system-ui,sans-serif;box-shadow:0 20px 50px rgba(15,23,42,.25)';
  const heading = document.createElement('h2');
  heading.textContent = 'Gallery settings';
  heading.style.cssText = 'margin:0 44px 10px 0;font-size:16px';
  const closeButton = document.createElement('button');
  closeButton.type = 'button';
  closeButton.textContent = 'Close';
  closeButton.dataset.agentcanvasInteractive = '';
  closeButton.style.cssText = 'float:right;border:1px solid #cbd5e1;border-radius:6px;background:#fff;padding:5px 8px';
  closeButton.addEventListener('click', close);

  const autoplay = checkbox(data.autoplay, locked);
  const showControls = checkbox(data.showControls, locked);
  const showIndicators = checkbox(data.showIndicators, locked);
  const interval = document.createElement('input');
  interval.type = 'number';
  interval.min = String(MINIMUM_INTERVAL_MS / 1_000);
  interval.max = String(MAXIMUM_INTERVAL_MS / 1_000);
  interval.step = '0.5';
  interval.value = String(data.intervalMs / 1_000);
  interval.disabled = locked;
  interval.dataset.agentcanvasInteractive = '';
  interval.style.cssText = 'justify-self:start;width:110px;border:1px solid #cbd5e1;border-radius:6px;padding:4px 6px';
  const fit = document.createElement('select');
  fit.disabled = locked;
  fit.dataset.agentcanvasInteractive = '';
  fit.style.cssText = 'justify-self:start;border:1px solid #cbd5e1;border-radius:6px;padding:4px 6px';
  for (const option of ['contain', 'cover', 'stretch', 'original'] as const) {
    const item = document.createElement('option');
    item.value = option;
    item.textContent = option;
    item.selected = option === data.fit;
    fit.append(item);
  }

  const detail = document.createElement('p');
  detail.style.cssText = 'margin:10px 0 0;color:#64748b';
  detail.textContent = `${data.items.length} image${data.items.length === 1 ? '' : 's'}`;

  const apply = document.createElement('button');
  apply.type = 'button';
  apply.textContent = 'Apply';
  apply.dataset.agentcanvasInteractive = '';
  apply.disabled = locked;
  apply.style.cssText =
    'margin-top:14px;border:1px solid #2563eb;border-radius:6px;background:#2563eb;color:#fff;padding:7px 12px;font-weight:600';
  const status = document.createElement('p');
  status.setAttribute('role', 'status');
  status.style.cssText = 'margin:10px 0 0;color:#b91c1c';
  if (locked) status.textContent = 'This canvas is read-only.';

  apply.addEventListener('click', () => {
    apply.disabled = true;
    status.textContent = '';
    const seconds = Number(interval.value);
    void dispatch(context, 'apply-settings', {
      autoplay: autoplay.checked,
      intervalMs: Number.isFinite(seconds) ? Math.round(seconds * 1_000) : data.intervalMs,
      fit: fit.value,
      showControls: showControls.checked,
      showIndicators: showIndicators.checked
    })
      .then(() => close())
      .catch((error: unknown) => {
        apply.disabled = false;
        status.textContent = error instanceof Error ? error.message : 'Gallery settings could not be applied.';
      });
  });

  panel.append(
    closeButton,
    heading,
    labelledRow('Autoplay', autoplay),
    labelledRow('Seconds per image', interval),
    labelledRow('Fit', fit),
    labelledRow('Show controls', showControls),
    labelledRow('Show indicators', showIndicators),
    detail,
    apply,
    status
  );
  return panel;
}

async function openGallerySettings(context: RendererContext): Promise<void> {
  const overlay = context.overlays.open(
    settingsPanel(context, () => overlay.close()),
    {
      modal: true,
      label: 'Gallery settings'
    }
  );
  context.signal.addEventListener('abort', () => overlay.close(), { once: true });
}

export function registerGalleryCommands(host: {
  registerCommand?(command: {
    name: string;
    title: string;
    isEnabled?(context: BrowserCommandContext): boolean;
    execute(context: BrowserCommandContext, input?: JsonObject): void | Promise<void>;
  }): void;
}): void {
  host.registerCommand?.({
    name: 'apply-settings',
    title: 'Update gallery settings',
    isEnabled: (context) => !context.readOnly,
    execute: applySettings
  });
}

export function createGalleryRenderer(): BrowserElementRenderer {
  return {
    type: GALLERY_ELEMENT_TYPE,
    schemaVersions: [1],
    placement: 'node',
    details: { open: openGallerySettings, label: 'Settings' },
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
      let timer: ReturnType<typeof setTimeout> | null = null;
      let autoplaySignature: string | null = null;
      let autoplayDeadline = 0;
      let hovered = false;
      let focused = false;
      let disposed = false;
      let requestVersion = 0;
      let activeResourceKey: string | null = null;

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

      const loadActive = () => {
        syncChrome();
        const item = activeItem();
        const runtime = runtimeItems(context.runtime).find((candidate) => candidate.id === item.id);
        placeholder.textContent = runtime?.message ?? 'Image unavailable';
        const url = safeResourceUrl(runtime?.contentUrl);
        const canLoad = Boolean(runtime?.contentHandle && url && runtime.mimeType?.toLowerCase().startsWith('image/'));
        const resourceKey = canLoad
          ? JSON.stringify([item.id, item.source, runtime?.contentHandle, url, runtime?.mimeType?.toLowerCase()])
          : null;
        if (resourceKey === activeResourceKey) return;

        revoke();
        activeResourceKey = resourceKey;
        showPlaceholder();
        if (!canLoad || !runtime || !url) return;
        const version = requestVersion;
        request = new AbortController();
        const signal = AbortSignal.any([request.signal, context.lifecycle.signal]);
        const load = async () => {
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
            activeResourceKey = null;
            context.reportDiagnostic({
              code: 'gallery_image_content_failed',
              severity: 'warning',
              message: `Gallery image ${item.id} could not be loaded.`,
              retryable: true,
              pluginId: 'agentcanvas.gallery',
              elementId: context.element.id
            });
            showPlaceholder();
          } finally {
            if (version === requestVersion) {
              request = null;
            }
          }
        };
        void load();
      };

      const clearTimer = () => {
        if (timer) clearTimeout(timer);
        timer = null;
      };

      const autoplayPaused = () =>
        !data.autoplay || data.items.length < 2 || hovered || focused || context.lifecycle.reducedMotion;

      const autoplaySignatureFor = () =>
        JSON.stringify([
          data.autoplay,
          data.intervalMs,
          data.items.map((item) => item.id),
          hovered,
          focused,
          context.lifecycle.reducedMotion
        ]);

      // Autoplay keeps its remaining dwell time across unrelated renderer updates
      // (host refresh, theme, selection, viewport): only a real settings, items or
      // pause-state change, and an explicit navigation, restart the countdown.
      // Restarting on every update made the interval unreachable whenever the host
      // rendered its elements more often than intervalMs.
      const restartTimer = (restart = false) => {
        const signature = autoplaySignatureFor();
        const now = Date.now();
        if (autoplayPaused()) {
          clearTimer();
          autoplaySignature = signature;
          autoplayDeadline = 0;
          return;
        }
        if (restart || signature !== autoplaySignature || now >= autoplayDeadline) {
          autoplayDeadline = now + data.intervalMs;
        }
        autoplaySignature = signature;
        clearTimer();
        timer = setTimeout(
          () => {
            timer = null;
            activeIndex = (activeIndex + 1) % data.items.length;
            activeItemId = data.items[activeIndex].id;
            void loadActive();
            restartTimer(true);
          },
          Math.max(0, autoplayDeadline - Date.now())
        );
      };

      const move = (delta: number) => {
        if (data.items.length < 2) return;
        activeIndex = (activeIndex + delta + data.items.length) % data.items.length;
        activeItemId = data.items[activeIndex].id;
        void loadActive();
        restartTimer(true);
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
        loadActive();
        restartTimer();
      };

      void update(initial);
      return {
        update,
        dispose() {
          if (disposed) return;
          disposed = true;
          clearTimer();
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
    registerGalleryCommands(host);
    host.registerRenderer(createGalleryRenderer());
  }
};

export default plugin;
