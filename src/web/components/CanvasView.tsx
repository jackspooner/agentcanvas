import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  AssetDetailsResponse,
  AssetElement,
  CanvasElement,
  CanvasRecord,
  CanvasViewport,
  CanvasViewportState
} from '../../contracts';
import { fetchAssetDetails } from '../api';
import { coerceViewport, DEFAULT_REPORTED_VIEWPORT_HEIGHT, DEFAULT_REPORTED_VIEWPORT_WIDTH } from '../viewport';
import { AssetDetailsDialog } from './AssetDetailsDialog';
import {
  AssetCard,
  BBoxOverlayCard,
  type CardPointerHandlers,
  type CardProps,
  DragHandle,
  GlbViewerCard,
  PathOverlayCard,
  VideoCard,
  elementStyle,
  eventStartedInEmbeddedMedia,
  eventStartedInInteractiveControl,
  isMovableElement,
  trySetPointerCapture
} from './CanvasCards';
import { MarkdownBlock } from './MarkdownBlock';

interface CanvasViewProps {
  canvas: CanvasRecord;
  readOnly?: boolean;
  initialViewport?: CanvasViewport;
  loadViewport?: () => Promise<CanvasViewportState>;
  onViewportChange?: (viewport: CanvasViewport) => void;
  onElementMove?: (elementId: string, x: number, y: number) => Promise<void> | void;
}

function reportedViewport(viewport: CanvasViewport, source: 'user' | 'agent' | 'default' = 'user'): CanvasViewport {
  return {
    ...viewport,
    width: DEFAULT_REPORTED_VIEWPORT_WIDTH,
    height: DEFAULT_REPORTED_VIEWPORT_HEIGHT,
    source,
    updatedAt: viewport.updatedAt ?? new Date().toISOString()
  };
}

export function CanvasView({
  canvas,
  readOnly = false,
  initialViewport,
  loadViewport,
  onViewportChange,
  onElementMove
}: CanvasViewProps) {
  const [viewport, setViewport] = useState<CanvasViewport>(() => coerceViewport(initialViewport));
  const [isDragging, setIsDragging] = useState(false);
  const [movingElementId, setMovingElementId] = useState<string | null>(null);
  const [positionOverrides, setPositionOverrides] = useState<Record<string, { x: number; y: number }>>({});
  const [moveError, setMoveError] = useState<string | null>(null);
  const [assetDetails, setAssetDetails] = useState<{
    open: boolean;
    loading: boolean;
    error: string | null;
    details: AssetDetailsResponse | null;
  }>({
    open: false,
    loading: false,
    error: null,
    details: null
  });
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ x: number; y: number; centerX: number; centerY: number } | null>(null);
  const nodeDragRef = useRef<{
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
  const lastAgentViewport = useRef<string | null>(
    initialViewport?.source === 'agent' ? initialViewport.updatedAt : null
  );
  const connectors = canvas.elements.filter((el) => el.type === 'line' || el.type === 'arrow');
  const cards = canvas.elements.filter((el) => el.type !== 'line' && el.type !== 'arrow');

  const worldTransform = useMemo(
    () => ({
      transform: `translate(${-viewport.centerX * viewport.zoom}px, ${-viewport.centerY * viewport.zoom}px) scale(${viewport.zoom})`
    }),
    [viewport.centerX, viewport.centerY, viewport.zoom]
  );

  useEffect(() => {
    setViewport(coerceViewport(initialViewport));
  }, [canvas.id, initialViewport]);

  useEffect(() => {
    if (nodeDragRef.current) return;
    setPositionOverrides({});
    setMovingElementId(null);
  }, [canvas.id, canvas.revision]);

  useEffect(() => {
    if (!onViewportChange || canvas.id === 'empty') return undefined;
    const timer = window.setTimeout(() => onViewportChange(reportedViewport(viewport, 'user')), 250);
    return () => window.clearTimeout(timer);
  }, [canvas.id, onViewportChange, viewport.centerX, viewport.centerY, viewport.zoom]);

  useEffect(() => {
    if (!loadViewport || canvas.id === 'empty') return undefined;
    const timer = window.setInterval(async () => {
      try {
        const state = await loadViewport();
        const agent = state.agentViewport;
        if (agent?.updatedAt && agent.updatedAt !== lastAgentViewport.current) {
          lastAgentViewport.current = agent.updatedAt;
          setViewport(coerceViewport(agent));
        }
      } catch {
        // Best-effort polling: do not interrupt canvas viewing if the service is briefly unavailable.
      }
    }, 1000);
    return () => window.clearInterval(timer);
  }, [canvas.id, loadViewport]);

  function zoomBy(factor: number) {
    setViewport((current) => coerceViewport({ ...current, zoom: current.zoom * factor }));
  }

  function centerAtOrigin() {
    setViewport((current) => coerceViewport({ ...current, centerX: 0, centerY: 0, zoom: 1 }));
  }

  const closeAssetDetails = useCallback(() => {
    setAssetDetails((current) => ({ ...current, open: false }));
  }, []);

  const openAssetDetails = useCallback(async (element: AssetElement) => {
    setAssetDetails({ open: true, loading: true, error: null, details: null });
    try {
      const details = await fetchAssetDetails(element.assetRef);
      setAssetDetails({ open: true, loading: false, error: null, details });
    } catch (error) {
      setAssetDetails({
        open: true,
        loading: false,
        error: error instanceof Error ? error.message : String(error),
        details: null
      });
    }
  }, []);

  useEffect(() => {
    const node = viewportRef.current;
    if (!node) return undefined;

    const handleWheel = (event: WheelEvent) => {
      if (eventStartedInEmbeddedMedia(event)) return;
      event.preventDefault();
      setViewport((current) =>
        coerceViewport({
          ...current,
          zoom: current.zoom * (event.deltaY < 0 ? 1.12 : 1 / 1.12)
        })
      );
    };

    node.addEventListener('wheel', handleWheel, { passive: false });
    return () => node.removeEventListener('wheel', handleWheel);
  }, []);

  function onPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    if (eventStartedInEmbeddedMedia(event)) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    dragRef.current = { x: event.clientX, y: event.clientY, centerX: viewport.centerX, centerY: viewport.centerY };
    setIsDragging(true);
  }

  function onPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const dragState = dragRef.current;
    if (!dragState) return;
    const dx = event.clientX - dragState.x;
    const dy = event.clientY - dragState.y;
    setViewport((current) =>
      coerceViewport({
        ...current,
        centerX: dragState.centerX - dx / current.zoom,
        centerY: dragState.centerY - dy / current.zoom
      })
    );
  }

  function onPointerEnd() {
    dragRef.current = null;
    setIsDragging(false);
  }

  function elementWithPositionOverride<T extends CanvasElement>(element: T): T {
    const override = positionOverrides[element.id];
    return override ? ({ ...element, ...override } as T) : element;
  }

  function startElementDrag(element: CanvasElement, event: React.PointerEvent<HTMLElement>) {
    if (!isMovableElement(element, readOnly)) return;
    if (event.button !== 0) return;
    if (
      eventStartedInInteractiveControl(event) &&
      !(event.target instanceof Element && event.target.closest('.node-drag-handle'))
    )
      return;
    if (eventStartedInEmbeddedMedia(event)) return;
    event.preventDefault();
    event.stopPropagation();
    trySetPointerCapture(event.currentTarget, event.pointerId);
    const current = elementWithPositionOverride(element);
    nodeDragRef.current = {
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
    setMovingElementId(element.id);
    setMoveError(null);
  }

  function moveElementDrag(event: React.PointerEvent<HTMLElement>) {
    const dragState = nodeDragRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    const nextX = Math.round(dragState.startX + (event.clientX - dragState.x) / dragState.zoom);
    const nextY = Math.round(dragState.startY + (event.clientY - dragState.y) / dragState.zoom);
    dragState.currentX = nextX;
    dragState.currentY = nextY;
    setPositionOverrides((current) => ({ ...current, [dragState.elementId]: { x: nextX, y: nextY } }));
  }

  function endElementDrag(event: React.PointerEvent<HTMLElement>) {
    const dragState = nodeDragRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    const finalPosition = { x: dragState.currentX, y: dragState.currentY };
    nodeDragRef.current = null;
    setMovingElementId(null);
    const changed = finalPosition.x !== dragState.startX || finalPosition.y !== dragState.startY;
    if (!changed || !onElementMove) {
      if (!changed)
        setPositionOverrides((current) => {
          const next = { ...current };
          delete next[dragState.elementId];
          return next;
        });
      return;
    }
    Promise.resolve(onElementMove(dragState.elementId, finalPosition.x, finalPosition.y)).catch((error) => {
      setMoveError(error instanceof Error ? error.message : String(error));
      setPositionOverrides((current) => {
        const next = { ...current };
        delete next[dragState.elementId];
        return next;
      });
    });
  }

  function cardProps(element: CanvasElement): CardProps {
    const movable = isMovableElement(element, readOnly);
    return {
      style: elementStyle(elementWithPositionOverride(element)),
      isMovable: movable,
      handlers: movable
        ? {
            onPointerDown: (event) => startElementDrag(element, event),
            onPointerMove: moveElementDrag,
            onPointerUp: endElementDrag,
            onPointerCancel: endElementDrag
          }
        : {}
    };
  }

  return (
    <div className="canvas-shell">
      <header className="topbar">
        <div className="topbar-title">
          <strong>{canvas.title}</strong>
          <span>revision {canvas.revision}</span>
          {readOnly ? <span className="badge">read-only</span> : <span className="badge">drag nodes to move</span>}
          {movingElementId && <span className="badge moving-badge">moving {movingElementId}</span>}
        </div>
        <div className="viewport-status" aria-label="Viewport center">
          center {Math.round(viewport.centerX)}, {Math.round(viewport.centerY)} · zoom {Math.round(viewport.zoom * 100)}
          %
        </div>
        <div className="zoom-controls">
          <button type="button" onClick={() => zoomBy(1 / 1.2)} aria-label="Zoom out">
            −
          </button>
          <button type="button" onClick={centerAtOrigin}>
            0,0
          </button>
          <button type="button" onClick={() => zoomBy(1.2)} aria-label="Zoom in">
            +
          </button>
        </div>
      </header>
      {moveError && (
        <div className="node-move-error" role="alert">
          Could not move node: {moveError}
        </div>
      )}
      <main
        ref={viewportRef}
        className={`canvas-viewport ${isDragging ? 'is-dragging' : ''}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
      >
        <div className="viewport-origin">
          <div className="world-layer" style={worldTransform}>
            <div className="origin-axis origin-axis-x" />
            <div className="origin-axis origin-axis-y" />
            <div className="origin-marker">0,0</div>
            <svg className="connector-layer" width="1" height="1">
              <defs>
                <marker id="arrowhead" markerWidth="10" markerHeight="7" refX="10" refY="3.5" orient="auto">
                  <polygon points="0 0, 10 3.5, 0 7" fill="#2563eb" />
                </marker>
              </defs>
              {connectors.map((el) => {
                if (el.type !== 'line' && el.type !== 'arrow') return null;
                const x1 = el.from.x ?? 0;
                const y1 = el.from.y ?? 0;
                const x2 = el.to.x ?? 100;
                const y2 = el.to.y ?? 100;
                return (
                  <line
                    key={el.id}
                    x1={x1}
                    y1={y1}
                    x2={x2}
                    y2={y2}
                    stroke={el.stroke ?? '#2563eb'}
                    strokeWidth={el.strokeWidth ?? 2}
                    markerEnd={el.type === 'arrow' ? 'url(#arrowhead)' : undefined}
                  />
                );
              })}
            </svg>
            {cards.map((el) => {
              const props = cardProps(el);
              if (el.type === 'text')
                return (
                  <div
                    key={el.id}
                    className={`canvas-card text-card ${props.isMovable ? 'is-movable' : ''}`}
                    style={props.style}
                    {...props.handlers}
                  >
                    <DragHandle elementId={el.id} isMovable={props.isMovable} handlers={props.handlers} />
                    {el.text}
                  </div>
                );
              if (el.type === 'markdown')
                return (
                  <div
                    key={el.id}
                    className={`canvas-card markdown-card ${props.isMovable ? 'is-movable' : ''}`}
                    style={props.style}
                    {...props.handlers}
                  >
                    <DragHandle elementId={el.id} isMovable={props.isMovable} handlers={props.handlers} />
                    <MarkdownBlock markdown={el.markdown} />
                  </div>
                );
              if (el.type === 'asset')
                return <AssetCard key={el.id} element={el} onOpenDetails={openAssetDetails} {...props} />;
              if (el.type === 'glbViewer') return <GlbViewerCard key={el.id} element={el} {...props} />;
              if (el.type === 'video') return <VideoCard key={el.id} element={el} {...props} />;
              if (el.type === 'bboxOverlay') return <BBoxOverlayCard key={el.id} element={el} {...props} />;
              if (el.type === 'pathOverlay') return <PathOverlayCard key={el.id} element={el} {...props} />;
              if (el.type === 'table')
                return (
                  <div
                    key={el.id}
                    className={`canvas-card table-card ${props.isMovable ? 'is-movable' : ''}`}
                    style={props.style}
                    {...props.handlers}
                  >
                    <DragHandle elementId={el.id} isMovable={props.isMovable} handlers={props.handlers} />
                    <table>
                      <thead>
                        <tr>
                          {el.columns.map((c) => (
                            <th key={c}>{c}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {el.rows.map((row, idx) => (
                          <tr key={idx}>
                            {row.map((cell, cidx) => (
                              <td key={cidx}>{cell}</td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                );
              if (el.type === 'shape')
                return (
                  <div
                    key={el.id}
                    className={`canvas-card shape-card ${el.shape} ${props.isMovable ? 'is-movable' : ''}`}
                    style={props.style}
                    {...props.handlers}
                  >
                    <DragHandle elementId={el.id} isMovable={props.isMovable} handlers={props.handlers} />
                    {el.label}
                  </div>
                );
              return (
                <div key={el.id} className="canvas-card" style={props.style} {...props.handlers}>
                  {el.id}
                </div>
              );
            })}
          </div>
        </div>
      </main>
      <AssetDetailsDialog
        open={assetDetails.open}
        loading={assetDetails.loading}
        error={assetDetails.error}
        details={assetDetails.details}
        onClose={closeAssetDetails}
      />
    </div>
  );
}
