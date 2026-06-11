import React, { useEffect, useState } from 'react';
import type { CanvasRecord, CanvasViewport } from '../contracts';
import { fetchCanvasFromLocation, fetchViewportState, saveUserViewport } from './api';
import { CanvasView } from './components/CanvasView';
import { coerceViewport, readViewportCookie, writeViewportCookie } from './viewport';

export function App() {
  const [state, setState] = useState<{ canvas: CanvasRecord; readOnly: boolean; initialViewport: CanvasViewport } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const loaded = await fetchCanvasFromLocation();
      let viewport = coerceViewport(null);
      if (loaded.canvas.id !== 'empty') {
        const serverState = await fetchViewportState(loaded.canvas.id).catch(() => null);
        viewport = coerceViewport(readViewportCookie(loaded.canvas.id) ?? serverState?.userViewport);
      }
      if (!cancelled) setState({ ...loaded, initialViewport: viewport });
    }
    load().catch((err) => setError(err instanceof Error ? err.message : String(err)));
    return () => { cancelled = true; };
  }, []);

  if (error) return <div className="error">{error}</div>;
  if (!state) return <div className="loading">Loading AgentCanvas…</div>;

  return (
    <CanvasView
      canvas={state.canvas}
      readOnly={state.readOnly}
      initialViewport={state.initialViewport}
      loadViewport={() => fetchViewportState(state.canvas.id)}
      onViewportChange={(viewport) => {
        writeViewportCookie(state.canvas.id, viewport);
        void saveUserViewport(state.canvas.id, viewport);
      }}
    />
  );
}
