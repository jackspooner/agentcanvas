import type { PluginDiagnostic } from '@agentcanvas/plugin-sdk';

export type BrowserRendererStatus = 'missing' | 'failed';

export function browserRendererDiagnostic(
  status: BrowserRendererStatus,
  type: string,
  elementId: string
): PluginDiagnostic {
  const pluginId = type.includes('/') ? type.slice(0, type.lastIndexOf('/')) : undefined;
  return {
    code: status === 'missing' ? 'browser_renderer_missing' : 'browser_renderer_failed',
    severity: 'error',
    message:
      status === 'missing'
        ? `No active browser renderer is available for ${type}.`
        : `The browser renderer for ${type} failed.`,
    retryable: status === 'failed',
    ...(pluginId ? { pluginId } : {}),
    elementId
  };
}

export function renderBrowserDiagnosticCard(root: ShadowRoot, diagnostic: PluginDiagnostic): void {
  root.replaceChildren();
  const style = document.createElement('style');
  style.textContent = `
    :host { display: block; width: 100%; height: 100%; color: var(--agentcanvas-error-text, #7f1d1d); }
    .card { box-sizing: border-box; width: 100%; height: 100%; min-height: 52px; overflow: hidden;
      border: 1px solid var(--agentcanvas-error-border, #fca5a5); border-radius: 8px;
      background: var(--agentcanvas-error-bg, #fef2f2); padding: 10px; font: 12px/1.35 system-ui, sans-serif; }
    strong { display: block; margin-bottom: 3px; font-size: 12px; }
    p { margin: 0; overflow-wrap: anywhere; }
  `;
  const card = document.createElement('div');
  card.className = 'card';
  card.setAttribute('role', 'status');
  const title = document.createElement('strong');
  title.textContent = diagnostic.code === 'browser_renderer_missing' ? 'Plugin unavailable' : 'Renderer error';
  const message = document.createElement('p');
  message.textContent = diagnostic.message;
  card.append(title, message);
  root.append(style, card);
}
