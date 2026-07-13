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

function resource(runtime: Readonly<JsonObject> | null, key: string): BrowserResource | null {
  const value = runtime?.[key];
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return typeof value.url === 'string' && typeof value.mimeType === 'string'
    ? { url: value.url, mimeType: value.mimeType }
    : null;
}

async function objectUrl(source: BrowserResource, signal: AbortSignal, mimePrefix: string): Promise<string> {
  const resolved = new URL(source.url, window.location.href);
  if (resolved.origin !== window.location.origin) throw new Error('resource URL must be same-origin');
  const response = await fetch(resolved, { signal, credentials: 'same-origin' });
  if (!response.ok) throw new Error(`resource request failed with HTTP ${response.status}`);
  const mimeType = (response.headers.get('content-type') ?? source.mimeType).split(';')[0].trim().toLowerCase();
  if (!mimeType.startsWith(mimePrefix)) throw new Error(`resource MIME type ${mimeType || 'unknown'} is invalid`);
  return URL.createObjectURL(await response.blob());
}

export function createVideoRenderer(): BrowserElementRenderer {
  return {
    type: 'agentcanvas.video/video',
    schemaVersions: [1],
    placement: 'node',
    mount(root, initial) {
      const style = document.createElement('style');
      style.textContent =
        ':host{display:block;width:100%;height:100%}.frame{position:relative;width:100%;height:100%;overflow:hidden;border:1px solid #334155;border-radius:8px;background:#0f172a}.media{display:block;width:100%;height:100%;object-fit:contain;background:#000}.caption{position:absolute;left:0;right:0;bottom:0;box-sizing:border-box;padding:8px 10px;background:#0f172acc;color:#fff;font:600 13px/1.3 Inter,Arial,sans-serif;pointer-events:none}.missing{display:grid;place-items:center;width:100%;height:100%;color:#cbd5e1;font:600 13px Inter,Arial,sans-serif}';
      const frame = document.createElement('div');
      frame.className = 'frame';
      const video = document.createElement('video');
      video.className = 'media';
      video.dataset.agentcanvasInteractive = '';
      const caption = document.createElement('div');
      caption.className = 'caption';
      frame.append(video, caption);
      root.replaceChildren(style, frame);

      let disposed = false;
      let generation = 0;
      let controller: AbortController | null = null;
      let sourceUrl: string | null = null;
      let posterUrl: string | null = null;

      const release = () => {
        controller?.abort();
        controller = null;
        video.pause();
        video.removeAttribute('src');
        video.removeAttribute('poster');
        video.load();
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
        caption.textContent = typeof context.element.data.caption === 'string' ? context.element.data.caption : '';
        caption.hidden = !caption.textContent;
        video.controls = context.element.data.controls === true;
        video.autoplay = context.element.data.autoplay === true;
        video.loop = context.element.data.loop === true;
        video.muted = context.element.data.muted === true;
        const source = resource(context.runtime, 'source');
        const poster = resource(context.runtime, 'poster');
        if (!source) {
          context.reportDiagnostic({
            code: 'video_resource_missing',
            severity: 'error',
            message: 'The video resource is unavailable.',
            retryable: true,
            pluginId: 'agentcanvas.video',
            elementId: context.element.id
          });
          return;
        }
        controller = new AbortController();
        const signal = AbortSignal.any([controller.signal, context.signal]);
        const [sourceResult, posterResult] = await Promise.allSettled([
          objectUrl(source, signal, 'video/'),
          poster ? objectUrl(poster, signal, 'image/') : Promise.resolve(null)
        ]);
        if (disposed || requestedGeneration !== generation || signal.aborted) {
          if (sourceResult.status === 'fulfilled') URL.revokeObjectURL(sourceResult.value);
          if (posterResult.status === 'fulfilled' && posterResult.value) URL.revokeObjectURL(posterResult.value);
          return;
        }
        if (sourceResult.status === 'rejected') {
          context.reportDiagnostic({
            code: 'video_resource_failed',
            severity: 'error',
            message: 'The video resource could not be loaded.',
            retryable: true,
            pluginId: 'agentcanvas.video',
            elementId: context.element.id
          });
          return;
        }
        sourceUrl = sourceResult.value;
        video.src = sourceUrl;
        if (posterResult.status === 'fulfilled' && posterResult.value) {
          posterUrl = posterResult.value;
          video.poster = posterUrl;
        } else if (posterResult.status === 'rejected') {
          context.reportDiagnostic({
            code: 'video_poster_failed',
            severity: 'warning',
            message: 'The video poster could not be loaded.',
            retryable: true,
            pluginId: 'agentcanvas.video',
            elementId: context.element.id
          });
        }
        video.load();
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
    host.registerRenderer(createVideoRenderer());
  }
};

export default plugin;
