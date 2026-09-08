import React, { useEffect, useRef, useState } from 'react';
import type { AgentCanvasConfiguration, UpdateAgentCanvasConfigurationInput } from '../configuration';
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
  const mounted = useRef(false);
  const readGeneration = useRef(0);
  const refreshAfterMutation = useRef<() => Promise<void>>(async () => {});

  async function saveConfiguration(settings: UpdateAgentCanvasConfigurationInput) {
    const generation = ++readGeneration.current;
    const configuration = await updateAgentCanvasConfiguration(settings);
    if (!mounted.current || generation !== readGeneration.current) return;
    readGeneration.current += 1;
    setState((current) => (current?.mode === 'index' ? { ...current, configuration } : current));
  }

  function installMutation(next: { canvas: CanvasDocument } & Partial<CanvasProjection>) {
    if (!mounted.current) return;
    readGeneration.current += 1;
    setState((current) =>
      current?.mode === 'canvas' &&
      current.canvas.id === next.canvas.id &&
      next.canvas.revision >= current.canvas.revision
        ? { ...current, ...next }
        : current
    );
  }

  function refreshCommittedCanvas() {
    if (!mounted.current) return;
    void refreshAfterMutation.current().catch((cause) => {
      if (mounted.current)
        setWarning(`Canvas refresh failed: ${cause instanceof Error ? cause.message : String(cause)}`);
    });
  }

  useEffect(() => {
    mounted.current = true;
    let cancelled = false;
    let initialLoaded = false;
    let refreshInFlight: Promise<void> | null = null;
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
          if (!cancelled)
            setWarning(`Viewport state is unavailable: ${cause instanceof Error ? cause.message : String(cause)}`);
        }
        viewport = coerceViewport(readViewportCookie(loaded.canvas.id) ?? serverState?.userViewport);
      }
      if (installRegistry(registry)) {
        setState({ mode: 'canvas', ...loaded, initialViewport: viewport });
      }
    }

    async function refresh() {
      const generation = readGeneration.current;
      if (indexMode) {
        const [canvases, configuration] = await Promise.all([fetchCanvasList(), fetchAgentCanvasConfiguration()]);
        if (!cancelled && generation === readGeneration.current) setState({ mode: 'index', canvases, configuration });
        return;
      }
      const loaded = await fetchCanvasFromLocation();
      if (cancelled || generation !== readGeneration.current) return;
      setState((current) => {
        if (!current || current.mode !== 'canvas') return current;
        if (current.canvas.id !== loaded.canvas.id || loaded.canvas.revision < current.canvas.revision) return current;
        const canvas = current.canvas.revision === loaded.canvas.revision ? current.canvas : loaded.canvas;
        const elementRuntime =
          JSON.stringify(current.elementRuntime) === JSON.stringify(loaded.elementRuntime)
            ? current.elementRuntime
            : loaded.elementRuntime;
        const diagnostics =
          JSON.stringify(current.diagnostics) === JSON.stringify(loaded.diagnostics)
            ? current.diagnostics
            : loaded.diagnostics;
        const embedSession =
          JSON.stringify(current.embedSession) === JSON.stringify(loaded.embedSession)
            ? current.embedSession
            : loaded.embedSession;
        return { ...current, ...loaded, canvas, elementRuntime, diagnostics, embedSession };
      });
      setWarning((current) => (current?.startsWith('Canvas refresh failed:') ? null : current));
    }

    function poll(): Promise<void> {
      if (cancelled || !initialLoaded) return Promise.resolve();
      if (!refreshInFlight)
        refreshInFlight = refresh().finally(() => {
          refreshInFlight = null;
        });
      return refreshInFlight;
    }
    refreshAfterMutation.current = async () => {
      // A mutation invalidates an earlier poll; wait for it before requesting the committed projection.
      await refreshInFlight?.catch(() => {});
      await poll();
    };
    loadInitial()
      .then(() => {
        initialLoaded = true;
      })
      .catch((cause) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
      });
    const timer = window.setInterval(
      () =>
        void poll().catch((cause) => {
          if (cancelled) return;
          const message = `Canvas refresh failed: ${cause instanceof Error ? cause.message : String(cause)}`;
          if (embedMode) setError(message);
          else setWarning(message);
        }),
      indexMode ? 5_000 : 1_500
    );
    return () => {
      cancelled = true;
      mounted.current = false;
      readGeneration.current += 1;
      window.clearInterval(timer);
      void activeRegistry?.dispose();
    };
  }, []);

  const session = state?.mode === 'canvas' ? state.embedSession : undefined;
  const canvasId = state?.mode === 'canvas' ? state.canvas.id : undefined;
  const canvasRevision = state?.mode === 'canvas' ? state.canvas.revision : undefined;
  const canvasUpdatedAt = state?.mode === 'canvas' ? state.canvas.updatedAt : undefined;
  const canvasReadOnly = state?.mode === 'canvas' ? state.readOnly : undefined;

  useEffect(() => {
    if (!session || !canvasId) return;
    postEmbedMessage(session, 'ready', {
      canvasId: canvasId,
      canvasIds: session.canvasIds,
      mode: session.mode,
      readOnly: canvasReadOnly,
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
  }, [session, canvasId, canvasReadOnly]);

  useEffect(() => {
    if (!session || !canvasId) return;
    postEmbedMessage(session, 'canvas.updated', {
      canvasId: canvasId,
      revision: canvasRevision,
      updatedAt: canvasUpdatedAt
    });
  }, [session, canvasId, canvasRevision, canvasUpdatedAt]);

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
          onDefaultCanvasSizeChange={(defaultCanvasSize) => saveConfiguration({ defaultCanvasSize })}
          onDiagnosticsChange={(diagnostics) => saveConfiguration({ diagnostics })}
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
        readGeneration.current += 1;
        const canvas = await updateCanvasBounds(state.canvas.id, bounds, state.canvas.revision);
        installMutation({ canvas });
        refreshCommittedCanvas();
      }}
      onCanvasOperations={async (operations, expectedRevision) => {
        readGeneration.current += 1;
        const projection = await applyCanvasOperations(state.canvas.id, operations, expectedRevision);
        installMutation(projection);
        return projection.canvas;
      }}
      onMacroExecute={async (request: MacroServiceExecuteRequest) => {
        readGeneration.current += 1;
        const result = await executeMacro(request);
        installMutation({ canvas: result.canvas as CanvasDocument });
        refreshCommittedCanvas();
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
