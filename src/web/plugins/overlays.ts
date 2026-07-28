import type { RendererOverlayHandle, RendererOverlayService } from '@agentcanvas/plugin-sdk';

export class DomRendererOverlayService implements RendererOverlayService {
  constructor(private readonly host: HTMLElement = document.body) {}

  open(content: Node, options: { modal?: boolean; label?: string } = {}): RendererOverlayHandle {
    const layer = document.createElement('div');
    layer.dataset.agentcanvasPluginOverlay = '';
    layer.dataset.agentcanvasInteractive = '';
    layer.setAttribute('role', options.modal ? 'dialog' : 'region');
    if (options.modal) {
      layer.setAttribute('aria-modal', 'true');
      layer.style.cssText =
        'position:fixed;inset:0;z-index:2147483000;display:grid;box-sizing:border-box;place-items:center;overflow:auto;padding:16px;background:rgba(15,23,42,.48)';
    } else {
      layer.style.cssText = 'position:fixed;top:72px;right:16px;z-index:2147483000';
    }
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
