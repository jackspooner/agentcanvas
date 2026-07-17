import type {
  AgentCanvasBrowserPlugin,
  BrowserCommandDescriptor,
  BrowserElementRenderer,
  RendererContext
} from '@agentcanvas/plugin-sdk';

function update(card: HTMLElement, context: RendererContext): void {
  card.textContent = `${String(context.element.data.label)} · ${String(context.element.data.status)}`;
  card.dataset.readOnly = String(context.readOnly);
}
export const renderer: BrowserElementRenderer = {
  type: 'external.signal-card/signal-card', schemaVersions: [1], placement: 'node',
  mount(root, context) {
    const style = document.createElement('style');
    style.textContent = ':host{display:block;height:100%}div{box-sizing:border-box;height:100%;padding:16px;border:3px solid #7c3aed;border-radius:10px;background:#fff;font:700 18px system-ui}';
    const card = document.createElement('div');
    root.append(style, card); update(card, context);
    return { update: (next) => update(card, next), dispose: () => root.replaceChildren() };
  }
};
export const toggleStatusCommand: BrowserCommandDescriptor = {
  name: 'toggle-status',
  title: 'Toggle signal status',
  isEnabled: (context) =>
    !context.readOnly && context.selection.some((element) => element.type === 'external.signal-card/signal-card'),
  async execute(context) {
    const element = context.selection.find((candidate) => candidate.type === 'external.signal-card/signal-card');
    if (!element) return;
    const current = element.data.status === 'active' ? 'paused' : 'active';
    await context.transact('Toggle signal status', [
      { op: 'replaceElementData', elementId: element.id, data: { ...element.data, status: current } }
    ]);
  }
};
const plugin: AgentCanvasBrowserPlugin = {
  activate(host) {
    host.registerRenderer(renderer);
    if (!host.registerCommand) throw new Error('AgentCanvas host does not support declared browser commands');
    host.registerCommand(toggleStatusCommand);
  }
};
export default plugin;
