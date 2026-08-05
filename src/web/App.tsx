import React, { useEffect, useState } from 'react';
import type { AgentCanvasConfiguration } from '../configuration';
import {
  applyCanvasOperations,
  executeMacro,
  fetchAgentCanvasConfiguration,
  fetchCanvasFromLocation,
  fetchCanvasList,
  fetchViewportState,
  saveUserViewport,
  updateAgentCanvasConfiguration,
  updateCanvasBounds
} from './api';
import { CanvasIndex } from './components/CanvasIndex';
import { CanvasView } from './components/CanvasView';
import { fetchBrowserPluginCatalog, loadBrowserPluginRegistry, type LoadedBrowserRegistry } from './plugins/catalog';
import type { CanvasBounds, CanvasDocument, CanvasProjection, CanvasViewport } from './v2-types';
import type { MacroServiceExecuteRequest } from '../macros/types';
import type { EmbedSessionSummary } from '../embed-sessions';
import { embedCanvasUrl, embedTokenFromPath, isAgentCanvasHostMessage, postEmbedMessage } from './embed-bridge';
import { coerceViewport, readViewportCookie, writeViewportCookie } from './viewport';

type AppState =
  | { mode: 'index'; canvases: CanvasDocument[]; configuration: AgentCanvasConfiguration }
  | (CanvasProjection & {
      mode: 'canvas';
      readOnly: boolean;
      initialViewport: CanvasViewport;
      embedSession?: EmbedSessionSummary;
    });

function isCanvasIndexPath(pathname: string): boolean {
  return pathname === '/' || pathname === '/canvases' || pathname === '/canvases/';
}

export function App() {
  const [state, setState] = useState<AppState | null>(null);
  const [browserRegistry, setBrowserRegistry] = useState<LoadedBrowserRegistry | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let activeRegistry: LoadedBrowserRegistry | null = null;
    const indexMode = isCanvasIndexPath(window.location.pathname);
    const embedMode = window.location.pathname.startsWith('/embed/');

    function installRegistry(registry: LoadedBrowserRegistry): boolean {
      if (cancelled) {
        void registry.dispose();
        return false;
      }
      activeRegistry = registry;
      setBrowserRegistry(registry);
      return true;
    }

    async function loadInitial() {
      setError(null);
      const registryPromise = fetchBrowserPluginCatalog().then((catalog) => loadBrowserPluginRegistry({ catalog }));
      if (indexMode) {
        const [canvases, configuration, registry] = await Promise.all([
          fetchCanvasList(),
          fetchAgentCanvasConfiguration(),
          registryPromise
        ]);
        if (installRegistry(registry)) {
          setState({ mode: 'index', canvases, configuration });
        }
        return;
      }
      const [loaded, registry] = await Promise.all([fetchCanvasFromLocation(), registryPromise]);
      let viewport = coerceViewport(null);
      if (loaded.canvas.id !== 'empty') {
        let serverState = null;
        try {
          serverState = await fetchViewportState(loaded.canvas.id);
        } catch (cause) {
          setWarning(`Viewport state is unavailable: ${cause instanceof Error ? cause.message : String(cause)}`);
        }
        viewport = coerceViewport(readViewportCookie(loaded.canvas.id) ?? serverState?.userViewport);
      }
      if (installRegistry(registry)) {
        setState({ mode: 'canvas', ...loaded, initialViewport: viewport });
      }
    }

    async function refresh() {
      if (indexMode) {
        const [canvases, configuration] = await Promise.all([fetchCanvasList(), fetchAgentCanvasConfiguration()]);
        if (!cancelled) setState({ mode: 'index', canvases, configuration });
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
        return { ...current, ...loaded };
      });
    }

    loadInitial().catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)));
    const timer = window.setInterval(
      () =>
        void refresh().catch((cause) => {
          const message = `Canvas refresh failed: ${cause instanceof Error ? cause.message : String(cause)}`;
          if (embedMode) setError(message);
          else setWarning(message);
        }),
      indexMode ? 5_000 : 1_500
    );
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      void activeRegistry?.dispose();
    };
  }, []);

  useEffect(() => {
    if (!state || state.mode !== 'canvas' || !state.embedSession) return;
    const session = state.embedSession;
    postEmbedMessage(session, 'ready', {
      canvasId: state.canvas.id,
      canvasIds: session.canvasIds,
      mode: session.mode,
      readOnly: state.readOnly,
      expiresAt: session.expiresAt
    });

    const onMessage = (event: MessageEvent) => {
      if (event.source !== window.parent || event.origin !== session.parentOrigin) return;
      if (!isAgentCanvasHostMessage(event.data)) return;
      if (event.data.type === 'refresh') {
        window.location.reload();
        return;
      }
      const canvasId = event.data.canvasId;
      if (!canvasId || !session.canvasIds.includes(canvasId)) {
        postEmbedMessage(session, 'error', {
          code: 'embed_canvas_forbidden',
          message: 'The requested canvas is not part of this embed session.'
        });
        return;
      }
      const token = embedTokenFromPath(window.location.pathname);
      if (!token) {
        postEmbedMessage(session, 'error', {
          code: 'embed_session_path_invalid',
          message: 'The embed session path is invalid.'
        });
        return;
      }
      window.location.assign(embedCanvasUrl(token, canvasId));
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [state?.mode, state?.mode === 'canvas' ? state.canvas.id : null]);

  useEffect(() => {
    if (!state || state.mode !== 'canvas' || !state.embedSession) return;
    postEmbedMessage(state.embedSession, 'canvas.updated', {
      canvasId: state.canvas.id,
      revision: state.canvas.revision,
      updatedAt: state.canvas.updatedAt
    });
  }, [
    state?.mode,
    state?.mode === 'canvas' ? state.canvas.id : null,
    state?.mode === 'canvas' ? state.canvas.revision : null
  ]);

  if (error) return <div className="error">{error}</div>;
  if (!state || !browserRegistry) return <div className="loading">Loading AgentCanvas…</div>;
  if (state.mode === 'index') {
    return (
      <>
        {warning && (
          <div className="error" role="status">
            {warning}
          </div>
        )}
        <CanvasIndex
          canvases={state.canvases}
          configuration={state.configuration}
          onDefaultCanvasSizeChange={async (defaultCanvasSize) => {
            const configuration = await updateAgentCanvasConfiguration(defaultCanvasSize);
            setState((current) => (current?.mode === 'index' ? { ...current, configuration } : current));
          }}
        />
      </>
    );
  }

  return (
    <CanvasView
      canvas={state.canvas}
      elementRuntime={state.elementRuntime}
      diagnostics={[
        ...state.diagnostics,
        ...browserRegistry.diagnostics,
        ...(warning
          ? [{ code: 'host_refresh_failed', severity: 'warning' as const, message: warning, retryable: true }]
          : [])
      ]}
      browserRegistry={browserRegistry}
      readOnly={state.readOnly}
      initialViewport={state.initialViewport}
      loadViewport={() => fetchViewportState(state.canvas.id)}
      onCanvasBoundsChange={async (bounds: CanvasBounds) => {
        const canvas = await updateCanvasBounds(state.canvas.id, bounds, state.canvas.revision);
        setState((current) =>
          current?.mode === 'canvas' && current.canvas.id === canvas.id ? { ...current, canvas } : current
        );
      }}
      onCanvasOperations={async (operations, expectedRevision) => {
        const canvas = await applyCanvasOperations(state.canvas.id, operations, expectedRevision);
        setState((current) =>
          current?.mode === 'canvas' && current.canvas.id === canvas.id ? { ...current, canvas } : current
        );
        return canvas;
      }}
      onMacroExecute={async (request: MacroServiceExecuteRequest) => {
        const result = await executeMacro(request);
        setState((current) =>
          current?.mode === 'canvas' && current.canvas.id === result.canvas.id
            ? { ...current, canvas: result.canvas as CanvasDocument }
            : current
        );
        return result;
      }}
      onViewportChange={(viewport) => {
        writeViewportCookie(state.canvas.id, viewport);
        void saveUserViewport(state.canvas.id, viewport).catch((cause) =>
          setWarning(`Viewport save failed: ${cause instanceof Error ? cause.message : String(cause)}`)
        );
      }}
    />
  );
}
