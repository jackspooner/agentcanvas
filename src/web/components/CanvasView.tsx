import { AgentCanvasEditor, type EditorFrame, EditorToolbar, EditorViewportToolbar } from '@agentcanvas/editor';
import type { CanvasElement, JsonObject, PluginDiagnostic, RendererGeometryService } from '@agentcanvas/plugin-sdk';
import { DEFAULT_CANVAS_THEME, resolveElementFrame, resolveFrameAnchor } from '@agentcanvas/plugin-sdk';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CanvasOperation } from '../../contracts';
import type { MacroExecutionResult, MacroPlan, MacroServiceExecuteRequest } from '../../macros/types';
import { frameOperations } from '../canvas-operations';
import type { LoadedBrowserRegistry } from '../plugins/catalog';
import { DomRendererOverlayService } from '../plugins/overlays';
import { useCanvasCommands } from '../use-canvas-commands';
import { useCanvasHistory } from '../use-canvas-history';
import type { CanvasBounds, CanvasDocument, CanvasViewport, CanvasViewportState } from '../v2-types';
import { coerceViewport, DEFAULT_REPORTED_VIEWPORT_HEIGHT, DEFAULT_REPORTED_VIEWPORT_WIDTH } from '../viewport';
import { CanvasBoundsControl } from './CanvasBoundsControl';
import { MacroDrawer } from './MacroDrawer';
import { MacroGhostPreview } from './MacroGhostPreview';
import { PluginRendererSurface } from './PluginRendererSurface';

interface CanvasViewProps {
  canvas: CanvasDocument;
  elementRuntime: Readonly<Record<string, JsonObject>>;
  diagnostics: readonly PluginDiagnostic[];
  browserRegistry: LoadedBrowserRegistry;
  readOnly?: boolean;
  initialViewport?: CanvasViewport;
  loadViewport?: () => Promise<CanvasViewportState>;
  onViewportChange?: (viewport: CanvasViewport) => void;
  onCanvasOperations?: (operations: readonly CanvasOperation[], expectedRevision: number) => Promise<CanvasDocument>;
  onMacroExecute?: (request: MacroServiceExecuteRequest) => Promise<MacroExecutionResult>;
  onCanvasBoundsChange?: (bounds: CanvasBounds) => Promise<void> | void;
}

function reportedViewport(viewport: CanvasViewport): CanvasViewport {
  return {
    ...viewport,
    width: DEFAULT_REPORTED_VIEWPORT_WIDTH,
    height: DEFAULT_REPORTED_VIEWPORT_HEIGHT,
    source: 'user',
    updatedAt: viewport.updatedAt ?? new Date().toISOString()
  };
}

function sameSelection(current: readonly string[], next: readonly string[]): boolean {
  return current.length === next.length && current.every((id, index) => id === next[index]);
}

function sameFrames(current: ReadonlyMap<string, EditorFrame>, next: ReadonlyMap<string, EditorFrame>): boolean {
  if (current.size !== next.size) return false;
  for (const [id, frame] of current) {
    const candidate = next.get(id);
    if (
      !candidate ||
      frame.x !== candidate.x ||
      frame.y !== candidate.y ||
      frame.width !== candidate.width ||
      frame.height !== candidate.height
    ) {
      return false;
    }
  }
  return true;
}

export function CanvasView({
  canvas,
  elementRuntime,
  diagnostics,
  browserRegistry,
  readOnly = false,
  initialViewport,
  loadViewport,
  onViewportChange,
  onCanvasOperations,
  onMacroExecute,
  onCanvasBoundsChange
}: CanvasViewProps) {
  const theme = canvas.theme ?? DEFAULT_CANVAS_THEME;
  const [viewport, setViewport] = useState(() => coerceViewport(initialViewport));
  const [selectedIds, setSelectedIds] = useState<readonly string[]>([]);
  const [gridSnapEnabled, setGridSnapEnabled] = useState(true);
  const [topbarVisible, setTopbarVisible] = useState(true);
  const [transientFrames, setTransientFrames] = useState<ReadonlyMap<string, EditorFrame>>(() => new Map());
  const [runtimeDiagnostics, setRuntimeDiagnostics] = useState<PluginDiagnostic[]>([]);
  const [macroDrawerOpen, setMacroDrawerOpen] = useState(false);
  const [macroPlan, setMacroPlan] = useState<MacroPlan | null>(null);

  // Browser renderer failures describe one rendered canvas revision. A later canvas
  // mutation may replace the failing element, so retaining the old report is misleading.
  // biome-ignore lint/correctness/useExhaustiveDependencies: Diagnostics belong to one canvas revision.
  useEffect(() => {
    setRuntimeDiagnostics([]);
  }, [canvas.id, canvas.revision]);
  const [moveError, setMoveError] = useState<string | null>(null);
  const [viewportError, setViewportError] = useState<string | null>(null);
  const viewportNode = useRef<HTMLDivElement | null>(null);
  const autoFittedCanvas = useRef<string | null>(null);
  const lastAgentViewport = useRef<string | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: These transient UI values belong to one canvas identity.
  useEffect(() => {
    setMacroPlan(null);
    setMacroDrawerOpen(false);
    setTransientFrames(new Map());
    setMoveError(null);
    setViewportError(null);
    lastAgentViewport.current = null;
    autoFittedCanvas.current = null;
  }, [canvas.id]);
  const history = useCanvasHistory({ canvas, readOnly, onCanvasOperations, onMacroExecute });
  const { commitHistory } = history;
  const overlays = useMemo(() => new DomRendererOverlayService(), []);
  const elements = useMemo(() => new Map(canvas.elements.map((element) => [element.id, element])), [canvas.elements]);
  const geometry: RendererGeometryService = useMemo(
    () => ({
      getElementFrame(elementId) {
        const transient = transientFrames.get(elementId);
        if (transient) return transient;
        const element = elements.get(elementId);
        if (!element) return null;
        return resolveElementFrame(element);
      },
      resolveAnchor(elementId, anchor) {
        const frame = this.getElementFrame(elementId);
        if (!frame) return null;
        return resolveFrameAnchor(frame, anchor);
      }
    }),
    [elements, transientFrames]
  );
  const fixedBounds = canvas.bounds.mode === 'fixed' ? canvas.bounds : null;

  const reportDiagnostic = useCallback((diagnostic: PluginDiagnostic) => {
    setRuntimeDiagnostics((current) => [
      ...current.filter((item) => item.elementId !== diagnostic.elementId || item.code !== diagnostic.code),
      diagnostic
    ]);
  }, []);
  const rendererFor = useCallback(
    (element: CanvasElement) => browserRegistry.renderers.get(element.type),
    [browserRegistry.renderers]
  );
  const nodeElements = useMemo(
    () => canvas.elements.filter((element) => (rendererFor(element)?.placement ?? 'node') === 'node'),
    [canvas.elements, rendererFor]
  );
  const worldUnderlays = useMemo(
    () => canvas.elements.filter((element) => rendererFor(element)?.placement === 'world-underlay'),
    [canvas.elements, rendererFor]
  );
  const worldOverlays = useMemo(
    () => canvas.elements.filter((element) => rendererFor(element)?.placement === 'world-overlay'),
    [canvas.elements, rendererFor]
  );
  const resetViewport = useCallback(() => {
    setViewport((value) => coerceViewport({ ...value, centerX: 0, centerY: 0, zoom: 1 }));
  }, []);

  const fitCanvas = useCallback(() => {
    const width = viewportNode.current?.clientWidth || DEFAULT_REPORTED_VIEWPORT_WIDTH;
    const height = viewportNode.current?.clientHeight || DEFAULT_REPORTED_VIEWPORT_HEIGHT;
    if (fixedBounds) {
      setViewport((current) =>
        coerceViewport({
          ...current,
          centerX: fixedBounds.width / 2,
          centerY: fixedBounds.height / 2,
          zoom: Math.min(width / fixedBounds.width, height / fixedBounds.height) * 0.9
        })
      );
      return;
    }
    if (nodeElements.length === 0) {
      resetViewport();
      return;
    }
    const frames = nodeElements.map(resolveElementFrame);
    const left = Math.min(...frames.map((frame) => frame.x));
    const top = Math.min(...frames.map((frame) => frame.y));
    const right = Math.max(...frames.map((frame) => frame.x + frame.width));
    const bottom = Math.max(...frames.map((frame) => frame.y + frame.height));
    const contentWidth = Math.max(1, right - left);
    const contentHeight = Math.max(1, bottom - top);
    setViewport((current) =>
      coerceViewport({
        ...current,
        centerX: left + contentWidth / 2,
        centerY: top + contentHeight / 2,
        zoom: Math.min(width / contentWidth, height / contentHeight) * 0.85
      })
    );
  }, [fixedBounds, nodeElements, resetViewport]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: Reset on canvas identity even with the same initial viewport.
  useEffect(() => setViewport(coerceViewport(initialViewport)), [canvas.id, initialViewport]);
  useEffect(() => {
    const source = initialViewport?.source ?? 'default';
    if (canvas.id === 'empty' || source !== 'default' || autoFittedCanvas.current === canvas.id) return undefined;
    if (!fixedBounds && nodeElements.length === 0) return undefined;
    autoFittedCanvas.current = canvas.id;
    const animationFrame = window.requestAnimationFrame(() => fitCanvas());
    return () => window.cancelAnimationFrame(animationFrame);
  }, [canvas.id, fixedBounds, initialViewport?.source, nodeElements, fitCanvas]);
  useEffect(() => {
    if (!onViewportChange || canvas.id === 'empty') return undefined;
    const timer = window.setTimeout(() => onViewportChange(reportedViewport(viewport)), 250);
    return () => window.clearTimeout(timer);
  }, [canvas.id, onViewportChange, viewport]);
  useEffect(() => {
    if (!loadViewport || canvas.id === 'empty') return undefined;
    const timer = window.setInterval(() => {
      void loadViewport()
        .then((state) => {
          const agent = state.agentViewport;
          if (agent?.updatedAt && agent.updatedAt !== lastAgentViewport.current) {
            lastAgentViewport.current = agent.updatedAt;
            setViewport(coerceViewport(agent));
          }
        })
        .catch((error) => {
          setViewportError(`Viewport polling failed: ${error instanceof Error ? error.message : String(error)}`);
        });
    }, 1_000);
    return () => window.clearInterval(timer);
  }, [canvas.id, loadViewport]);

  const { commands, handleCommandKeyDown, executeRendererCommand } = useCanvasCommands({
    canvas,
    selectedIds,
    readOnly,
    viewport,
    nodeElements,
    browserRegistry,
    overlays,
    history,
    viewportNode,
    setSelectedIds,
    setViewport,
    setGridSnapEnabled,
    fitCanvas,
    resetViewport,
    reportDiagnostic,
    setMoveError
  });

  function renderWorldElements(worldElements: readonly CanvasElement[]) {
    return worldElements.map((element) => (
      <div
        key={`${element.id}:${element.type}`}
        className="plugin-world-element"
        data-element-id={element.id}
        style={{ zIndex: element.zIndex ?? 0 }}
      >
        <PluginRendererSurface
          canvasId={canvas.id}
          canvasRevision={canvas.revision}
          element={element}
          executeCommand={(id, input, signal) => executeRendererCommand(canvas.id, element, id, input, signal)}
          runtime={elementRuntime[element.id] ?? null}
          renderer={rendererFor(element)}
          geometry={geometry}
          overlays={overlays}
          readOnly={readOnly}
          selected={selectedIds.includes(element.id)}
          theme={theme}
          reportDiagnostic={reportDiagnostic}
        />
      </div>
    ));
  }

  const visibleDiagnostics = [
    ...diagnostics,
    ...runtimeDiagnostics,
    ...(viewportError
      ? [{ code: 'viewport_poll_failed', severity: 'warning' as const, message: viewportError, retryable: true }]
      : [])
  ];
  const diagnosticCounts = visibleDiagnostics.reduce(
    (counts, diagnostic) => ({ ...counts, [diagnostic.severity]: counts[diagnostic.severity] + 1 }),
    { error: 0, warning: 0, info: 0 }
  );
  const diagnosticSummary = [
    diagnosticCounts.error ? `${diagnosticCounts.error} error${diagnosticCounts.error === 1 ? '' : 's'}` : '',
    diagnosticCounts.warning ? `${diagnosticCounts.warning} warning${diagnosticCounts.warning === 1 ? '' : 's'}` : '',
    diagnosticCounts.info ? `${diagnosticCounts.info} notice${diagnosticCounts.info === 1 ? '' : 's'}` : ''
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: Delegates descendant shortcuts; editable and Shadow DOM controls are excluded.
    <div className="canvas-shell" onKeyDown={handleCommandKeyDown}>
      <header className="topbar" id="canvas-topbar" hidden={!topbarVisible}>
        <div className="topbar-title">
          <strong>{canvas.title}</strong>
          <span>revision {canvas.revision}</span>
          <span className="badge">{readOnly ? 'read-only' : 'extension canvas'}</span>
          {selectedIds.length > 0 && <span>{selectedIds.length} selected</span>}
          <CanvasBoundsControl bounds={canvas.bounds} readOnly={readOnly} onChange={onCanvasBoundsChange} />
        </div>
        <div className="topbar-controls">
          {!readOnly && (
            <button
              type="button"
              className="macro-trigger"
              aria-expanded={macroDrawerOpen}
              aria-controls="macro-drawer"
              onClick={() => setMacroDrawerOpen((value) => !value)}
            >
              Macros
            </button>
          )}
          <EditorToolbar
            commands={commands}
            onCommandError={(error) => setMoveError(error instanceof Error ? error.message : String(error))}
          />
          <div className="viewport-status">
            center {Math.round(viewport.centerX)}, {Math.round(viewport.centerY)} · zoom{' '}
            {Math.round(viewport.zoom * 100)}%
          </div>
          <EditorViewportToolbar
            commands={commands}
            gridSnapEnabled={gridSnapEnabled}
            onCommandError={(error) => setMoveError(error instanceof Error ? error.message : String(error))}
          />
          <button
            type="button"
            className="topbar-toggle"
            aria-expanded={topbarVisible}
            aria-controls="canvas-topbar"
            onClick={() => setTopbarVisible(false)}
          >
            Hide top bar
          </button>
        </div>
      </header>
      {!topbarVisible && (
        <button
          type="button"
          className="topbar-toggle topbar-restore"
          aria-expanded={topbarVisible}
          aria-controls="canvas-topbar"
          onClick={() => setTopbarVisible(true)}
        >
          Show top bar
        </button>
      )}
      {moveError && <div className="node-move-error">{moveError}</div>}
      {visibleDiagnostics.length > 0 && (
        <details className="plugin-diagnostics">
          <summary aria-live="polite">
            <span className="diagnostic-signal">Canvas diagnostics</span>
            <span>{diagnosticSummary}</span>
          </summary>
          <div className="diagnostic-list">
            {visibleDiagnostics.map((diagnostic, index) => (
              <div
                key={`${diagnostic.code}-${diagnostic.elementId ?? diagnostic.pluginId ?? index}`}
                className={`diagnostic-item diagnostic-${diagnostic.severity}`}
              >
                <code>{diagnostic.code}</code>
                <span>{diagnostic.message}</span>
              </div>
            ))}
          </div>
        </details>
      )}
      <main ref={viewportNode} className="canvas-viewport">
        <AgentCanvasEditor
          elements={nodeElements}
          bounds={canvas.bounds}
          viewport={viewport}
          selectedElementIds={selectedIds}
          readOnly={readOnly}
          snapToGrid={gridSnapEnabled}
          backgroundColor={canvas.background?.color ?? theme.colors.canvas}
          gridColor={theme.colors.border}
          showGrid={canvas.background?.grid !== false}
          renderElement={({ element, selected }) => (
            <PluginRendererSurface
              canvasId={canvas.id}
              canvasRevision={canvas.revision}
              element={element}
              executeCommand={(id, input, signal) => executeRendererCommand(canvas.id, element, id, input, signal)}
              runtime={elementRuntime[element.id] ?? null}
              renderer={rendererFor(element)}
              geometry={geometry}
              overlays={overlays}
              readOnly={readOnly}
              selected={selected}
              theme={theme}
              reportDiagnostic={reportDiagnostic}
            />
          )}
          worldUnderlay={renderWorldElements(worldUnderlays)}
          worldOverlay={
            <>
              {renderWorldElements(worldOverlays)}
              <MacroGhostPreview
                elements={macroPlan?.canvasRevision === canvas.revision ? macroPlan.previewElements : []}
                renderElement={(element) => (
                  <PluginRendererSurface
                    canvasId={canvas.id}
                    canvasRevision={canvas.revision}
                    element={element}
                    runtime={elementRuntime[element.id] ?? null}
                    renderer={rendererFor(element)}
                    geometry={geometry}
                    overlays={overlays}
                    readOnly
                    selected={false}
                    theme={theme}
                    reportDiagnostic={reportDiagnostic}
                  />
                )}
              />
            </>
          }
          onViewportChange={(next) =>
            setViewport((current) => {
              if (current.centerX === next.centerX && current.centerY === next.centerY && current.zoom === next.zoom) {
                return current;
              }
              return coerceViewport({ ...current, ...next });
            })
          }
          onSelectionChange={(next) => setSelectedIds((current) => (sameSelection(current, next) ? current : next))}
          onTransientFramesChange={(next) =>
            setTransientFrames((current) => (sameFrames(current, next) ? current : next))
          }
          onFrameCommit={async (changes) => {
            setMoveError(null);
            const { forward, inverse } = frameOperations(changes);
            await commitHistory(
              changes.length === 1 ? 'Change element frame' : `Change ${changes.length} element frames`,
              forward,
              inverse,
              changes.map((change) => change.elementId)
            );
          }}
          onCommitError={(error) => setMoveError(error instanceof Error ? error.message : String(error))}
        />
      </main>
      {!readOnly && (
        <MacroDrawer
          canvasId={canvas.id}
          canvasRevision={canvas.revision}
          viewport={viewport}
          selectionInvalidationToken={selectedIds.join('\u001f')}
          open={macroDrawerOpen}
          onClose={() => setMacroDrawerOpen(false)}
          onPlanChange={setMacroPlan}
          onExecute={async (plan) => {
            await history.runMacro(plan);
            setMacroPlan(null);
          }}
        />
      )}
    </div>
  );
}
