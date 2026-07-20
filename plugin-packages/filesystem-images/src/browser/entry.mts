import type { AgentCanvasBrowserPlugin, BrowserPluginHost, JsonObject, RendererContext } from '@agentcanvas/plugin-sdk';
import { fileSystemImageData, fitToObjectFit } from '../contracts.js';

const styles = `
  :host{display:block;width:100%;height:100%;box-sizing:border-box;color:var(--image-color,#0f172a);font:13px/1.35 var(--image-font,system-ui,sans-serif)}
  .frame{position:relative;box-sizing:border-box;width:100%;height:100%;margin:0;overflow:hidden;border:var(--image-border-width,1px) solid var(--image-border,#cbd5e1);border-radius:var(--image-radius,8px);background:var(--image-background,#f8fafc)}
  img{display:block;width:100%;height:100%;object-position:center;background:var(--image-background,#f8fafc)}
  .placeholder{display:grid;width:100%;height:100%;place-content:center;gap:4px;text-align:center;color:var(--image-muted,#64748b);background:var(--image-background,#f8fafc)}.placeholder strong{color:var(--image-color,#475569)}.placeholder span{max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  figcaption{position:absolute;right:0;bottom:0;left:0;box-sizing:border-box;padding:7px 10px;background:var(--image-surface,#fff);color:var(--image-color,#334155);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
`;

function resourceUrl(runtime: Readonly<JsonObject>): string | null {
  if (typeof runtime.contentUrl !== 'string') return null;
  const url = new URL(runtime.contentUrl, window.location.href);
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

const plugin: AgentCanvasBrowserPlugin = {
  activate(host: BrowserPluginHost) {
    host.registerRenderer({
      type: 'agentcanvas.filesystem-images/image',
      schemaVersions: [1],
      placement: 'node',
      mount(root, initial) {
        const style = document.createElement('style');
        style.textContent = styles;
        const frame = document.createElement('figure');
        frame.className = 'frame';
        const image = document.createElement('img');
        const placeholder = document.createElement('div');
        placeholder.className = 'placeholder';
        const unavailable = document.createElement('strong');
        unavailable.textContent = 'image unavailable';
        const identity = document.createElement('span');
        placeholder.append(unavailable, identity);
        const caption = document.createElement('figcaption');
        root.replaceChildren(style, frame);
        let current = initial;
        let currentHandle: string | null = null;
        let objectUrl: string | null = null;
        let requestVersion = 0;
        let disposed = false;

        const revoke = () => {
          if (!objectUrl) return;
          URL.revokeObjectURL(objectUrl);
          objectUrl = null;
          image.removeAttribute('src');
        };

        const showPlaceholder = () => {
          const data = fileSystemImageData(current.element.data);
          identity.textContent = data.source.path.split('/').at(-1) ?? current.element.id;
          frame.replaceChildren(placeholder, ...(data.caption ? [caption] : []));
        };

        const load = async (context: RendererContext) => {
          const handle = typeof context.runtime?.contentHandle === 'string' ? context.runtime.contentHandle : null;
          const url = context.runtime ? resourceUrl(context.runtime) : null;
          if (!handle || !url) {
            currentHandle = null;
            revoke();
            showPlaceholder();
            return;
          }
          if (handle === currentHandle && objectUrl) return;
          currentHandle = handle;
          const version = ++requestVersion;
          revoke();
          showPlaceholder();
          try {
            const response = await fetch(url, {
              headers: { accept: 'image/avif,image/webp,image/png,image/jpeg,image/gif' },
              credentials: 'same-origin',
              signal: context.signal
            });
            if (!response.ok) throw new Error(`Filesystem image request failed with HTTP ${response.status}`);
            const blob = await response.blob();
            if (disposed || context.signal.aborted || version !== requestVersion) return;
            objectUrl = URL.createObjectURL(blob);
            image.src = objectUrl;
            frame.replaceChildren(image, ...(fileSystemImageData(context.element.data).caption ? [caption] : []));
          } catch {
            if (context.signal.aborted || disposed || version !== requestVersion) return;
            context.reportDiagnostic({
              code: 'filesystem_image_content_failed',
              severity: 'error',
              message: 'The filesystem image content could not be loaded.',
              retryable: true,
              pluginId: 'agentcanvas.filesystem-images',
              elementId: context.element.id
            });
            showPlaceholder();
          }
        };

        const update = async (context: RendererContext) => {
          current = context;
          const data = fileSystemImageData(context.element.data);
          image.alt = data.alt ?? data.caption ?? data.source.path;
          image.style.objectFit = fitToObjectFit(data.fit);
          caption.textContent = data.caption ?? '';
          const styleData = context.element.style ?? {};
          const { colors, typography, shape } = context.theme;
          frame.style.setProperty(
            '--image-background',
            typeof styleData.background === 'string' ? styleData.background : colors.surfaceMuted
          );
          frame.style.setProperty(
            '--image-border',
            typeof styleData.borderColor === 'string' ? styleData.borderColor : colors.border
          );
          frame.style.setProperty(
            '--image-border-width',
            `${typeof styleData.borderWidth === 'number' ? styleData.borderWidth : shape.borderWidth}px`
          );
          frame.style.setProperty(
            '--image-radius',
            `${typeof styleData.borderRadius === 'number' ? styleData.borderRadius : shape.radius}px`
          );
          frame.style.setProperty('--image-surface', colors.surface);
          frame.style.setProperty('--image-color', colors.text);
          frame.style.setProperty('--image-muted', colors.textMuted);
          frame.style.setProperty('--image-font', typography.bodyFont);
          await load(context);
        };

        void update(initial);
        return {
          update,
          dispose() {
            disposed = true;
            requestVersion += 1;
            revoke();
            root.replaceChildren();
          }
        };
      }
    });
  }
};

export default plugin;
