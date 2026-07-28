import type {
  AgentCanvasBrowserPlugin,
  BrowserElementRenderer,
  BrowserPluginHost,
  JsonObject,
  RendererContext
} from '@agentcanvas/plugin-sdk';
import { modelData } from '../data.js';

interface BrowserResource {
  url: string;
  mimeType: string;
}
type ModelViewerElement = HTMLElement & { pause?: () => void; dismissPoster?: () => void };
type ModelViewerImporter = () => Promise<unknown>;

let modelViewerRegistration: Promise<void> | null = null;

export async function ensureModelViewerRegistered(
  importer: ModelViewerImporter = () => import('@google/model-viewer')
): Promise<void> {
  if (customElements.get('model-viewer')) return;
  modelViewerRegistration ??= importer().then(() => {
    if (!customElements.get('model-viewer')) throw new Error('model-viewer did not register its custom element');
  });
  await modelViewerRegistration;
}

function resource(runtime: Readonly<JsonObject> | null, key: string): BrowserResource | null {
  const value = runtime?.[key];
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return typeof value.url === 'string' && typeof value.mimeType === 'string'
    ? { url: value.url, mimeType: value.mimeType }
    : null;
}

async function objectUrl(
  source: BrowserResource,
  signal: AbortSignal,
  accepted: (mimeType: string) => boolean
): Promise<string> {
  const resolved = new URL(source.url, window.location.href);
  if (resolved.origin !== window.location.origin) throw new Error('resource URL must be same-origin');
  const response = await fetch(resolved, { signal, credentials: 'same-origin' });
  if (!response.ok) throw new Error(`resource request failed with HTTP ${response.status}`);
  const mimeType = (response.headers.get('content-type') ?? source.mimeType).split(';')[0].trim().toLowerCase();
  if (!accepted(mimeType)) throw new Error(`resource MIME type ${mimeType || 'unknown'} is invalid`);
  return URL.createObjectURL(await response.blob());
}

function resourceUrl(source: BrowserResource, accepted: (mimeType: string) => boolean): string {
  const resolved = new URL(source.url, window.location.href);
  if (resolved.origin !== window.location.origin) throw new Error('resource URL must be same-origin');
  const mimeType = source.mimeType.split(';')[0].trim().toLowerCase();
  if (!accepted(mimeType)) throw new Error(`resource MIME type ${mimeType || 'unknown'} is invalid`);
  return resolved.toString();
}

function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function display(value: unknown, fallback = 'not recorded'): string {
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  return fallback;
}

function formatBytes(value: unknown): string | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return undefined;
  if (value < 1024) return `${value} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let amount = value;
  let unit = 'B';
  for (const candidate of units) {
    amount /= 1024;
    unit = candidate;
    if (amount < 1024) break;
  }
  return `${amount >= 10 ? amount.toFixed(1) : amount.toFixed(2)} ${unit}`;
}

function detailRow(list: HTMLDListElement, label: string, value: unknown): void {
  const term = document.createElement('dt');
  term.textContent = label;
  term.style.fontWeight = '700';
  const description = document.createElement('dd');
  description.textContent = display(value);
  description.style.margin = '0';
  description.style.overflowWrap = 'anywhere';
  list.append(term, description);
}

function loadingPanel(message: string): HTMLElement {
  const panel = document.createElement('section');
  panel.dataset.agentcanvasInteractive = '';
  panel.style.cssText =
    'border:1px solid #cbd5e1;border-radius:10px;background:#fff;padding:18px;color:#334155;font:13px system-ui,sans-serif';
  panel.textContent = message;
  return panel;
}

function modelDetailsPanel(details: JsonObject, context: RendererContext, close: () => void): HTMLElement {
  const panel = document.createElement('section');
  panel.dataset.agentcanvasInteractive = '';
  panel.style.cssText =
    'box-sizing:border-box;width:min(680px,calc(100vw - 32px));max-height:calc(100vh - 32px);overflow:auto;border:1px solid #cbd5e1;border-radius:12px;background:#fff;padding:18px;color:#0f172a;font:13px/1.4 system-ui,sans-serif;box-shadow:0 20px 50px rgba(15,23,42,.25)';
  const closeButton = document.createElement('button');
  closeButton.type = 'button';
  closeButton.textContent = 'Close';
  closeButton.dataset.agentcanvasInteractive = '';
  closeButton.style.cssText = 'float:right;border:1px solid #cbd5e1;border-radius:6px;background:#fff;padding:5px 8px';
  closeButton.addEventListener('click', close);
  const heading = document.createElement('h2');
  heading.textContent = '3D model details';
  heading.style.margin = '0 44px 14px 0';

  const model = object(details.model);
  const asset = object(model.asset);
  const generation = object(model.generation);
  const data = modelData(context.element);
  const logicalPath =
    asset.assetKey ??
    [asset.groupPath, asset.filename].filter((value) => typeof value === 'string' && value.length > 0).join('/');
  const list = document.createElement('dl');
  list.style.cssText = 'display:grid;grid-template-columns:max-content 1fr;gap:7px 14px;margin:0';
  detailRow(list, 'Project', asset.project);
  detailRow(list, 'Asset path', logicalPath);
  detailRow(list, 'Asset ID', asset.assetId);
  detailRow(list, 'Filename', asset.filename);
  detailRow(list, 'Content type', asset.contentType);
  detailRow(list, 'File size', formatBytes(asset.sizeBytes));
  detailRow(list, 'Created', asset.createdAt);
  detailRow(list, 'Generated at', generation.generatedAt ?? asset.createdAt);
  detailRow(
    list,
    'Provider / model',
    [generation.provider, generation.model].filter((value) => typeof value === 'string' && value).join(' / ') ||
      undefined
  );
  detailRow(list, 'Camera controls', data.cameraControls ? 'enabled' : 'disabled');
  detailRow(list, 'Auto rotate', data.autoRotate ? 'enabled' : 'disabled');

  panel.append(closeButton, heading, list);
  if (generation.prompt !== undefined && generation.prompt !== null) {
    const promptHeading = document.createElement('h3');
    promptHeading.textContent = 'Generation prompt';
    promptHeading.style.margin = '18px 0 6px';
    const prompt = document.createElement('pre');
    prompt.textContent = display(generation.prompt);
    prompt.style.cssText =
      'margin:0;white-space:pre-wrap;overflow-wrap:anywhere;background:#f8fafc;padding:10px;border-radius:7px';
    panel.append(promptHeading, prompt);
  }
  if (Array.isArray(generation.contextImages) && generation.contextImages.length > 0) {
    const sourceHeading = document.createElement('h3');
    sourceHeading.textContent = 'Source images';
    sourceHeading.style.margin = '18px 0 6px';
    const sources = document.createElement('pre');
    sources.textContent = JSON.stringify(generation.contextImages, null, 2);
    sources.style.cssText =
      'margin:0;white-space:pre-wrap;overflow-wrap:anywhere;background:#f8fafc;padding:10px;border-radius:7px';
    panel.append(sourceHeading, sources);
  }
  const poster = object(details.poster);
  const posterAsset = object(poster.asset);
  if (Object.keys(posterAsset).length > 0) {
    const posterHeading = document.createElement('h3');
    posterHeading.textContent = 'Poster image';
    posterHeading.style.margin = '18px 0 6px';
    const posterList = document.createElement('dl');
    posterList.style.cssText = 'display:grid;grid-template-columns:max-content 1fr;gap:7px 14px;margin:0';
    detailRow(posterList, 'Asset path', posterAsset.assetKey ?? posterAsset.groupPath);
    detailRow(posterList, 'Filename', posterAsset.filename);
    detailRow(posterList, 'File size', formatBytes(posterAsset.sizeBytes));
    panel.append(posterHeading, posterList);
  }
  return panel;
}

async function fetchModelDetails(context: RendererContext): Promise<JsonObject> {
  const data = modelData(context.element);
  const response = await fetch('/api/v1/plugins/agentcanvas.glb-viewer/procedures/details', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({ assetRef: data.assetRef, posterAssetRef: data.posterAssetRef }),
    signal: context.signal
  });
  if (!response.ok) throw new Error(`GLB details request failed with HTTP ${response.status}`);
  const body = (await response.json()) as { details?: JsonObject };
  if (!body.details) throw new Error('GLB details response was invalid');
  return body.details;
}

async function openModelDetails(context: RendererContext): Promise<void> {
  const overlay = context.overlays.open(loadingPanel('Loading 3D model details…'), {
    modal: true,
    label: '3D model details'
  });
  const close = () => overlay.close();
  context.signal.addEventListener('abort', close, { once: true });
  try {
    const details = await fetchModelDetails(context);
    if (!context.signal.aborted) overlay.update(modelDetailsPanel(details, context, close));
  } catch {
    if (!context.signal.aborted) overlay.update(loadingPanel('3D model details could not be loaded.'));
  }
}

export function createModelRenderer(): BrowserElementRenderer {
  return {
    type: 'agentcanvas.glb-viewer/model',
    schemaVersions: [1],
    placement: 'node',
    details: { open: openModelDetails },
    mount(root, initial) {
      const style = document.createElement('style');
      style.textContent =
        ':host{display:block;width:100%;height:100%}.frame{position:relative;width:100%;height:100%;overflow:hidden;border:var(--model-border-width,1px) solid var(--model-border,#94a3b8);border-radius:var(--model-radius,8px);background:var(--model-background,#e2e8f0)}.viewer{display:block;width:100%;height:100%;background:transparent;touch-action:none}.caption{position:absolute;left:0;right:0;bottom:0;box-sizing:border-box;padding:8px 10px;background:var(--model-caption-background,#fff);color:var(--model-caption-color,#0f172a);font:600 13px/1.3 var(--model-font,Inter,Arial,sans-serif);pointer-events:none}';
      const frame = document.createElement('div');
      frame.className = 'frame';
      const caption = document.createElement('div');
      caption.className = 'caption';
      root.replaceChildren(style, frame);
      let viewer: ModelViewerElement | null = null;
      let disposed = false;
      let generation = 0;
      let controller: AbortController | null = null;
      let sourceUrl: string | null = null;
      let posterUrl: string | null = null;
      let posterKey: string | null = null;
      let currentContext = initial;

      const release = () => {
        controller?.abort();
        controller = null;
        viewer?.pause?.();
        viewer?.dismissPoster?.();
        viewer?.removeAttribute('src');
        viewer?.removeAttribute('poster');
        viewer?.remove();
        viewer = null;
        if (sourceUrl?.startsWith('blob:')) URL.revokeObjectURL(sourceUrl);
        if (posterUrl) URL.revokeObjectURL(posterUrl);
        sourceUrl = null;
        posterUrl = null;
        posterKey = null;
      };

      const applyPresentation = (context: RendererContext) => {
        const styleData = context.element.style ?? {};
        frame.style.setProperty(
          '--model-background',
          typeof styleData.background === 'string' ? styleData.background : context.theme.colors.surfaceMuted
        );
        frame.style.setProperty(
          '--model-border',
          typeof styleData.borderColor === 'string' ? styleData.borderColor : context.theme.colors.border
        );
        frame.style.setProperty(
          '--model-border-width',
          `${typeof styleData.borderWidth === 'number' ? styleData.borderWidth : context.theme.shape.borderWidth}px`
        );
        frame.style.setProperty(
          '--model-radius',
          `${typeof styleData.borderRadius === 'number' ? styleData.borderRadius : context.theme.shape.radius}px`
        );
        frame.style.setProperty('--model-caption-background', context.theme.colors.surface);
        frame.style.setProperty(
          '--model-caption-color',
          typeof styleData.color === 'string' ? styleData.color : context.theme.colors.text
        );
        frame.style.setProperty('--model-font', context.theme.typography.bodyFont);
        caption.textContent = typeof context.element.data.caption === 'string' ? context.element.data.caption : '';
        caption.hidden = !caption.textContent;
        if (!viewer) return;
        viewer.setAttribute(
          'alt',
          typeof context.element.data.alt === 'string' ? context.element.data.alt : '3D model'
        );
        viewer.toggleAttribute('camera-controls', context.element.data.cameraControls === true);
        viewer.toggleAttribute('auto-rotate', context.element.data.autoRotate === true);
      };

      const update = async (context: RendererContext): Promise<void> => {
        generation += 1;
        const requestedGeneration = generation;
        currentContext = context;
        if (disposed) return;
        applyPresentation(context);
        const source = resource(context.runtime, 'source');
        const poster = resource(context.runtime, 'poster');
        if (!source) {
          release();
          context.reportDiagnostic({
            code: 'glb_resource_missing',
            severity: 'error',
            message: 'The GLB resource is unavailable.',
            retryable: true,
            pluginId: 'agentcanvas.glb-viewer',
            elementId: context.element.id
          });
          return;
        }
        let nextSourceUrl: string;
        try {
          nextSourceUrl = resourceUrl(
            source,
            (mime) => mime === 'model/gltf-binary' || mime === 'application/octet-stream'
          );
        } catch {
          release();
          context.reportDiagnostic({
            code: 'glb_resource_failed',
            severity: 'error',
            message: 'The GLB resource could not be loaded.',
            retryable: true,
            pluginId: 'agentcanvas.glb-viewer',
            elementId: context.element.id
          });
          return;
        }
        const nextPosterKey = poster ? `${poster.url}\n${poster.mimeType}` : null;
        if (viewer && sourceUrl === nextSourceUrl && posterKey === nextPosterKey) return;
        release();
        controller = new AbortController();
        const signal = AbortSignal.any([controller.signal, context.signal]);
        try {
          await ensureModelViewerRegistered();
          const posterResult = await Promise.allSettled([
            poster ? objectUrl(poster, signal, (mime) => mime.startsWith('image/')) : Promise.resolve(null)
          ]).then(([result]) => result);
          if (disposed || requestedGeneration !== generation || signal.aborted) {
            if (posterResult.status === 'fulfilled' && posterResult.value) URL.revokeObjectURL(posterResult.value);
            return;
          }
          sourceUrl = nextSourceUrl;
          posterKey = nextPosterKey;
          viewer = document.createElement('model-viewer') as ModelViewerElement;
          const mountedViewer = viewer;
          viewer.className = 'viewer';
          viewer.dataset.agentcanvasInteractive = '';
          viewer.addEventListener('pointerdown', (event) => event.stopPropagation());
          viewer.addEventListener('error', () => {
            if (!disposed && viewer === mountedViewer)
              currentContext.reportDiagnostic({
                code: 'glb_render_failed',
                severity: 'error',
                message: 'The GLB viewer could not decode the model or one of its embedded resources.',
                retryable: true,
                pluginId: 'agentcanvas.glb-viewer',
                elementId: currentContext.element.id
              });
          });
          viewer.setAttribute('src', sourceUrl);
          if (posterResult.status === 'fulfilled' && posterResult.value) {
            posterUrl = posterResult.value;
            viewer.setAttribute('poster', posterUrl);
          } else if (posterResult.status === 'rejected') {
            context.reportDiagnostic({
              code: 'glb_poster_failed',
              severity: 'warning',
              message: 'The GLB poster could not be loaded.',
              retryable: true,
              pluginId: 'agentcanvas.glb-viewer',
              elementId: context.element.id
            });
          }
          applyPresentation(context);
          frame.replaceChildren(viewer, caption);
        } catch {
          if (!signal.aborted)
            context.reportDiagnostic({
              code: 'glb_resource_failed',
              severity: 'error',
              message: 'The GLB resource could not be loaded.',
              retryable: true,
              pluginId: 'agentcanvas.glb-viewer',
              elementId: context.element.id
            });
        }
      };

      void update(initial);
      return {
        update,
        dispose() {
          if (disposed) return;
          disposed = true;
          generation += 1;
          release();
          root.replaceChildren();
        }
      };
    }
  };
}

const plugin: AgentCanvasBrowserPlugin = {
  activate(host: BrowserPluginHost) {
    host.registerRenderer(createModelRenderer());
  }
};

export default plugin;
