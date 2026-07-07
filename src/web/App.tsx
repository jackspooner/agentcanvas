import React, { useEffect, useState } from 'react';
import type { CanvasRecord, CanvasViewport } from '../contracts';
import {
  fetchCanvasFromLocation,
  fetchCanvasList,
  fetchViewportState,
  moveCanvasElement,
  saveUserViewport
} from './api';
import { CanvasIndex } from './components/CanvasIndex';
import { CanvasView } from './components/CanvasView';
import { coerceViewport, readViewportCookie, writeViewportCookie } from './viewport';

type AppState =
  | { mode: 'index'; canvases: CanvasRecord[] }
  | { mode: 'canvas'; canvas: CanvasRecord; readOnly: boolean; initialViewport: CanvasViewport };

function isCanvasIndexPath(pathname: string): boolean {
  return pathname === '/' || pathname === '/canvases' || pathname === '/canvases/';
}

export function App() {
  const [state, setState] = useState<AppState | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const indexMode = isCanvasIndexPath(window.location.pathname);

    async function loadInitial() {
      setError(null);
      if (indexMode) {
        const canvases = await fetchCanvasList();
        if (!cancelled) setState({ mode: 'index', canvases });
        return;
      }
      const loaded = await fetchCanvasFromLocation();
      let viewport = coerceViewport(null);
      if (loaded.canvas.id !== 'empty') {
        const serverState = await fetchViewportState(loaded.canvas.id).catch(() => null);
        viewport = coerceViewport(readViewportCookie(loaded.canvas.id) ?? serverState?.userViewport);
      }
      if (!cancelled) setState({ mode: 'canvas', ...loaded, initialViewport: viewport });
    }

    async function refresh() {
      if (indexMode) {
        const canvases = await fetchCanvasList();
        if (!cancelled) setState({ mode: 'index', canvases });
        return;
      }
      const loaded = await fetchCanvasFromLocation();
      if (cancelled) return;
      setState((current) => {
        if (!current || current.mode !== 'canvas') return current;
        if (current.canvas.id !== loaded.canvas.id)
          return { mode: 'canvas', ...loaded, initialViewport: current.initialViewport };
        if (current.canvas.revision === loaded.canvas.revision && current.canvas.updatedAt === loaded.canvas.updatedAt)
          return current;
        return { ...current, canvas: loaded.canvas, readOnly: loaded.readOnly };
      });
    }

    loadInitial().catch((err) => setError(err instanceof Error ? err.message : String(err)));
    const timer = window.setInterval(
      () => {
        refresh().catch(() => {
          // Best-effort canvas polling: transient service errors should not interrupt viewing.
        });
      },
      indexMode ? 5000 : 1500
    );
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  if (error) return <div className="error">{error}</div>;
  if (!state) return <div className="loading">Loading AgentCanvas…</div>;
  if (state.mode === 'index') return <CanvasIndex canvases={state.canvases} />;
  const canvasState = state;

  return (
    <CanvasView
      canvas={canvasState.canvas}
      readOnly={canvasState.readOnly}
      initialViewport={canvasState.initialViewport}
      loadViewport={() => fetchViewportState(canvasState.canvas.id)}
      onElementMove={async (elementId, x, y) => {
        const updatedCanvas = await moveCanvasElement(canvasState.canvas.id, elementId, x, y);
        setState((current) =>
          current?.mode === 'canvas' && current.canvas.id === updatedCanvas.id
            ? { ...current, canvas: updatedCanvas, readOnly: canvasState.readOnly }
            : current
        );
      }}
      onViewportChange={(viewport) => {
        writeViewportCookie(canvasState.canvas.id, viewport);
        void saveUserViewport(canvasState.canvas.id, viewport);
      }}
    />
  );
}
