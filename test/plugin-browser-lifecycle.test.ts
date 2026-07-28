import type { BrowserElementRenderer, CanvasElement, PluginDiagnostic, RendererContext } from '@agentcanvas/plugin-sdk';
import { DEFAULT_CANVAS_THEME } from '@agentcanvas/plugin-sdk';
import { describe, expect, it, vi } from 'vitest';
import { isPluginInteractiveEvent } from '../src/web/plugins/interaction.js';
import { type RendererContextInput, ShadowRendererHost } from '../src/web/plugins/renderer-host.js';
import { ManualRendererEnvironment } from './support/manual-renderer-environment.js';

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
    theme: DEFAULT_CANVAS_THEME,
    geometry: { getElementFrame: () => null, resolveAnchor: () => null },
    overlays: { open: () => ({ update() {}, close() {} }) },
    reportDiagnostic: (diagnostic) => diagnostics.push(diagnostic)
  };
}

describe('ShadowRendererHost', () => {
  it('keeps update and lifetime cancellation independent while coalescing updates', async () => {
    const seen: RendererContext[] = [];
    const releases: Array<() => void> = [];
    const dispose = vi.fn();
    const lifetimeAbort = vi.fn();
    const mount = vi.fn((_root: ShadowRoot, initial: RendererContext) => {
      seen.push(initial);
      initial.lifecycle.signal.addEventListener('abort', lifetimeAbort);
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
    const environment = new ManualRendererEnvironment();
    const host = new ShadowRendererHost(frame, { environment });
    await host.mount(renderer, context(element()));
    expect(mount).toHaveBeenCalledTimes(1);
    const lifetimeSignal = seen[0].lifecycle.signal;

    const first = host.update(context({ ...element(), data: { text: 'one' } }));
    const firstSignal = seen.at(-1)?.signal;
    const second = host.update(context({ ...element(), data: { text: 'two' } }));
    environment.setActivity(frame, { reducedMotion: true });
    environment.setActivity(frame, { intersecting: false });
    environment.setActivity(frame, { intersecting: true });
    const third = host.update(context({ ...element(), data: { text: 'three' } }));
    expect(firstSignal?.aborted).toBe(true);
    expect(lifetimeSignal.aborted).toBe(false);
    expect(seen).toHaveLength(2);
    releases.shift()?.();
    await Promise.resolve();
    expect(seen).toHaveLength(3);
    expect(seen[2].element.data).toEqual({ text: 'three' });
    expect(seen[2].lifecycle).toMatchObject({ active: true, reducedMotion: true });
    expect(seen[2].lifecycle.signal).toBe(lifetimeSignal);
    expect(seen[2].frames).toBe(seen[0].frames);
    releases.shift()?.();
    await Promise.all([first, second, third]);

    await host.dispose();
    await host.dispose();
    expect(lifetimeSignal.aborted).toBe(true);
    expect(lifetimeAbort).toHaveBeenCalledTimes(1);
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(host.root.childNodes).toHaveLength(0);
  });

  it('shares one frame loop, gates inactive renderers immediately, and resumes with zero delta', async () => {
    const environment = new ManualRendererEnvironment();
    const firstFrame = document.createElement('div');
    const secondFrame = document.createElement('div');
    const firstFrames: Array<{ timestamp: number; deltaMs: number }> = [];
    const secondFrames: Array<{ timestamp: number; deltaMs: number }> = [];
    const mounts = vi.fn();
    const renderer = (frames: Array<{ timestamp: number; deltaMs: number }>): BrowserElementRenderer => ({
      type: 'acme.cards/hello',
      schemaVersions: [1],
      placement: 'node',
      mount(_root, initial) {
        mounts();
        initial.frames.subscribe((frame) => frames.push(frame));
        return { update() {}, dispose() {} };
      }
    });
    const first = new ShadowRendererHost(firstFrame, { environment });
    const second = new ShadowRendererHost(secondFrame, { environment });
    await first.mount(renderer(firstFrames), context(element()));
    await second.mount(renderer(secondFrames), context({ ...element(), id: 'hello-2' }));

    expect(environment.pendingFrameCount).toBe(1);
    environment.step(10);
    environment.step(26);
    expect(firstFrames).toEqual([
      { timestamp: 10, deltaMs: 0 },
      { timestamp: 26, deltaMs: 16 }
    ]);
    expect(secondFrames).toEqual(firstFrames);

    environment.setActivity(firstFrame, { intersecting: false });
    environment.step(100);
    expect(firstFrames).toHaveLength(2);
    expect(secondFrames.at(-1)).toEqual({ timestamp: 100, deltaMs: 74 });

    environment.setActivity(secondFrame, { documentVisible: false });
    expect(environment.pendingFrameCount).toBe(0);
    environment.step(1_000);
    environment.setActivity(firstFrame, { intersecting: true });
    environment.step(1_016);
    expect(firstFrames.at(-1)).toEqual({ timestamp: 1_016, deltaMs: 0 });

    environment.setActivity(firstFrame, { connected: false });
    environment.step(1_032);
    expect(firstFrames).toHaveLength(3);
    expect(mounts).toHaveBeenCalledTimes(2);
    await first.dispose();
    await second.dispose();
  });

  it('delivers reduced-motion changes through update without remounting', async () => {
    const environment = new ManualRendererEnvironment();
    const frame = document.createElement('div');
    const updates: RendererContext[] = [];
    const mount = vi.fn((_root: ShadowRoot, initial: RendererContext) => ({
      update(next: RendererContext) {
        updates.push(next);
      },
      dispose() {}
    }));
    const host = new ShadowRendererHost(frame, { environment });
    await host.mount({ type: 'acme.cards/hello', schemaVersions: [1], placement: 'node', mount }, context(element()));

    environment.setActivity(frame, { reducedMotion: true });
    await vi.waitFor(() => expect(updates.at(-1)?.lifecycle.reducedMotion).toBe(true));
    expect(mount).toHaveBeenCalledTimes(1);
    await host.dispose();
  });

  it('supports manual unsubscribe and removes every callback on disposal', async () => {
    const environment = new ManualRendererEnvironment();
    const frame = document.createElement('div');
    const subscribed = vi.fn();
    const retained = vi.fn();
    let unsubscribe = () => {};
    const host = new ShadowRendererHost(frame, { environment });
    await host.mount(
      {
        type: 'acme.cards/hello',
        schemaVersions: [1],
        placement: 'node',
        mount(_root, initial) {
          unsubscribe = initial.frames.subscribe(subscribed);
          initial.frames.subscribe(retained);
          return { update() {}, dispose() {} };
        }
      },
      context(element())
    );
    environment.step(1);
    unsubscribe();
    environment.step(2);
    expect(subscribed).toHaveBeenCalledTimes(1);
    expect(retained).toHaveBeenCalledTimes(2);

    await host.dispose();
    environment.step(3);
    expect(retained).toHaveBeenCalledTimes(2);
    expect(environment.pendingFrameCount).toBe(0);
  });

  it('isolates one failing frame callback and applies in-frame subscription changes next frame', async () => {
    const environment = new ManualRendererEnvironment();
    const frame = document.createElement('div');
    const diagnostics: PluginDiagnostic[] = [];
    const calls: string[] = [];
    let removeSecond = () => {};
    let added = false;
    const host = new ShadowRendererHost(frame, { environment, reportDiagnostic: (value) => diagnostics.push(value) });
    await host.mount(
      {
        type: 'acme.cards/hello',
        schemaVersions: [1],
        placement: 'node',
        mount(_root, initial) {
          initial.frames.subscribe(() => {
            calls.push('first');
            if (!added) {
              added = true;
              initial.frames.subscribe(() => calls.push('added'));
              removeSecond();
            }
          });
          removeSecond = initial.frames.subscribe(() => calls.push('second'));
          initial.frames.subscribe(() => {
            calls.push('failing');
            throw new Error('frame failure');
          });
          initial.frames.subscribe(() => calls.push('healthy'));
          return { update() {}, dispose() {} };
        }
      },
      context(element())
    );

    environment.step(10);
    expect(calls).toEqual(['first', 'second', 'failing', 'healthy']);
    expect(diagnostics.map((diagnostic) => diagnostic.code)).toEqual(['browser_renderer_frame_failed']);
    environment.step(20);
    expect(calls).toEqual(['first', 'second', 'failing', 'healthy', 'first', 'healthy', 'added']);
    expect(diagnostics).toHaveLength(1);
    await host.dispose();
  });

  it('tears down lifetime activity and frames before renderer cleanup after update failure', async () => {
    const environment = new ManualRendererEnvironment();
    const frame = document.createElement('div');
    const order: string[] = [];
    const callback = vi.fn();
    const host = new ShadowRendererHost(frame, { environment });
    await host.mount(
      {
        type: 'acme.cards/hello',
        schemaVersions: [1],
        placement: 'node',
        mount(_root, initial) {
          initial.lifecycle.signal.addEventListener('abort', () => order.push('abort'));
          initial.frames.subscribe(callback);
          return {
            update() {
              throw new Error('update failure');
            },
            dispose() {
              order.push('dispose');
            }
          };
        }
      },
      context(element())
    );

    await host.update(context({ ...element(), data: { text: 'fail' } }));
    expect(order).toEqual(['abort', 'dispose']);
    expect(() => environment.setActivity(frame, { intersecting: false })).toThrow('Element activity is not registered');
    environment.step(10);
    expect(callback).not.toHaveBeenCalled();
    expect(host.root.textContent).toContain('Renderer error');
    await host.dispose();
  });

  it('contains mount failures in a diagnostic card', async () => {
    const diagnostics: PluginDiagnostic[] = [];
    const environment = new ManualRendererEnvironment();
    const renderer: BrowserElementRenderer = {
      type: 'acme.cards/hello',
      schemaVersions: [1],
      placement: 'node',
      mount: () => {
        throw new Error('boom <script>');
      }
    };
    const host = new ShadowRendererHost(document.createElement('div'), { environment });
    await host.mount(renderer, context(element(), diagnostics));
    expect(diagnostics[0].code).toBe('browser_renderer_failed');
    expect(host.root.textContent).toContain('The browser renderer for acme.cards/hello failed.');
    expect(host.root.querySelector('script')).toBeNull();
  });

  it('renders a missing-plugin card for unavailable or incompatible renderers', async () => {
    const diagnostics: PluginDiagnostic[] = [];
    const host = new ShadowRendererHost(document.createElement('div'), {
      environment: new ManualRendererEnvironment()
    });
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
    const first = new ShadowRendererHost(frame, { environment: new ManualRendererEnvironment() });
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
    const replacement = new ShadowRendererHost(frame, { environment: new ManualRendererEnvironment() });
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

  it('ignores focusable editor chrome above the renderer host', () => {
    const flowNode = document.createElement('div');
    flowNode.tabIndex = 0;
    const frame = document.createElement('div');
    const root = frame.attachShadow({ mode: 'open' });
    const plain = document.createElement('div');
    root.append(plain);
    flowNode.append(frame);
    document.body.append(flowNode);

    frame.addEventListener('wheel', (received) => {
      expect(isPluginInteractiveEvent(received)).toBe(true);
      expect(isPluginInteractiveEvent(received, frame)).toBe(false);
    });
    plain.dispatchEvent(new WheelEvent('wheel', { bubbles: true, composed: true }));
  });
});
