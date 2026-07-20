import type {
  AgentCanvasBrowserPlugin,
  BrowserElementRenderer,
  BrowserPluginHost,
  JsonObject,
  RendererContext
} from '@agentcanvas/plugin-sdk';

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

export function createModelRenderer(): BrowserElementRenderer {
  return {
    type: 'agentcanvas.glb-viewer/model',
    schemaVersions: [1],
    placement: 'node',
    mount(root, initial) {
      const style = document.createElement('style');
      style.textContent =
        ':host{display:block;width:100%;height:100%}.frame{position:relative;width:100%;height:100%;overflow:hidden;border:var(--model-border-width,1px) solid var(--model-border,#94a3b8);border-radius:var(--model-radius,8px);background:var(--model-background,#e2e8f0)}.viewer{display:block;width:100%;height:100%;background:transparent}.caption{position:absolute;left:0;right:0;bottom:0;box-sizing:border-box;padding:8px 10px;background:var(--model-caption-background,#fff);color:var(--model-caption-color,#0f172a);font:600 13px/1.3 var(--model-font,Inter,Arial,sans-serif);pointer-events:none}';
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

      const release = () => {
        controller?.abort();
        controller = null;
        viewer?.pause?.();
        viewer?.dismissPoster?.();
        viewer?.removeAttribute('src');
        viewer?.removeAttribute('poster');
        viewer?.remove();
        viewer = null;
        if (sourceUrl) URL.revokeObjectURL(sourceUrl);
        if (posterUrl) URL.revokeObjectURL(posterUrl);
        sourceUrl = null;
        posterUrl = null;
      };

      const update = async (context: RendererContext): Promise<void> => {
        generation += 1;
        const requestedGeneration = generation;
        release();
        if (disposed) return;
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
        const source = resource(context.runtime, 'source');
        const poster = resource(context.runtime, 'poster');
        if (!source) {
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
        controller = new AbortController();
        const signal = AbortSignal.any([controller.signal, context.signal]);
        try {
          await ensureModelViewerRegistered();
          const [sourceResult, posterResult] = await Promise.allSettled([
            objectUrl(source, signal, (mime) => mime === 'model/gltf-binary' || mime === 'application/octet-stream'),
            poster ? objectUrl(poster, signal, (mime) => mime.startsWith('image/')) : Promise.resolve(null)
          ]);
          if (disposed || requestedGeneration !== generation || signal.aborted) {
            if (sourceResult.status === 'fulfilled') URL.revokeObjectURL(sourceResult.value);
            if (posterResult.status === 'fulfilled' && posterResult.value) URL.revokeObjectURL(posterResult.value);
            return;
          }
          if (sourceResult.status === 'rejected') throw sourceResult.reason;
          sourceUrl = sourceResult.value;
          viewer = document.createElement('model-viewer') as ModelViewerElement;
          viewer.className = 'viewer';
          viewer.dataset.agentcanvasInteractive = '';
          viewer.setAttribute('src', sourceUrl);
          viewer.setAttribute(
            'alt',
            typeof context.element.data.alt === 'string' ? context.element.data.alt : '3D model'
          );
          if (context.element.data.cameraControls === true) viewer.setAttribute('camera-controls', '');
          if (context.element.data.autoRotate === true) viewer.setAttribute('auto-rotate', '');
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
          caption.textContent = typeof context.element.data.caption === 'string' ? context.element.data.caption : '';
          caption.hidden = !caption.textContent;
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
