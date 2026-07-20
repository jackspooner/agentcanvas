import type {
  AgentCanvasBrowserPlugin,
  BrowserPluginHost,
  JsonObject,
  RendererContext,
  RendererOverlayHandle
} from '@agentcanvas/plugin-sdk';
import { assetElementData, fitToObjectFit, type AssetReference } from '../contracts.js';

const styles = `
  :host{display:block;width:100%;height:100%;box-sizing:border-box;color:var(--asset-color,#0f172a);font:13px/1.35 var(--asset-font,system-ui,sans-serif)}
  .frame{position:relative;box-sizing:border-box;width:100%;height:100%;margin:0;overflow:hidden;border:var(--asset-border-width,1px) solid var(--asset-border,#cbd5e1);border-radius:var(--asset-radius,8px);background:var(--asset-background,#f8fafc)}
  img{display:block;width:100%;height:100%;object-position:center;background:var(--asset-background,#f8fafc)}
  .placeholder{display:grid;width:100%;height:100%;place-content:center;gap:4px;text-align:center;color:var(--asset-muted,#64748b);background:var(--asset-background,#f8fafc)}.placeholder strong{color:var(--asset-color,#475569)}.placeholder span{max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  figcaption{position:absolute;right:0;bottom:0;left:0;box-sizing:border-box;padding:7px 10px;background:var(--asset-surface,#fff);color:var(--asset-color,#334155);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  button{position:absolute;top:8px;right:8px;border:1px solid var(--asset-border,#cbd5e1);border-radius:6px;background:var(--asset-surface,#fff);padding:5px 8px;color:var(--asset-color,#334155);font:600 11px var(--asset-font,system-ui,sans-serif);cursor:pointer}
  button:focus-visible{outline:2px solid var(--asset-accent,#2563eb);outline-offset:2px}
`;

function text(value: unknown, fallback = 'not recorded'): string {
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  return fallback;
}

function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function detailRow(list: HTMLDListElement, label: string, value: unknown): void {
  const term = document.createElement('dt');
  term.textContent = label;
  const description = document.createElement('dd');
  description.textContent = text(value);
  list.append(term, description);
}

function detailsPanel(details: JsonObject, close: () => void): HTMLElement {
  const panel = document.createElement('section');
  panel.dataset.agentcanvasInteractive = '';
  panel.style.cssText =
    'box-sizing:border-box;width:min(620px,calc(100vw - 32px));max-height:calc(100vh - 32px);overflow:auto;border:1px solid #cbd5e1;border-radius:12px;background:#fff;padding:18px;color:#0f172a;font:13px/1.4 system-ui,sans-serif;box-shadow:0 20px 50px rgba(15,23,42,.25)';
  const heading = document.createElement('h2');
  heading.textContent = 'Asset details';
  heading.style.margin = '0 44px 14px 0';
  const closeButton = document.createElement('button');
  closeButton.type = 'button';
  closeButton.textContent = 'Close';
  closeButton.dataset.agentcanvasInteractive = '';
  closeButton.style.cssText = 'float:right;border:1px solid #cbd5e1;border-radius:6px;background:#fff;padding:5px 8px';
  closeButton.addEventListener('click', close);
  const asset = object(details.asset);
  const generation = object(details.generation);
  const cost = object(details.cost);
  const list = document.createElement('dl');
  list.style.cssText = 'display:grid;grid-template-columns:max-content 1fr;gap:7px 14px;margin:0';
  detailRow(list, 'Project', asset.project);
  detailRow(list, 'Asset ID', asset.assetId);
  detailRow(list, 'Filename', asset.filename);
  detailRow(list, 'Content type', asset.contentType);
  detailRow(list, 'Dimensions', asset.width && asset.height ? `${asset.width} × ${asset.height}` : undefined);
  detailRow(list, 'Provider / model', [generation.provider, generation.model].filter(Boolean).join(' / ') || undefined);
  detailRow(list, 'Quality', generation.quality);
  detailRow(
    list,
    'Cost',
    cost.currency && typeof cost.amount === 'number' ? `${cost.currency} ${cost.amount}` : undefined
  );
  detailRow(list, 'Generated at', generation.generatedAt ?? asset.createdAt);
  const promptHeading = document.createElement('h3');
  promptHeading.textContent = 'Prompt';
  promptHeading.style.margin = '18px 0 6px';
  const prompt = document.createElement('pre');
  prompt.textContent = text(generation.prompt);
  prompt.style.cssText =
    'margin:0;white-space:pre-wrap;overflow-wrap:anywhere;background:#f8fafc;padding:10px;border-radius:7px';
  panel.append(closeButton, heading, list, promptHeading, prompt);
  return panel;
}

function loadingPanel(message: string): HTMLElement {
  const panel = document.createElement('section');
  panel.dataset.agentcanvasInteractive = '';
  panel.style.cssText =
    'border:1px solid #cbd5e1;border-radius:10px;background:#fff;padding:18px;color:#334155;font:13px system-ui,sans-serif';
  panel.textContent = message;
  return panel;
}

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

async function fetchDetails(reference: AssetReference, signal: AbortSignal): Promise<JsonObject> {
  const response = await fetch('/api/v1/plugins/agentcanvas.assets2/procedures/details', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({ assetRef: reference }),
    signal
  });
  if (!response.ok) throw new Error(`Asset details request failed with HTTP ${response.status}`);
  const body = (await response.json()) as { details?: JsonObject };
  const details = body.details;
  if (!details) throw new Error('Asset details response was invalid');
  return details;
}

const plugin: AgentCanvasBrowserPlugin = {
  activate(host: BrowserPluginHost) {
    host.registerRenderer({
      type: 'agentcanvas.assets2/asset',
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
        unavailable.textContent = 'asset unavailable';
        const identity = document.createElement('span');
        placeholder.append(unavailable, identity);
        const caption = document.createElement('figcaption');
        const detailsButton = document.createElement('button');
        detailsButton.type = 'button';
        detailsButton.textContent = 'Details';
        detailsButton.dataset.agentcanvasInteractive = '';
        root.replaceChildren(style, frame);
        let current = initial;
        let currentHandle: string | null = null;
        let objectUrl: string | null = null;
        let requestVersion = 0;
        let disposed = false;
        let overlay: RendererOverlayHandle | null = null;
        let detailsController: AbortController | null = null;
        let currentReferenceKey: string | null = null;

        const revoke = () => {
          if (!objectUrl) return;
          URL.revokeObjectURL(objectUrl);
          objectUrl = null;
          image.removeAttribute('src');
        };

        const showPlaceholder = () => {
          const data = assetElementData(current.element.data);
          identity.textContent = data.assetRef.assetId ?? data.assetRef.assetKey ?? current.element.id;
          frame.replaceChildren(placeholder, detailsButton, ...(data.caption ? [caption] : []));
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
            if (!response.ok) throw new Error(`Asset content request failed with HTTP ${response.status}`);
            const blob = await response.blob();
            if (disposed || context.signal.aborted || version !== requestVersion) return;
            objectUrl = URL.createObjectURL(blob);
            image.src = objectUrl;
            frame.replaceChildren(
              image,
              detailsButton,
              ...(assetElementData(context.element.data).caption ? [caption] : [])
            );
          } catch {
            if (context.signal.aborted || disposed || version !== requestVersion) return;
            context.reportDiagnostic({
              code: 'asset_content_failed',
              severity: 'error',
              message: 'The Assets-2 image content could not be loaded.',
              retryable: true,
              pluginId: 'agentcanvas.assets2',
              elementId: context.element.id
            });
            showPlaceholder();
          }
        };

        const update = async (context: RendererContext) => {
          const data = assetElementData(context.element.data);
          const referenceKey = `${data.assetRef.project}:${data.assetRef.assetId ?? ''}:${data.assetRef.assetKey ?? ''}`;
          if (currentReferenceKey && currentReferenceKey !== referenceKey) {
            detailsController?.abort();
            detailsController = null;
            overlay?.close();
            overlay = null;
          }
          currentReferenceKey = referenceKey;
          current = context;
          const label = data.alt ?? data.caption ?? `Asset ${data.assetRef.assetId ?? data.assetRef.assetKey}`;
          image.alt = label;
          image.style.objectFit = fitToObjectFit(data.fit);
          image.style.objectPosition = 'center';
          caption.textContent = data.caption ?? '';
          detailsButton.setAttribute('aria-label', `Open asset details for ${label}`);
          const styleData = context.element.style ?? {};
          const { colors, typography, shape } = context.theme;
          frame.style.setProperty(
            '--asset-background',
            typeof styleData.background === 'string' ? styleData.background : colors.surfaceMuted
          );
          frame.style.setProperty(
            '--asset-border',
            typeof styleData.borderColor === 'string' ? styleData.borderColor : colors.border
          );
          frame.style.setProperty(
            '--asset-border-width',
            `${typeof styleData.borderWidth === 'number' ? styleData.borderWidth : shape.borderWidth}px`
          );
          frame.style.setProperty(
            '--asset-radius',
            `${typeof styleData.borderRadius === 'number' ? styleData.borderRadius : shape.radius}px`
          );
          frame.style.setProperty('--asset-surface', colors.surface);
          frame.style.setProperty('--asset-color', typeof styleData.color === 'string' ? styleData.color : colors.text);
          frame.style.setProperty('--asset-muted', colors.textMuted);
          frame.style.setProperty('--asset-accent', colors.accent);
          frame.style.setProperty(
            '--asset-font',
            typeof styleData.fontFamily === 'string' ? styleData.fontFamily : typography.bodyFont
          );
          await load(context);
        };

        detailsButton.addEventListener('click', () => {
          overlay?.close();
          detailsController?.abort();
          const controller = new AbortController();
          detailsController = controller;
          const close = () => {
            controller.abort();
            detailsController = null;
            overlay?.close();
            overlay = null;
          };
          overlay = current.overlays.open(loadingPanel('Loading asset details…'), {
            modal: true,
            label: 'Asset details'
          });
          void fetchDetails(assetElementData(current.element.data).assetRef, controller.signal)
            .then((details) => overlay?.update(detailsPanel(details, close)))
            .catch(() => {
              if (!controller.signal.aborted) overlay?.update(loadingPanel('Asset details could not be loaded.'));
            });
        });

        void update(initial);
        return {
          update,
          dispose() {
            disposed = true;
            requestVersion += 1;
            detailsController?.abort();
            detailsController = null;
            overlay?.close();
            overlay = null;
            revoke();
            root.replaceChildren();
          }
        };
      }
    });
  }
};

export default plugin;
