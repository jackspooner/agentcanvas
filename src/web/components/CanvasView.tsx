import type {
  BrowserElementRenderer,
  CanvasElement,
  JsonObject,
  PluginDiagnostic,
  RendererGeometryService
} from '@agentcanvas/plugin-sdk';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { LoadedBrowserRegistry } from '../plugins/catalog';
import { isPluginInteractiveEvent } from '../plugins/interaction';
import { DomRendererOverlayService } from '../plugins/overlays';
import { ShadowRendererHost, type RendererContextInput } from '../plugins/renderer-host';
import type { CanvasBounds, CanvasDocument, CanvasViewport, CanvasViewportState } from '../v2-types';
import { coerceViewport, DEFAULT_REPORTED_VIEWPORT_HEIGHT, DEFAULT_REPORTED_VIEWPORT_WIDTH } from '../viewport';
import { CanvasBoundsControl } from './CanvasBoundsControl';

interface CanvasViewProps {
  canvas: CanvasDocument;
  elementRuntime: Readonly<Record<string, JsonObject>>;
  diagnostics: readonly PluginDiagnostic[];
  browserRegistry: LoadedBrowserRegistry;
  readOnly?: boolean;
  initialViewport?: CanvasViewport;
  loadViewport?: () => Promise<CanvasViewportState>;
  onViewportChange?: (viewport: CanvasViewport) => void;
  onElementMove?: (elementId: string, x: number, y: number) => Promise<void> | void;
  onCanvasBoundsChange?: (bounds: CanvasBounds) => Promise<void> | void;
}

interface PluginFrameProps {
  element: CanvasElement;
  runtime: JsonObject | null;
  renderer: BrowserElementRenderer | undefined;
  geometry: RendererGeometryService;
  overlays: DomRendererOverlayService;
  readOnly: boolean;
  selected: boolean;
  position?: { x: number; y: number };
  reportDiagnostic(diagnostic: PluginDiagnostic): void;
  onSelect(): void;
  onDragStart(event: React.PointerEvent<HTMLButtonElement>): void;
  onDragMove(event: React.PointerEvent<HTMLButtonElement>): void;
  onDragEnd(event: React.PointerEvent<HTMLButtonElement>): void;
}

const THEME = Object.freeze({
  '--agentcanvas-foreground': '#0f172a',
  '--agentcanvas-background': '#ffffff',
  '--agentcanvas-border': '#cbd5e1',
  '--agentcanvas-accent': '#2563eb'
});

function PluginFrame(props: PluginFrameProps) {
  const outer = useRef<HTMLDivElement | null>(null);
  const host = useRef<ShadowRendererHost | null>(null);
  const context: RendererContextInput = useMemo(
    () => ({
      element: props.element,
      runtime: props.runtime,
      readOnly: props.readOnly,
      selected: props.selected,
      theme: THEME,
      geometry: props.geometry,
      overlays: props.overlays,
      reportDiagnostic: props.reportDiagnostic
    }),
    [
      props.element,
      props.geometry,
      props.overlays,
      props.readOnly,
      props.reportDiagnostic,
      props.runtime,
      props.selected
    ]
  );

  useEffect(() => {
    if (!outer.current) return undefined;
    const rendererHost = new ShadowRendererHost(outer.current, { reportDiagnostic: props.reportDiagnostic });
    host.current = rendererHost;
    void rendererHost.mount(props.renderer, context);
    return () => {
      host.current = null;
      void rendererHost.dispose();
    };
  }, [props.element.id, props.element.type, props.renderer]);

  useEffect(() => {
    void host.current?.update(context);
  }, [context]);

  const placement = props.renderer?.placement ?? 'node';
  const x = props.position?.x ?? props.element.x;
  const y = props.position?.y ?? props.element.y;
  const world = placement !== 'node';
  const style: React.CSSProperties = world
    ? {
        position: 'absolute',
        inset: 0,
        width: 1,
        height: 1,
        overflow: 'visible',
        zIndex: props.element.zIndex ?? (placement === 'world-underlay' ? -1 : 10_000),
        pointerEvents: 'none'
      }
    : {
        position: 'absolute',
        left: x,
        top: y,
        width: props.element.width ?? 240,
        height: props.element.height ?? 120,
        zIndex: props.element.zIndex ?? 0,
        transform: `rotate(${props.element.rotation ?? 0}deg)`,
        transformOrigin: 'center',
        opacity: props.element.opacity ?? 1
      };
  return (
    <div
      className={`plugin-element-frame placement-${placement}${props.selected ? ' is-selected' : ''}`}
      style={style}
      data-element-id={props.element.id}
      onPointerDown={(event) => {
        if (!isPluginInteractiveEvent(event.nativeEvent)) props.onSelect();
      }}
    >
      <div ref={outer} className="plugin-renderer-surface" />
      {!world && !props.readOnly && !props.element.locked && (
        <button
          type="button"
          className="plugin-frame-drag-handle"
          aria-label={`Move ${props.element.id}`}
          onPointerDown={props.onDragStart}
          onPointerMove={props.onDragMove}
          onPointerUp={props.onDragEnd}
          onPointerCancel={props.onDragEnd}
        >
          {props.element.id}
        </button>
      )}
    </div>
  );
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

export function CanvasView({
  canvas,
  elementRuntime,
  diagnostics,
  browserRegistry,
  readOnly = false,
  initialViewport,
  loadViewport,
  onViewportChange,
  onElementMove,
  onCanvasBoundsChange
}: CanvasViewProps) {
  const [viewport, setViewport] = useState(() => coerceViewport(initialViewport));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [positionOverrides, setPositionOverrides] = useState<Record<string, { x: number; y: number }>>({});
  const [runtimeDiagnostics, setRuntimeDiagnostics] = useState<PluginDiagnostic[]>([]);
  const [moveError, setMoveError] = useState<string | null>(null);
  const [viewportError, setViewportError] = useState<string | null>(null);
  const viewportNode = useRef<HTMLDivElement | null>(null);
  const pan = useRef<{ pointerId: number; x: number; y: number; centerX: number; centerY: number } | null>(null);
  const drag = useRef<{
    elementId: string;
    pointerId: number;
    x: number;
    y: number;
    startX: number;
    startY: number;
    currentX: number;
    currentY: number;
    zoom: number;
  } | null>(null);
  const lastAgentViewport = useRef<string | null>(null);
  const overlays = useMemo(() => new DomRendererOverlayService(), []);
  const elements = useMemo(() => new Map(canvas.elements.map((element) => [element.id, element])), [canvas.elements]);
  const geometry: RendererGeometryService = useMemo(
    () => ({
      getElementFrame(elementId) {
        const element = elements.get(elementId);
        if (!element) return null;
        const position = positionOverrides[elementId] ?? element;
        return { x: position.x, y: position.y, width: element.width ?? 0, height: element.height ?? 0 };
      },
      resolveAnchor(elementId, anchor) {
        const frame = this.getElementFrame(elementId);
        if (!frame) return null;
        if (anchor === 'top') return { x: frame.x + frame.width / 2, y: frame.y };
        if (anchor === 'right') return { x: frame.x + frame.width, y: frame.y + frame.height / 2 };
        if (anchor === 'bottom') return { x: frame.x + frame.width / 2, y: frame.y + frame.height };
        if (anchor === 'left') return { x: frame.x, y: frame.y + frame.height / 2 };
        return { x: frame.x + frame.width / 2, y: frame.y + frame.height / 2 };
      }
    }),
    [elements, positionOverrides]
  );
  const fixedBounds = canvas.bounds.mode === 'fixed' ? canvas.bounds : null;
  const worldStyle: React.CSSProperties = {
    transform: `translate(${-viewport.centerX * viewport.zoom}px, ${-viewport.centerY * viewport.zoom}px) scale(${viewport.zoom})`,
    ...(fixedBounds
      ? { width: fixedBounds.width, height: fixedBounds.height, backgroundColor: canvas.background?.color ?? '#ffffff' }
      : {})
  };

  useEffect(() => setViewport(coerceViewport(initialViewport)), [canvas.id, initialViewport]);
  useEffect(() => {
    if (drag.current) return;
    setPositionOverrides({});
  }, [canvas.id, canvas.revision]);
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

  function fitCanvas() {
    if (!fixedBounds) return;
    const width = viewportNode.current?.clientWidth || DEFAULT_REPORTED_VIEWPORT_WIDTH;
    const height = viewportNode.current?.clientHeight || DEFAULT_REPORTED_VIEWPORT_HEIGHT;
    setViewport((current) =>
      coerceViewport({
        ...current,
        centerX: fixedBounds.width / 2,
        centerY: fixedBounds.height / 2,
        zoom: Math.min(width / fixedBounds.width, height / fixedBounds.height) * 0.9
      })
    );
  }

  function startElementDrag(element: CanvasElement, event: React.PointerEvent<HTMLButtonElement>) {
    if (readOnly || element.locked || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    const current = positionOverrides[element.id] ?? element;
    drag.current = {
      elementId: element.id,
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      startX: current.x,
      startY: current.y,
      currentX: current.x,
      currentY: current.y,
      zoom: viewport.zoom
    };
  }

  function moveElementDrag(event: React.PointerEvent<HTMLButtonElement>) {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    current.currentX = Math.round(current.startX + (event.clientX - current.x) / current.zoom);
    current.currentY = Math.round(current.startY + (event.clientY - current.y) / current.zoom);
    setPositionOverrides((positions) => ({
      ...positions,
      [current.elementId]: { x: current.currentX, y: current.currentY }
    }));
  }

  function endElementDrag(event: React.PointerEvent<HTMLButtonElement>) {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    drag.current = null;
    if (current.currentX === current.startX && current.currentY === current.startY) return;
    void Promise.resolve(onElementMove?.(current.elementId, current.currentX, current.currentY)).catch((error) => {
      setMoveError(error instanceof Error ? error.message : String(error));
      setPositionOverrides((positions) => {
        const next = { ...positions };
        delete next[current.elementId];
        return next;
      });
    });
  }

  const visibleDiagnostics = [
    ...diagnostics,
    ...runtimeDiagnostics,
    ...(viewportError
      ? [{ code: 'viewport_poll_failed', severity: 'warning' as const, message: viewportError, retryable: true }]
      : [])
  ];
  return (
    <div className="canvas-shell">
      <header className="topbar">
        <div className="topbar-title">
          <strong>{canvas.title}</strong>
          <span>revision {canvas.revision}</span>
          <span className="badge">{readOnly ? 'read-only' : 'plugin canvas'}</span>
          <CanvasBoundsControl bounds={canvas.bounds} readOnly={readOnly} onChange={onCanvasBoundsChange} />
        </div>
        <div className="viewport-status">
          center {Math.round(viewport.centerX)}, {Math.round(viewport.centerY)} · zoom {Math.round(viewport.zoom * 100)}
          %
        </div>
        <div className="zoom-controls">
          <button
            type="button"
            onClick={() => setViewport((value) => coerceViewport({ ...value, zoom: value.zoom / 1.2 }))}
          >
            −
          </button>
          <button
            type="button"
            onClick={() => setViewport((value) => coerceViewport({ ...value, centerX: 0, centerY: 0, zoom: 1 }))}
          >
            0,0
          </button>
          {fixedBounds && (
            <button type="button" onClick={fitCanvas}>
              Fit
            </button>
          )}
          <button
            type="button"
            onClick={() => setViewport((value) => coerceViewport({ ...value, zoom: value.zoom * 1.2 }))}
          >
            +
          </button>
        </div>
      </header>
      {(moveError || visibleDiagnostics.length > 0) && (
        <aside className="plugin-diagnostics" aria-live="polite">
          {moveError && <div className="node-move-error">{moveError}</div>}
          {visibleDiagnostics.slice(-5).map((diagnostic, index) => (
            <div
              key={`${diagnostic.code}-${diagnostic.elementId ?? diagnostic.pluginId ?? index}`}
              className={`diagnostic-${diagnostic.severity}`}
            >
              {diagnostic.message}
            </div>
          ))}
        </aside>
      )}
      <main
        ref={viewportNode}
        className="canvas-viewport"
        onPointerDown={(event) => {
          if (event.button !== 0 || isPluginInteractiveEvent(event.nativeEvent)) return;
          event.currentTarget.setPointerCapture?.(event.pointerId);
          pan.current = {
            pointerId: event.pointerId,
            x: event.clientX,
            y: event.clientY,
            centerX: viewport.centerX,
            centerY: viewport.centerY
          };
        }}
        onPointerMove={(event) => {
          const current = pan.current;
          if (!current || current.pointerId !== event.pointerId) return;
          setViewport((value) =>
            coerceViewport({
              ...value,
              centerX: current.centerX - (event.clientX - current.x) / value.zoom,
              centerY: current.centerY - (event.clientY - current.y) / value.zoom
            })
          );
        }}
        onPointerUp={() => {
          pan.current = null;
        }}
        onPointerCancel={() => {
          pan.current = null;
        }}
        onWheel={(event) => {
          if (isPluginInteractiveEvent(event.nativeEvent)) return;
          event.preventDefault();
          setViewport((value) => coerceViewport({ ...value, zoom: value.zoom * (event.deltaY < 0 ? 1.12 : 1 / 1.12) }));
        }}
      >
        <div className="viewport-origin">
          <div className={`world-layer${fixedBounds ? ' has-fixed-bounds' : ''}`} style={worldStyle}>
            <div className="origin-axis origin-axis-x" />
            <div className="origin-axis origin-axis-y" />
            <div className="origin-marker">0,0</div>
            {canvas.elements.map((element) => (
              <PluginFrame
                key={`${element.id}:${element.type}`}
                element={element}
                runtime={elementRuntime[element.id] ?? null}
                renderer={browserRegistry.renderers.get(element.type)}
                geometry={geometry}
                overlays={overlays}
                readOnly={readOnly}
                selected={selectedId === element.id}
                position={positionOverrides[element.id]}
                reportDiagnostic={(diagnostic) =>
                  setRuntimeDiagnostics((current) => [
                    ...current.filter(
                      (item) => item.elementId !== diagnostic.elementId || item.code !== diagnostic.code
                    ),
                    diagnostic
                  ])
                }
                onSelect={() => setSelectedId(element.id)}
                onDragStart={(event) => startElementDrag(element, event)}
                onDragMove={moveElementDrag}
                onDragEnd={endElementDrag}
              />
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}
