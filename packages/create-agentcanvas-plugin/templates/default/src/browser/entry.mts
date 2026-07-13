import type {
  AgentCanvasBrowserPlugin,
  BrowserElementRenderer,
  CanvasElement,
  RendererContext
} from '@agentcanvas/plugin-sdk';

function render(container: HTMLElement, element: Readonly<CanvasElement>, readOnly: boolean): void {
  const data = element.data;
  const style = element.style ?? {};
  const title = typeof data.title === 'string' ? data.title : 'Invalid card';
  const message = typeof data.message === 'string' ? data.message : '';
  container.replaceChildren();
  const heading = document.createElement('strong');
  heading.textContent = title;
  const body = document.createElement('p');
  body.textContent = message;
  container.append(heading, body);
  container.dataset.readOnly = String(readOnly);
  container.style.setProperty('--card-accent', typeof style.accentColor === 'string' ? style.accentColor : '#2563eb');
}

export const renderer: BrowserElementRenderer = {
  type: '__PLUGIN_ID__/hello-card',
  schemaVersions: [1],
  placement: 'node',
  mount(root, context: RendererContext) {
    const style = document.createElement('style');
    style.textContent = `
      :host { display: block; width: 100%; height: 100%; }
      article { box-sizing: border-box; height: 100%; padding: 18px; border: 4px solid var(--card-accent); border-radius: 12px; background: white; color: #111827; overflow: hidden; }
      strong { display: block; font: 700 24px/1.2 system-ui, sans-serif; }
      p { margin: 12px 0 0; white-space: pre-wrap; font: 16px/1.45 system-ui, sans-serif; }
    `;
    const container = document.createElement('article');
    root.append(style, container);
    render(container, context.element, context.readOnly);
    return {
      update(next) {
        render(container, next.element, next.readOnly);
      },
      dispose() {
        root.replaceChildren();
      }
    };
  }
};

const plugin: AgentCanvasBrowserPlugin = {
  activate(host) {
    host.registerRenderer(renderer);
  }
};

export default plugin;
