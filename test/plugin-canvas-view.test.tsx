import type { BrowserElementRenderer } from '@agentcanvas/plugin-sdk';
import { act, fireEvent, render, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CanvasView } from '../src/web/components/CanvasView';
import type { LoadedBrowserRegistry } from '../src/web/plugins/catalog';
import type { CanvasDocument } from '../src/web/v2-types';

const renderer: BrowserElementRenderer = {
  type: 'fixture.cards/card',
  schemaVersions: [1],
  placement: 'node',
  details: { open: vi.fn() },
  mount(root, context) {
    const button = document.createElement('button');
    button.dataset.agentcanvasInteractive = '';
    const update = (next: typeof context) => {
      button.textContent = String(next.element.data.title);
    };
    update(context);
    root.replaceChildren(button);
    return { update, dispose: () => root.replaceChildren() };
  }
};

function registry(): LoadedBrowserRegistry {
  return {
    plugins: { plugins: [] },
    renderers: new Map([[renderer.type, renderer]]),
    commands: new Map(),
    diagnostics: [],
    dispose: async () => undefined
  };
}

function canvas(): CanvasDocument {
  return {
    id: 'canvas_plugin',
    title: 'Plugin canvas',
    createdBy: 'agent',
    createdAt: '2026-07-13T00:00:00.000Z',
    updatedAt: '2026-07-13T00:00:00.000Z',
    bounds: { mode: 'unlimited' },
    revision: 1,
    documentVersion: 2,
    elements: [
      {
        id: 'card_1',
        type: 'fixture.cards/card',
        schemaVersion: 1,
        x: 10,
        y: 20,
        width: 160,
        height: 80,
        data: { title: 'Hello Shadow DOM' }
      }
    ]
  };
}

describe('plugin canvas React host', () => {
  const nativeWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
  const nativeHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight');
  beforeEach(() => {
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
      configurable: true,
      get() {
        return (this as HTMLElement).classList.contains('canvas-viewport') ? 1920 : 0;
      }
    });
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
      configurable: true,
      get() {
        return (this as HTMLElement).classList.contains('canvas-viewport') ? 900 : 0;
      }
    });
  });
  afterEach(() => {
    if (nativeWidth) Object.defineProperty(HTMLElement.prototype, 'clientWidth', nativeWidth);
    else Reflect.deleteProperty(HTMLElement.prototype, 'clientWidth');
    if (nativeHeight) Object.defineProperty(HTMLElement.prototype, 'clientHeight', nativeHeight);
    else Reflect.deleteProperty(HTMLElement.prototype, 'clientHeight');
  });

  it('reports measured viewport dimensions on load and resize', async () => {
    const originalWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
    const originalHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight');
    let size = { width: 640, height: 480 };
    const updates: Array<() => void> = [];
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
      configurable: true,
      get() {
        return (this as HTMLElement).classList.contains('canvas-viewport') ? size.width : 1;
      }
    });
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
      configurable: true,
      get() {
        return (this as HTMLElement).classList.contains('canvas-viewport') ? size.height : 1;
      }
    });
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(update: () => void) {
          this.update = update;
        }
        update: () => void;
        observe(node: Element) {
          if (node.classList.contains('canvas-viewport')) updates.push(this.update);
        }
        unobserve() {}
        disconnect() {}
      }
    );
    const onViewportChange = vi.fn();
    let unmount: (() => void) | undefined;
    try {
      const screen = render(
        <CanvasView
          canvas={canvas()}
          elementRuntime={{}}
          diagnostics={[]}
          browserRegistry={registry()}
          onViewportChange={onViewportChange}
        />
      );
      unmount = screen.unmount;
      await waitFor(() =>
        expect(onViewportChange).toHaveBeenCalledWith(expect.objectContaining({ width: 640, height: 480 }))
      );
      size = { width: 900, height: 700 };
      act(() => {
        for (const update of updates) update();
      });
      await waitFor(() =>
        expect(onViewportChange).toHaveBeenCalledWith(expect.objectContaining({ width: 900, height: 700 }))
      );
    } finally {
      unmount?.();
      if (originalWidth) Object.defineProperty(HTMLElement.prototype, 'clientWidth', originalWidth);
      else Reflect.deleteProperty(HTMLElement.prototype, 'clientWidth');
      if (originalHeight) Object.defineProperty(HTMLElement.prototype, 'clientHeight', originalHeight);
      else Reflect.deleteProperty(HTMLElement.prototype, 'clientHeight');
      vi.unstubAllGlobals();
    }
  });

  it('hides and restores the top bar for read-only canvases', () => {
    const { container, getByRole } = render(
      <CanvasView canvas={canvas()} elementRuntime={{}} diagnostics={[]} browserRegistry={registry()} readOnly />
    );
    const topbar = container.querySelector<HTMLElement>('#canvas-topbar');
    expect(topbar?.hidden).toBe(false);
    fireEvent.click(getByRole('button', { name: 'Hide top bar' }));
    expect(topbar?.hidden).toBe(true);
    expect(container.querySelector('.canvas-viewport')).not.toBeNull();
    fireEvent.click(getByRole('button', { name: 'Show top bar' }));
    expect(topbar?.hidden).toBe(false);
  });

  it('exposes the same default frame and anchor to browser renderers as the editor', async () => {
    const mount = vi.fn<BrowserElementRenderer['mount']>(() => ({ update() {}, dispose() {} }));
    const browserRegistry = registry();
    browserRegistry.renderers = new Map([[renderer.type, { ...renderer, mount }]]);
    const document = canvas();
    document.elements[0].width = null;
    document.elements[0].height = null;
    const { unmount } = render(
      <CanvasView canvas={document} elementRuntime={{}} diagnostics={[]} browserRegistry={browserRegistry} />
    );
    await waitFor(() => expect(mount).toHaveBeenCalledOnce());
    const context = mount.mock.calls[0][1];
    expect(context.geometry.getElementFrame('card_1')).toEqual({ x: 10, y: 20, width: 240, height: 120 });
    expect(context.geometry.resolveAnchor('card_1', 'center')).toEqual({ x: 130, y: 80 });
    unmount();
  });
  it('updates selection and runtime context without remounting and disposes the renderer on unmount', async () => {
    const update = vi.fn();
    const dispose = vi.fn();
    const mount = vi.fn(() => ({ update, dispose }));
    const browserRegistry = registry();
    browserRegistry.renderers = new Map([[renderer.type, { ...renderer, mount }]]);
    const document = canvas();
    const props = { canvas: document, elementRuntime: {}, diagnostics: [], browserRegistry };
    const { container, rerender, unmount } = render(<CanvasView {...props} />);
    await waitFor(() => expect(mount).toHaveBeenCalledOnce());
    fireEvent.click(container.querySelector('[data-element-id="card_1"]') as Element);
    await waitFor(() => expect(update).toHaveBeenCalledWith(expect.objectContaining({ selected: true })));
    rerender(<CanvasView {...props} elementRuntime={{ card_1: { refreshed: true } }} />);
    await waitFor(() => expect(update).toHaveBeenCalledWith(expect.objectContaining({ runtime: { refreshed: true } })));
    expect(mount).toHaveBeenCalledOnce();
    unmount();
    await waitFor(() => expect(dispose).toHaveBeenCalledOnce());
  });

  it('collapses multiple diagnostics behind a compact severity summary', () => {
    const diagnostics = Array.from({ length: 6 }, (_, index) => ({
      code: `quality_${index}`,
      severity: 'warning' as const,
      message: `Warning ${index}`,
      retryable: false,
      elementId: `card_${index}`
    }));
    const { container, getByText } = render(
      <CanvasView
        canvas={canvas()}
        elementRuntime={{}}
        diagnostics={diagnostics}
        browserRegistry={registry()}
        readOnly
      />
    );
    const panel = container.querySelector<HTMLDetailsElement>('.plugin-diagnostics');
    expect(panel?.open).toBe(false);
    expect(getByText('6 warnings')).toBeTruthy();
    expect(container.querySelectorAll('.diagnostic-item')).toHaveLength(6);
  });

  it('fits non-empty canvas content on first load when no viewport has been saved', async () => {
    const onViewportChange = vi.fn();
    render(
      <CanvasView
        canvas={canvas()}
        elementRuntime={{}}
        diagnostics={[]}
        browserRegistry={registry()}
        initialViewport={{
          centerX: 0,
          centerY: 0,
          zoom: 1,
          width: 1920,
          height: 900,
          source: 'default',
          updatedAt: null
        }}
        onViewportChange={onViewportChange}
      />
    );

    await waitFor(() => expect(onViewportChange).toHaveBeenCalled(), { timeout: 1_000 });
    const reported = onViewportChange.mock.calls.at(-1)?.[0];
    expect(reported).toMatchObject({ centerX: 90, centerY: 60, zoom: 8, source: 'user' });
  });

  it('preserves a saved user viewport instead of auto-fitting it', async () => {
    const onViewportChange = vi.fn();
    render(
      <CanvasView
        canvas={canvas()}
        elementRuntime={{}}
        diagnostics={[]}
        browserRegistry={registry()}
        initialViewport={{
          centerX: 500,
          centerY: 250,
          zoom: 0.75,
          width: 1920,
          height: 900,
          source: 'user',
          updatedAt: '2026-07-13T00:00:00.000Z'
        }}
        onViewportChange={onViewportChange}
      />
    );

    await waitFor(() => expect(onViewportChange).toHaveBeenCalled(), { timeout: 1_000 });
    expect(onViewportChange.mock.calls.at(-1)?.[0]).toMatchObject({
      centerX: 500,
      centerY: 250,
      zoom: 0.75,
      source: 'user'
    });
  });

  it('renders plugin content in Shadow DOM and hides mutation handles for read-only shares', async () => {
    const { container, unmount } = render(
      <CanvasView canvas={canvas()} elementRuntime={{}} diagnostics={[]} browserRegistry={registry()} readOnly />
    );
    await waitFor(() => {
      const frame = container.querySelector<HTMLElement>('[data-element-id="card_1"]');
      expect(frame?.querySelector('.plugin-renderer-surface')?.shadowRoot?.textContent).toContain('Hello Shadow DOM');
    });
    expect(container.querySelector('.agentcanvas-editor-drag-handle')).toBeNull();
    unmount();
    expect(container.querySelector('[data-element-id="card_1"]')).toBeNull();
  });

  it('lets interactive plugin content receive pointer gestures without dragging or panning the canvas', async () => {
    const { container } = render(
      <CanvasView canvas={canvas()} elementRuntime={{}} diagnostics={[]} browserRegistry={registry()} />
    );
    const surface = await waitFor(() => {
      const value = container.querySelector<HTMLElement>('.plugin-renderer-surface');
      if (!value?.shadowRoot) throw new Error('plugin surface not mounted');
      return value;
    });
    expect(surface.classList).toContain('agentcanvas-editor-no-drag');
    expect(surface.classList).toContain('agentcanvas-editor-no-pan');
    const wheel = vi.fn();
    surface.parentElement?.addEventListener('wheel', wheel);
    surface.shadowRoot
      ?.querySelector('button')
      ?.dispatchEvent(new WheelEvent('wheel', { bubbles: true, composed: true }));
    expect(wheel).not.toHaveBeenCalled();
    surface.dispatchEvent(new WheelEvent('wheel', { bubbles: true, composed: true }));
    expect(wheel).toHaveBeenCalledTimes(1);
    surface.parentElement?.removeEventListener('wheel', wheel);

    const button = surface.shadowRoot?.querySelector('button');
    const pointerDown = vi.fn();
    button?.addEventListener('pointerdown', pointerDown);
    fireEvent.pointerDown(button as Element);
    expect(pointerDown).toHaveBeenCalledOnce();
  });

  it('renders one host-owned Details affordance for renderers that opt in', async () => {
    const { container } = render(
      <CanvasView canvas={canvas()} elementRuntime={{}} diagnostics={[]} browserRegistry={registry()} />
    );
    const details = await waitFor(() => {
      const value = container.querySelector<HTMLButtonElement>('.plugin-renderer-details');
      if (!value) throw new Error('details button not mounted');
      return value;
    });
    expect(details.textContent).toBe('Details');
    fireEvent.click(details);
    await waitFor(() =>
      expect(renderer.details?.open).toHaveBeenCalledWith(
        expect.objectContaining({ element: expect.objectContaining({ id: 'card_1' }) })
      )
    );
  });

  it('keeps visible host-owned movement and resize controls for editable elements', async () => {
    const moved = vi.fn(async () => canvas());
    const { container } = render(
      <CanvasView
        canvas={canvas()}
        elementRuntime={{}}
        diagnostics={[]}
        browserRegistry={registry()}
        onCanvasOperations={moved}
      />
    );
    await waitFor(() => {
      expect(container.querySelector<HTMLButtonElement>('.agentcanvas-editor-drag-handle')).not.toBeNull();
    });
    expect(moved).not.toHaveBeenCalled();
  });

  it('restores the confirmed frame after a failed optimistic commit', async () => {
    const failed = vi.fn(async () => {
      throw new Error('revision conflict');
    });
    const { container, getByText } = render(
      <CanvasView
        canvas={canvas()}
        elementRuntime={{}}
        diagnostics={[]}
        browserRegistry={registry()}
        onCanvasOperations={failed}
      />
    );
    const frame = await waitFor(() => {
      const value = container.querySelector<HTMLElement>('[data-element-id="card_1"]');
      if (!value) throw new Error('frame not mounted');
      return value;
    });
    const flowNode = frame.closest<HTMLElement>('.react-flow__node');
    const before = flowNode?.style.transform;
    fireEvent.click(frame);
    fireEvent.keyDown(container.querySelector('.agentcanvas-editor') as Element, { key: 'ArrowRight' });
    await waitFor(() => expect(failed).toHaveBeenCalledOnce());
    await waitFor(() => expect(getByText('revision conflict')).toBeTruthy());
    expect(flowNode?.style.transform).toBe(before);
  });
});
