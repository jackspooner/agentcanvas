import React from 'react';
import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/web/App';

function canvas(revision: number, elements: unknown[] = []) {
  return {
    id: 'canvas_poll',
    title: 'Polling canvas',
    createdBy: 'agent',
    createdAt: '2026-06-11T00:00:00.000Z',
    updatedAt: `2026-06-11T00:00:0${revision}.000Z`,
    width: 800,
    height: 600,
    revision,
    elements
  };
}

describe('App canvas refresh', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    window.history.pushState({}, '', '/canvases/canvas_poll');
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('polls the current canvas and renders agent-added elements without a browser refresh', async () => {
    let canvasFetches = 0;
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/viewport')) {
        return new Response(JSON.stringify({ ok: true, userViewport: { centerX: 0, centerY: 0, zoom: 1, width: 1920, height: 900, source: 'default' }, agentViewport: null }), { headers: { 'content-type': 'application/json' } });
      }
      if (url.endsWith('/api/canvases/canvas_poll')) {
        canvasFetches += 1;
        const body = canvasFetches === 1
          ? canvas(1)
          : canvas(2, [{ id: 'text_new', type: 'text', x: 10, y: 10, text: 'agent-added node' }]);
        return new Response(JSON.stringify({ ok: true, canvas: body }), { headers: { 'content-type': 'application/json' } });
      }
      throw new Error(`unexpected fetch ${url}`);
    }));

    let rendered!: ReturnType<typeof render>;
    await act(async () => {
      rendered = render(<App />);
      await Promise.resolve();
    });
    await vi.waitFor(() => expect(screen.getByText('Polling canvas')).toBeTruthy());
    expect(screen.queryByText('agent-added node')).toBeNull();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1600);
    });

    await vi.waitFor(() => expect(screen.getByText('agent-added node')).toBeTruthy());
    expect(document.body.textContent).toContain('revision 2');
    rendered.unmount();
  });

  it('renders a root canvas chooser with links to every returned canvas', async () => {
    window.history.pushState({}, '', '/');
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/api/canvases?limit=200')) {
        return new Response(JSON.stringify({
          ok: true,
          canvases: [
            canvas(2, [{ id: 'text_1', type: 'text', x: 0, y: 0, text: 'First' }]),
            { ...canvas(1), id: 'canvas_second', title: 'Second canvas', project: 'demo', elements: [] }
          ]
        }), { headers: { 'content-type': 'application/json' } });
      }
      throw new Error(`unexpected fetch ${url}`);
    }));

    let rendered!: ReturnType<typeof render>;
    await act(async () => {
      rendered = render(<App />);
      await Promise.resolve();
    });

    await vi.waitFor(() => expect(screen.getByText('Polling canvas')).toBeTruthy());
    expect(screen.getByText('Second canvas')).toBeTruthy();
    expect(screen.getByText('2 canvases')).toBeTruthy();
    expect(screen.getByRole('link', { name: /Polling canvas/ }).getAttribute('href')).toBe('/canvases/canvas_poll');
    expect(screen.getByRole('link', { name: /Second canvas/ }).getAttribute('href')).toBe('/canvases/canvas_second');
    rendered.unmount();
  });
});
