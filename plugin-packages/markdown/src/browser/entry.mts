import type { AgentCanvasBrowserPlugin, BrowserPluginHost, RendererContext } from '@agentcanvas/plugin-sdk';
import { renderSafeMarkdown } from './markdown.js';

const styles = `:host{display:block;width:100%;height:100%;box-sizing:border-box}.document{box-sizing:border-box;width:100%;height:100%;overflow:auto;padding:var(--ac-padding,14px);color:var(--ac-color,#0f172a);background:var(--ac-background,#fff);border:var(--ac-border-shorthand,var(--ac-border-width,1px) solid var(--ac-border,#d0d7de));border-radius:var(--ac-radius,10px);font:var(--ac-font-size,14px)/1.5 var(--ac-font-family,Inter,Arial,sans-serif);font-weight:var(--ac-font-weight,400)}h1,h2,h3,h4,h5,h6{line-height:1.2;margin:.7em 0 .35em}h1:first-child,h2:first-child,h3:first-child{margin-top:0}p{margin:.55em 0}ul,ol{padding-left:1.5rem}pre{overflow:auto;padding:.7rem;border-radius:6px;background:#0f172a;color:#e2e8f0}code{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;background:#f1f5f9;padding:.1em .25em;border-radius:3px}pre code{background:transparent;padding:0}table{width:100%;border-collapse:collapse}th,td{padding:.35rem .5rem;border:1px solid #cbd5e1;text-align:left}th{background:#f8fafc}a{color:#2563eb;text-decoration:underline}`;

function value(context: RendererContext, key: string, fallback: string): string {
  const setting = context.element.style?.[key];
  return typeof setting === 'string' || typeof setting === 'number' ? String(setting) : fallback;
}

const plugin: AgentCanvasBrowserPlugin = {
  activate(host: BrowserPluginHost) {
    host.registerRenderer({
      type: 'agentcanvas.markdown/document',
      schemaVersions: [1],
      placement: 'node',
      mount(root, initial) {
        const style = document.createElement('style');
        style.textContent = styles;
        const documentElement = document.createElement('article');
        documentElement.className = 'document';
        root.replaceChildren(style, documentElement);
        const update = (context: RendererContext) => {
          documentElement.style.setProperty('--ac-color', value(context, 'color', '#0f172a'));
          documentElement.style.setProperty('--ac-background', value(context, 'background', '#ffffff'));
          documentElement.style.setProperty('--ac-border', value(context, 'borderColor', '#d0d7de'));
          documentElement.style.setProperty('--ac-border-width', `${value(context, 'borderWidth', '1')}px`);
          const border = context.element.style?.border;
          if (typeof border === 'string') documentElement.style.setProperty('--ac-border-shorthand', border);
          else documentElement.style.removeProperty('--ac-border-shorthand');
          documentElement.style.setProperty('--ac-radius', `${value(context, 'borderRadius', '10')}px`);
          documentElement.style.setProperty('--ac-padding', `${value(context, 'padding', '14')}px`);
          documentElement.style.setProperty('--ac-font-size', `${value(context, 'fontSize', '14')}px`);
          documentElement.style.setProperty('--ac-font-weight', value(context, 'fontWeight', '400'));
          documentElement.style.setProperty(
            '--ac-font-family',
            value(context, 'fontFamily', 'Inter, Arial, sans-serif')
          );
          documentElement.innerHTML = renderSafeMarkdown(
            typeof context.element.data.markdown === 'string' ? context.element.data.markdown : ''
          );
        };
        update(initial);
        return { update, dispose: () => root.replaceChildren() };
      }
    });
  }
};

export default plugin;
