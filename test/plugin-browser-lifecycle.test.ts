import type { BrowserElementRenderer, CanvasElement, PluginDiagnostic, RendererContext } from '@agentcanvas/plugin-sdk';
import { describe, expect, it, vi } from 'vitest';
import { isPluginInteractiveEvent } from '../src/web/plugins/interaction.js';
import { type RendererContextInput, ShadowRendererHost } from '../src/web/plugins/renderer-host.js';

function element(schemaVersion = 1): CanvasElement {
  return {
    id: 'hello-1',
    type: 'acme.cards/hello',
    schemaVersion,
    x: 10,
    y: 20,
    width: 200,
    height: 100,
    data: { text: 'Hello' }
  };
}

function context(value: CanvasElement, diagnostics: PluginDiagnostic[] = []): RendererContextInput {
  return {
    element: value,
    runtime: null,
    readOnly: false,
    selected: false,
    theme: {},
    geometry: { getElementFrame: () => null, resolveAnchor: () => null },
    overlays: { open: () => ({ update() {}, close() {} }) },
    reportDiagnostic: (diagnostic) => diagnostics.push(diagnostic)
  };
}

describe('ShadowRendererHost', () => {
  it('mounts once, aborts stale work, coalesces updates, and disposes exactly once', async () => {
    const seen: RendererContext[] = [];
    const releases: Array<() => void> = [];
    const dispose = vi.fn();
    const mount = vi.fn((_root: ShadowRoot, initial: RendererContext) => {
      seen.push(initial);
      return {
        update(next: RendererContext) {
          seen.push(next);
          return new Promise<void>((resolve) => releases.push(resolve));
        },
        dispose
      };
    });
    const renderer: BrowserElementRenderer = {
      type: 'acme.cards/hello',
      schemaVersions: [1],
      placement: 'node',
      mount
    };
    const frame = document.createElement('div');
    const host = new ShadowRendererHost(frame);
    await host.mount(renderer, context(element()));
    expect(mount).toHaveBeenCalledTimes(1);

    const first = host.update(context({ ...element(), data: { text: 'one' } }));
    const firstSignal = seen.at(-1)?.signal;
    const second = host.update(context({ ...element(), data: { text: 'two' } }));
    const third = host.update(context({ ...element(), data: { text: 'three' } }));
    expect(firstSignal?.aborted).toBe(true);
    expect(seen).toHaveLength(2);
    releases.shift()?.();
    await Promise.resolve();
    expect(seen).toHaveLength(3);
    expect(seen[2].element.data).toEqual({ text: 'three' });
    releases.shift()?.();
    await Promise.all([first, second, third]);

    await host.dispose();
    await host.dispose();
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(host.root.childNodes).toHaveLength(0);
  });

  it('contains mount failures in a diagnostic card', async () => {
    const diagnostics: PluginDiagnostic[] = [];
    const renderer: BrowserElementRenderer = {
      type: 'acme.cards/hello',
      schemaVersions: [1],
      placement: 'node',
      mount: () => {
        throw new Error('boom <script>');
      }
    };
    const host = new ShadowRendererHost(document.createElement('div'));
    await host.mount(renderer, context(element(), diagnostics));
    expect(diagnostics[0].code).toBe('browser_renderer_failed');
    expect(host.root.textContent).toContain('The browser renderer for acme.cards/hello failed.');
    expect(host.root.querySelector('script')).toBeNull();
  });

  it('renders a missing-plugin card for unavailable or incompatible renderers', async () => {
    const diagnostics: PluginDiagnostic[] = [];
    const host = new ShadowRendererHost(document.createElement('div'));
    await host.mount(undefined, context(element(2), diagnostics));
    expect(diagnostics[0]).toMatchObject({
      code: 'browser_renderer_missing',
      pluginId: 'acme.cards',
      elementId: 'hello-1'
    });
    expect(host.root.textContent).toContain('Plugin unavailable');
  });

  it('does not let a superseded asynchronous dispose clear a replacement renderer', async () => {
    const frame = document.createElement('div');
    let releaseDispose: (() => void) | undefined;
    const first = new ShadowRendererHost(frame);
    await first.mount(
      {
        type: 'acme.cards/hello',
        schemaVersions: [1],
        placement: 'node',
        mount(root) {
          root.replaceChildren(document.createTextNode('first'));
          return {
            update() {},
            dispose: () => new Promise<void>((resolve) => (releaseDispose = resolve))
          };
        }
      },
      context(element())
    );
    const disposing = first.dispose();
    const replacement = new ShadowRendererHost(frame);
    await replacement.mount(
      {
        type: 'acme.cards/hello',
        schemaVersions: [1],
        placement: 'node',
        mount(root) {
          root.replaceChildren(document.createTextNode('replacement'));
          return { update() {}, dispose() {} };
        }
      },
      context(element())
    );
    releaseDispose?.();
    await disposing;
    expect(replacement.root.textContent).toBe('replacement');
  });
});

describe('plugin interaction routing', () => {
  it('uses composedPath so controls inside Shadow DOM block canvas dragging', () => {
    const frame = document.createElement('div');
    const root = frame.attachShadow({ mode: 'open' });
    const button = document.createElement('button');
    root.append(button);
    document.body.append(frame);
    const event = new PointerEvent('pointerdown', { bubbles: true, composed: true });
    button.addEventListener('pointerdown', (received) => expect(isPluginInteractiveEvent(received)).toBe(true));
    button.dispatchEvent(event);

    const plain = document.createElement('div');
    root.append(plain);
    plain.addEventListener('pointerdown', (received) => expect(isPluginInteractiveEvent(received)).toBe(false));
    plain.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, composed: true }));
  });

  it('honors the explicit interactive marker', () => {
    const control = document.createElement('div');
    control.dataset.agentcanvasInteractive = '';
    const event = new Event('pointerdown', { bubbles: true, composed: true });
    control.addEventListener('pointerdown', (received) => expect(isPluginInteractiveEvent(received)).toBe(true));
    control.dispatchEvent(event);
  });
});
