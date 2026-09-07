import React from 'react';
import { act, cleanup, render } from '@testing-library/react';
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
