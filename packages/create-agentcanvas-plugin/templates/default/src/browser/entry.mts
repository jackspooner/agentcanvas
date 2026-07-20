import type {
  AgentCanvasBrowserPlugin,
  BrowserCommandDescriptor,
  BrowserElementRenderer,
  RendererContext
} from '@agentcanvas/extension-sdk';

function render(container: HTMLElement, context: RendererContext): void {
  const { element, readOnly, theme } = context;
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
  container.style.setProperty(
    '--card-background',
    typeof style.backgroundColor === 'string' ? style.backgroundColor : theme.colors.surface
  );
  container.style.setProperty('--card-text', typeof style.textColor === 'string' ? style.textColor : theme.colors.text);
  container.style.setProperty('--card-radius', `${theme.shape.radius}px`);
  container.style.setProperty('--card-heading-font', theme.typography.headingFont);
  container.style.setProperty('--card-body-font', theme.typography.bodyFont);
}

export const renderer: BrowserElementRenderer = {
  type: '__PLUGIN_ID__/hello-card',
  schemaVersions: [1],
  placement: 'node',
  mount(root, context: RendererContext) {
    const style = document.createElement('style');
    style.textContent = `
      :host { display: block; width: 100%; height: 100%; }
      article { box-sizing: border-box; height: 100%; padding: 18px; border: 4px solid var(--card-accent); border-radius: var(--card-radius); background: var(--card-background); color: var(--card-text); overflow: hidden; }
      strong { display: block; font: 700 24px/1.2 var(--card-heading-font); }
      p { margin: 12px 0 0; white-space: pre-wrap; font: 16px/1.45 var(--card-body-font); }
    `;
    const container = document.createElement('article');
    root.append(style, container);
    render(container, context);
    return {
      update(next) {
        render(container, next);
      },
      dispose() {
        root.replaceChildren();
      }
    };
  }
};

export const showSelectionCountCommand: BrowserCommandDescriptor = {
  name: 'show-selection-count',
  title: 'Show selection count',
  category: '__DISPLAY_NAME__',
  execute(context) {
    context.reportDiagnostic({
      code: 'selection_count',
      severity: 'info',
      message: `${context.selection.length} element${context.selection.length === 1 ? '' : 's'} selected.`,
      retryable: false
    });
  }
};

const plugin: AgentCanvasBrowserPlugin = {
  activate(host) {
    host.registerRenderer(renderer);
    if (!host.registerCommand) throw new Error('This extension requires AgentCanvas browser command support.');
    host.registerCommand(showSelectionCountCommand);
  }
};

export default plugin;
