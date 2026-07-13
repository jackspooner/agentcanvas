import type { RendererOverlayHandle, RendererOverlayService } from '@agentcanvas/plugin-sdk';

export class DomRendererOverlayService implements RendererOverlayService {
  constructor(private readonly host: HTMLElement = document.body) {}

  open(content: Node, options: { modal?: boolean; label?: string } = {}): RendererOverlayHandle {
    const layer = document.createElement('div');
    layer.dataset.agentcanvasPluginOverlay = '';
    layer.setAttribute('role', options.modal ? 'dialog' : 'region');
    if (options.modal) layer.setAttribute('aria-modal', 'true');
    if (options.label) layer.setAttribute('aria-label', options.label);
    layer.append(content);
    this.host.append(layer);
    let closed = false;
    return {
      update(next) {
        if (!closed) layer.replaceChildren(next);
      },
      close() {
        if (closed) return;
        closed = true;
        layer.remove();
      }
    };
  }
}
