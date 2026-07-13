import type { BrowserElementRenderer } from '@agentcanvas/plugin-sdk';
import { fireEvent, render, waitFor } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { CanvasView } from '../src/web/components/CanvasView';
import type { LoadedBrowserRegistry } from '../src/web/plugins/catalog';
import type { CanvasDocument } from '../src/web/v2-types';

const renderer: BrowserElementRenderer = {
  type: 'fixture.cards/card',
  schemaVersions: [1],
  placement: 'node',
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
    diagnostics: []
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
  it('renders plugin content in Shadow DOM and hides mutation handles for read-only shares', async () => {
    const { container, unmount } = render(
      <CanvasView canvas={canvas()} elementRuntime={{}} diagnostics={[]} browserRegistry={registry()} readOnly />
    );
    await waitFor(() => {
      const frame = container.querySelector<HTMLElement>('[data-element-id="card_1"]');
      expect(frame?.querySelector('.plugin-renderer-surface')?.shadowRoot?.textContent).toContain('Hello Shadow DOM');
    });
    expect(container.querySelector('.plugin-frame-drag-handle')).toBeNull();
    unmount();
    expect(container.querySelector('[data-element-id="card_1"]')).toBeNull();
  });

  it('keeps a visible host drag handle and persists only frame coordinates', async () => {
    const moved = vi.fn(async () => undefined);
    const { container } = render(
      <CanvasView
        canvas={canvas()}
        elementRuntime={{}}
        diagnostics={[]}
        browserRegistry={registry()}
        onElementMove={moved}
      />
    );
    const handle = container.querySelector<HTMLButtonElement>('.plugin-frame-drag-handle') as HTMLButtonElement;
    fireEvent.pointerDown(handle, { button: 0, pointerId: 5, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(handle, { pointerId: 5, clientX: 30, clientY: 40 });
    fireEvent.pointerUp(handle, { pointerId: 5, clientX: 30, clientY: 40 });
    await waitFor(() => expect(moved).toHaveBeenCalledWith('card_1', 30, 50));
  });
});
