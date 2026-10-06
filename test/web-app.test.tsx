import React from 'react';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/web/App';
import { applyCanvasOperations, saveUserViewport } from '../src/web/api';
import type { CanvasView } from '../src/web/components/CanvasView';
import type { CanvasDocument, CanvasProjection } from '../src/web/v2-types';
import * as embedBridge from '../src/web/embed-bridge';

const view = vi.hoisted(() => ({ current: null as unknown as React.ComponentProps<typeof CanvasView> }));
vi.mock('../src/web/components/CanvasView', () => ({
  CanvasView: (props: React.ComponentProps<typeof CanvasView>) => {
    view.current = props;
    return <output>{props.canvas.revision}</output>;
  }
}));
vi.mock('../src/web/plugins/catalog', () => ({
  fetchBrowserPluginCatalog: async () => ({}),
  loadBrowserPluginRegistry: async () => ({ diagnostics: [], dispose: async () => {} })
}));

function projection(revision: number, handle: string): CanvasProjection {
  return {
    canvas: {
      id: 'test',
      title: 'Test',
      createdBy: 'user',
      createdAt: '',
      updatedAt: String(revision),
      bounds: { mode: 'unlimited' },
      elements: [],
      revision,
      documentVersion: 2
    },
    elementRuntime: { media: { handle } },
    diagnostics: []
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

let current: CanvasProjection;
let read: () => Promise<Response>;
let mutation: () => Promise<Response>;
let requests: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.useFakeTimers();
  window.history.replaceState({}, '', '/canvases/test');
  current = projection(1, 'old');
  read = async () => Response.json(current);
  mutation = async () => Response.json(current);
  requests = vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === 'POST' || init?.method === 'PATCH') return mutation();
    if (url.endsWith('/viewport')) return Response.json({ userViewport: null });
    return read();
  });
  vi.stubGlobal('fetch', requests);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('browser projection reconciliation', () => {
  it('removes the stale editor when the canvas is deleted during polling', async () => {
    const screen = await act(async () => render(<App />));
    expect(screen.getByText('1')).toBeTruthy();
    read = async () => Response.json({ code: 'not_found', detail: 'Canvas was deleted' }, { status: 404 });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });
    expect(screen.queryByText('1')).toBeNull();
    expect(screen.getByText(/Canvas was deleted/)).toBeTruthy();
  });
  it('reports direct, shared, and embedded visible views and replaces a hidden session', async () => {
    let visible = true;
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => (visible ? 'visible' : 'hidden')
    });
    const viewport = {
      centerX: 15,
      centerY: -3,
      zoom: 1.5,
      width: 800,
      height: 600,
      source: 'user' as const,
      updatedAt: null
    };
    try {
      for (const route of ['/canvases/test', '/c/share-token', '/embed/embed-token']) {
        window.history.replaceState({}, '', route);
        read = async () =>
          Response.json({
            ...current,
            ...(route.startsWith('/embed/')
              ? {
                  session: {
                    id: 'session',
                    canvasIds: ['test'],
                    mode: 'read',
                    parentOrigin: 'https://parent.example',
                    createdAt: '',
                    expiresAt: 'later'
                  },
                  readOnly: true
                }
              : {})
          });
        const screen = await act(async () => render(<App />));
        requests.mockClear();
        await act(async () => view.current.onViewportChange?.(viewport));
        const reports = () =>
          requests.mock.calls.filter(([url, init]) => url.includes('/viewer-presence/') && init?.method === 'PUT');
        expect(reports()).toHaveLength(1);
        expect(JSON.parse(reports()[0][1].body as string)).toEqual({
          centerX: 15,
          centerY: -3,
          zoom: 1.5,
          width: 800,
          height: 600
        });
        const firstUrl = reports()[0][0];
        visible = false;
        await act(async () => fireEvent(document, new Event('visibilitychange')));
        expect(requests).toHaveBeenCalledWith(firstUrl, expect.objectContaining({ method: 'DELETE', keepalive: true }));
        visible = true;
        await act(async () => fireEvent(document, new Event('visibilitychange')));
        expect(reports()).toHaveLength(2);
        expect(reports()[1][0]).not.toBe(firstUrl);
        screen.unmount();
      }
    } finally {
      Reflect.deleteProperty(document, 'visibilityState');
    }
  });

  it('does not let an earlier index poll reset saved diagnostics settings', async () => {
    window.history.replaceState({}, '', '/');
    const initial = {
      defaultCanvasSize: { mode: 'unlimited' },
      diagnostics: { overlapMode: 'bounded', maxOverlapWarnings: 100 },
      source: 'runtime-default',
      updatedAt: null
    };
    const saved = { ...initial, diagnostics: { overlapMode: 'all', maxOverlapWarnings: 100 } };
    const stale = deferred<Response>();
    let configurationReads = 0;
    requests.mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === 'PATCH') return Response.json({ configuration: saved });
      if (url === '/api/v1/configuration') {
        configurationReads += 1;
        return configurationReads === 1 ? Response.json({ configuration: initial }) : stale.promise;
      }
      return Response.json({ canvases: [] });
    });
    const screen = await act(async () => render(<App />));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    await act(async () => {
      fireEvent.change(screen.getByLabelText('Overlap warnings'), { target: { value: 'all' } });
    });
    await act(async () => {
      fireEvent.submit(screen.getByRole('button', { name: 'Save diagnostics' }).closest('form') as HTMLFormElement);
    });
    await act(async () => {
      stale.resolve(Response.json({ configuration: initial }));
    });
    expect((screen.getByLabelText('Overlap warnings') as HTMLSelectElement).value).toBe('all');
    expect(requests).toHaveBeenCalledWith(
      '/api/v1/configuration',
      expect.objectContaining({ body: JSON.stringify({ diagnostics: saved.diagnostics, actor: 'web-ui' }) })
    );
  });
  it('keeps embed notifications stable on polls and refreshes changed session authority', async () => {
    window.history.replaceState({}, '', '/embed/token');
    let session = {
      id: 'session',
      canvasIds: ['test'],
      mode: 'read',
      parentOrigin: 'https://parent.example',
      createdAt: '',
      expiresAt: 'later'
    };
    read = async () => Response.json({ ...current, session, readOnly: session.mode === 'read' });
    const post = vi.spyOn(embedBridge, 'postEmbedMessage').mockImplementation(() => {});
    try {
      await act(async () => {
        render(<App />);
      });
      expect(post.mock.calls.map((call) => call[1])).toEqual(['ready', 'canvas.updated']);
      post.mockClear();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1500);
      });
      expect(post).not.toHaveBeenCalled();
      current = projection(2, 'new');
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1500);
      });
      expect(post).toHaveBeenCalledWith(session, 'canvas.updated', expect.objectContaining({ revision: 2 }));
      post.mockClear();
      session = { ...session, mode: 'edit', parentOrigin: 'https://updated.example' };
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1500);
      });
      expect(post).toHaveBeenCalledWith(session, 'ready', expect.objectContaining({ readOnly: false }));
    } finally {
      post.mockRestore();
    }
  });

  it('applies batch resources immediately, refreshes equal revisions, and rejects obsolete reads', async () => {
    await act(async () => {
      render(<App />);
    });
    expect(view.current.elementRuntime.media).toEqual({ handle: 'old' });
    const pending = deferred<Response>();
    read = () => pending.promise;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });
    const count = requests.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(requests).toHaveBeenCalledTimes(count);

    current = projection(2, 'batch');
    let result: CanvasDocument | undefined;
    await act(async () => {
      result = await view.current.onCanvasOperations?.([{ op: 'clear' }], 1);
    });
    expect(result?.revision).toBe(2);
    expect(view.current.elementRuntime.media).toEqual({ handle: 'batch' });
    await act(async () => {
      pending.resolve(Response.json(projection(1, 'obsolete')));
    });
    expect(view.current.canvas.revision).toBe(2);
    expect(view.current.elementRuntime.media).toEqual({ handle: 'batch' });

    current = projection(2, 'renewed');
    read = async () => Response.json(current);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });
    expect(view.current.elementRuntime.media).toEqual({ handle: 'renewed' });
    current = projection(1, 'older');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });
    expect(view.current.canvas.revision).toBe(2);
    expect(view.current.elementRuntime.media).toEqual({ handle: 'renewed' });
  });

  it('retains successful macros and metadata changes when their projection refresh fails', async () => {
    await act(async () => {
      render(<App />);
    });
    const macro = {
      canvas: projection(2, 'macro').canvas,
      provenance: {},
      outputs: { item: 'new' },
      history: { label: 'Macro' }
    };
    mutation = async () => Response.json(macro);
    read = async () => {
      throw new Error('offline');
    };
    let result: unknown;
    await act(async () => {
      result = await view.current.onMacroExecute?.({
        canvasId: 'test',
        planId: 'plan',
        expectedRevision: 1,
        idempotencyKey: 'once'
      });
    });
    expect(result).toEqual(macro);
    expect(view.current.canvas.revision).toBe(2);
    expect(view.current.diagnostics).toContainEqual(
      expect.objectContaining({ message: 'Canvas refresh failed: offline' })
    );
    expect(requests.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);

    current = projection(3, 'metadata');
    mutation = async () => Response.json(current);
    read = async () => Response.json(current);
    await act(async () => {
      await view.current.onCanvasBoundsChange?.({ mode: 'unlimited' });
    });
    expect(view.current.canvas.revision).toBe(3);
    expect(view.current.elementRuntime.media).toEqual({ handle: 'metadata' });
    expect(view.current.diagnostics).toEqual([]);
  });

  it('ignores a pending read after unmount', async () => {
    const mounted = render(<App />);
    await act(async () => {});
    const pending = deferred<Response>();
    read = () => pending.promise;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });
    mounted.unmount();
    const before = view.current;
    await act(async () => {
      pending.resolve(Response.json(projection(2, 'late')));
    });
    expect(view.current).toBe(before);
    expect(vi.getTimerCount()).toBe(0);
  });
});

it('preserves Problem Details for batch and viewport failures without exposing HTML', async () => {
  mutation = async () =>
    Response.json(
      { detail: 'expected revision 1, current revision 2', code: 'revision_conflict', requestId: 'req_test' },
      { status: 409 }
    );
  await expect(applyCanvasOperations('test', [{ op: 'clear' }], 1)).rejects.toMatchObject({
    status: 409,
    code: 'revision_conflict',
    requestId: 'req_test',
    message: expect.stringContaining('current revision 2')
  });
  await expect(
    saveUserViewport('test', {
      centerX: 0,
      centerY: 0,
      zoom: 1,
      width: 100,
      height: 100,
      source: 'user',
      updatedAt: null
    })
  ).rejects.toMatchObject({ code: 'revision_conflict' });
  mutation = async () => new Response('<html>private upstream details</html>', { status: 502 });
  await expect(applyCanvasOperations('test', [{ op: 'clear' }])).rejects.toThrow(
    'failed to update canvas elements: 502'
  );
});
