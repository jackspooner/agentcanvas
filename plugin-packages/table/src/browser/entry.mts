import type { AgentCanvasBrowserPlugin, BrowserPluginHost, RendererContext } from '@agentcanvas/plugin-sdk';
import { tableData } from './data.js';

const styles = `:host{display:block;width:100%;height:100%;box-sizing:border-box}.frame{box-sizing:border-box;width:100%;height:100%;overflow:auto;border:var(--ac-border-width,1px) solid var(--ac-border,#cbd5e1);border-radius:var(--ac-radius,8px);background:var(--ac-background,#fff);color:var(--ac-color,#0f172a);font:var(--ac-font-size,13px)/1.35 var(--ac-font-family,Inter,Arial,sans-serif)}table{width:100%;border-collapse:collapse}caption{caption-side:top;padding:9px 12px;text-align:left;font-weight:700;color:var(--ac-caption,#334155);background:var(--ac-background,#fff);border-bottom:var(--ac-border-width,1px) solid var(--ac-border,#cbd5e1)}th,td{padding:7px 9px;border-right:var(--ac-border-width,1px) solid var(--ac-border,#cbd5e1);border-bottom:var(--ac-border-width,1px) solid var(--ac-border,#cbd5e1);text-align:left;vertical-align:top;overflow-wrap:anywhere}th:last-child,td:last-child{border-right:0}th{position:sticky;top:0;background:var(--ac-header-background,#f8fafc);color:var(--ac-header-color,#0f172a);font-weight:700}`;

function value(context: RendererContext, key: string, fallback: string): string {
  const setting = context.element.style?.[key];
  return typeof setting === 'string' || typeof setting === 'number' ? String(setting) : fallback;
}

const plugin: AgentCanvasBrowserPlugin = {
  activate(host: BrowserPluginHost) {
    host.registerRenderer({
      type: 'agentcanvas.table/table',
      schemaVersions: [1],
      placement: 'node',
      mount(root, initial) {
        const style = document.createElement('style');
        style.textContent = styles;
        const frame = document.createElement('div');
        frame.className = 'frame';
        root.replaceChildren(style, frame);
        const update = (context: RendererContext) => {
          for (const [property, key, fallback] of [
            ['--ac-border', 'borderColor', '#cbd5e1'],
            ['--ac-border-width', 'borderWidth', '1'],
            ['--ac-radius', 'borderRadius', '8'],
            ['--ac-background', 'background', '#ffffff'],
            ['--ac-color', 'color', '#0f172a'],
            ['--ac-font-size', 'fontSize', '13'],
            ['--ac-font-family', 'fontFamily', 'Inter, Arial, sans-serif'],
            ['--ac-header-background', 'headerBackground', '#f8fafc'],
            ['--ac-header-color', 'headerColor', '#0f172a'],
            ['--ac-caption', 'captionColor', '#334155']
          ] as const)
            frame.style.setProperty(
              property,
              value(context, key, fallback) +
                (key === 'borderWidth' || key === 'borderRadius' || key === 'fontSize' ? 'px' : '')
            );
          const data = tableData(context.element);
          const table = document.createElement('table');
          if (data.caption) {
            const caption = document.createElement('caption');
            caption.textContent = data.caption;
            table.append(caption);
          }
          const head = document.createElement('thead');
          const headerRow = document.createElement('tr');
          for (const column of data.columns) {
            const cell = document.createElement('th');
            cell.scope = 'col';
            cell.textContent = column;
            headerRow.append(cell);
          }
          head.append(headerRow);
          table.append(head);
          const body = document.createElement('tbody');
          data.rows.forEach((row) => {
            const rowElement = document.createElement('tr');
            data.columns.forEach((_column, index) => {
              const cell = document.createElement('td');
              cell.textContent = row[index] ?? '';
              rowElement.append(cell);
            });
            body.append(rowElement);
          });
          table.append(body);
          frame.replaceChildren(table);
        };
        update(initial);
        return { update, dispose: () => root.replaceChildren() };
      }
    });
  }
};

export default plugin;
