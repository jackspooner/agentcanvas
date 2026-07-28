import { afterEach, describe, expect, it } from 'vitest';
import { DomRendererOverlayService } from '../src/web/plugins/overlays';

afterEach(() => {
  document.body.replaceChildren();
});

describe('plugin renderer overlays', () => {
  it('places modal content in a visible fixed backdrop and supports update and close', () => {
    const service = new DomRendererOverlayService();
    const loading = document.createElement('div');
    loading.textContent = 'Loading';
    const overlay = service.open(loading, { modal: true, label: 'Asset details' });
    const layer = document.querySelector<HTMLElement>('[data-agentcanvas-plugin-overlay]');

    expect(layer?.getAttribute('role')).toBe('dialog');
    expect(layer?.getAttribute('aria-modal')).toBe('true');
    expect(layer?.getAttribute('aria-label')).toBe('Asset details');
    expect(layer?.dataset.agentcanvasInteractive).toBe('');
    expect(layer?.style.position).toBe('fixed');
    expect(layer?.style.inset).toBe('0px');
    expect(layer?.textContent).toBe('Loading');

    const details = document.createElement('section');
    details.textContent = 'Loaded details';
    overlay.update(details);
    expect(layer?.textContent).toBe('Loaded details');

    overlay.close();
    expect(document.querySelector('[data-agentcanvas-plugin-overlay]')).toBeNull();
  });
});
