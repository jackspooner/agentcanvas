import JSZip from 'jszip';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AssetDetailsResponse, AssetElement, BBoxOverlayElement, CanvasElement, CanvasRecord, CanvasViewport, CanvasViewportState, GlbViewerElement, PathOverlayElement, VideoElement } from '../../contracts';
import { fetchAssetDetails } from '../api';
import { coerceViewport, DEFAULT_REPORTED_VIEWPORT_HEIGHT, DEFAULT_REPORTED_VIEWPORT_WIDTH } from '../viewport';
import { AssetDetailsDialog } from './AssetDetailsDialog';
import { MarkdownBlock } from './MarkdownBlock';

interface CanvasViewProps {
  canvas: CanvasRecord;
  readOnly?: boolean;
  initialViewport?: CanvasViewport;
  loadViewport?: () => Promise<CanvasViewportState>;
  onViewportChange?: (viewport: CanvasViewport) => void;
  onElementMove?: (elementId: string, x: number, y: number) => Promise<void> | void;
}

type CardPointerHandlers = Pick<React.HTMLAttributes<HTMLElement>, 'onPointerDown' | 'onPointerMove' | 'onPointerUp' | 'onPointerCancel'>;

interface CardProps {
  style: React.CSSProperties;
  handlers: CardPointerHandlers;
  isMovable: boolean;
}

function downloadBlob(blob: Blob, filename: string) {
  const downloadUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = downloadUrl;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(downloadUrl);
}

function canvasToBlob(canvas: HTMLCanvasElement, type = 'image/png'): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('failed to encode canvas export'));
    }, type);
  });
}

function slugifyFilenamePart(value: string): string {
  const slug = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return slug || 'bbox';
}

function overlayAccent(index: number): string {
  return ['#2563eb', '#9333ea', '#0891b2', '#db2777', '#ea580c', '#16a34a'][index % 6];
}

function elementStyle(el: CanvasElement): React.CSSProperties {
  return {
    position: 'absolute',
    left: el.x,
    top: el.y,
    width: el.width ?? 240,
    minHeight: el.height ?? undefined,
    zIndex: el.zIndex ?? 1,
    opacity: el.opacity ?? 1,
    transform: el.rotation ? `rotate(${el.rotation}deg)` : undefined,
    transformOrigin: 'top left',
    ...((el.style ?? {}) as React.CSSProperties)
  };
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

function eventStartedInEmbeddedMedia(event: { target: EventTarget | null }): boolean {
  const target = event.target;
  return target instanceof Element && Boolean(target.closest('model-viewer, video'));
}

function eventStartedInInteractiveControl(event: { target: EventTarget | null }): boolean {
  const target = event.target;
  return target instanceof Element && Boolean(target.closest('button, a, input, textarea, select, option, [role="button"], [contenteditable="true"]'));
}

function isMovableElement(el: CanvasElement, readOnly: boolean): boolean {
  return !readOnly && el.locked !== true && el.type !== 'line' && el.type !== 'arrow' && el.type !== 'group';
}

function DragHandle({ elementId, isMovable, handlers }: { elementId: string; isMovable: boolean; handlers: CardPointerHandlers }) {
  if (!isMovable) return null;
  return (
    <button
      type="button"
      className="node-drag-handle"
      aria-label={`Move node ${elementId}`}
      title="Drag to move this node"
      {...handlers}
      onClick={(event) => event.preventDefault()}
    >
      ↕
    </button>
  );
}

function trySetPointerCapture(element: HTMLElement, pointerId: number) {
  try {
    element.setPointerCapture?.(pointerId);
  } catch {
    // Synthetic/browser-test PointerEvents may not be active pointers. Dragging still works
    // through React events; real user pointer input keeps capture for out-of-card moves.
  }
}

function AssetCard({ element, style, handlers, isMovable, onOpenDetails }: { element: AssetElement; onOpenDetails: (element: AssetElement) => void } & CardProps) {
  const [failed, setFailed] = useState(false);
  const label = element.caption ?? element.alt ?? element.id;
  const showImage = Boolean(element.resolvedUrl) && !failed;

  return (
    <figure className={`canvas-card asset-card ${isMovable ? 'is-movable' : ''}`} style={style} {...handlers}>
      <DragHandle elementId={element.id} isMovable={isMovable} handlers={handlers} />
      {showImage ? (
        <img src={element.resolvedUrl ?? undefined} alt={label} onError={() => setFailed(true)} />
      ) : (
        <div className="asset-placeholder" role="note" aria-label={`Asset ${element.assetRef.assetId} unavailable`}>
          <strong>asset unavailable</strong>
          <span>{element.assetRef.assetId}</span>
        </div>
      )}
      <button
        type="button"
        className="asset-details-trigger"
        aria-label={`Open asset details for ${label}`}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          onOpenDetails(element);
        }}
      >
        Details
      </button>
      {element.caption && <figcaption>{element.caption}</figcaption>}
    </figure>
  );
}

function GlbViewerCard({ element, style, handlers, isMovable }: { element: GlbViewerElement } & CardProps) {
  const label = element.caption ?? element.alt ?? element.id;

  return (
    <figure className={`canvas-card glb-viewer-card ${isMovable ? 'is-movable' : ''}`} style={style} {...handlers}>
      <DragHandle elementId={element.id} isMovable={isMovable} handlers={handlers} />
      {element.resolvedUrl ? (
        React.createElement('model-viewer', {
          src: element.resolvedUrl,
          'aria-label': label,
          'camera-controls': element.cameraControls !== false ? '' : undefined,
          'auto-rotate': element.autoRotate ? '' : undefined,
          'interaction-prompt': 'auto',
          'interaction-prompt-style': 'basic',
          'touch-action': 'pan-y',
          tabIndex: 0
        })
      ) : (
        <div className="asset-placeholder" role="note" aria-label={`GLB asset ${element.assetRef.assetId} unavailable`}>
          <strong>GLB unavailable</strong>
          <span>{element.assetRef.assetId}</span>
        </div>
      )}
      {element.caption && <figcaption>{element.caption}</figcaption>}
      {element.resolvedUrl && <div className="glb-viewer-hint">Drag to orbit · scroll to zoom</div>}
    </figure>
  );
}

function VideoCard({ element, style, handlers, isMovable }: { element: VideoElement } & CardProps) {
  const label = element.caption ?? element.alt ?? element.id;
  const [failed, setFailed] = useState(false);

  return (
    <figure className={`canvas-card video-card ${isMovable ? 'is-movable' : ''}`} style={style} {...handlers}>
      <DragHandle elementId={element.id} isMovable={isMovable} handlers={handlers} />
      {element.resolvedUrl && !failed ? (
        <video
          src={element.resolvedUrl}
          aria-label={label}
          title={label}
          poster={element.posterResolvedUrl ?? undefined}
          controls={element.controls !== false}
          autoPlay={Boolean(element.autoplay)}
          loop={Boolean(element.loop)}
          muted={element.muted !== false}
          playsInline
          preload="metadata"
          onError={() => setFailed(true)}
        />
      ) : (
        <div className="asset-placeholder" role="note" aria-label={`Video asset ${element.assetRef.assetId} unavailable`}>
          <strong>video unavailable</strong>
          <span>{element.assetRef.assetId}</span>
        </div>
      )}
      {element.caption && <figcaption>{element.caption}</figcaption>}
    </figure>
  );
}

function BBoxOverlayCard({ element, style, handlers, isMovable }: { element: BBoxOverlayElement } & CardProps) {
  const label = element.caption ?? element.alt ?? element.id;
  const showLabels = element.showLabels !== false;
  const background = element.background ?? '#f8fafc';
  const canvasWidth = element.canvasWidth ?? 1024;
  const canvasHeight = element.canvasHeight ?? 1024;
  const boxes = Array.isArray(element.boxes) ? element.boxes : [];
  const svgRef = useRef<SVGSVGElement>(null);
  const [exporting, setExporting] = useState(false);
  const hasResolvedLayout = typeof element.canvasWidth === 'number' && typeof element.canvasHeight === 'number' && Array.isArray(element.boxes);

  const handleExportPng = useCallback(() => {
    const svgEl = svgRef.current;
    if (!svgEl || exporting || !hasResolvedLayout) return;
    setExporting(true);

    try {
      // Clone the SVG and set native pixel dimensions
      const clone = svgEl.cloneNode(true) as SVGSVGElement;
      clone.setAttribute('width', String(canvasWidth));
      clone.setAttribute('height', String(canvasHeight));

      const serializer = new XMLSerializer();
      const svgString = serializer.serializeToString(clone);
      const svgBlob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
      const svgUrl = URL.createObjectURL(svgBlob);

      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = canvasWidth;
        canvas.height = canvasHeight;
        const ctx = canvas.getContext('2d');
        if (!ctx) { setExporting(false); return; }

        // Fill background
        ctx.fillStyle = background;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0);

        canvas.toBlob((blob) => {
          setExporting(false);
          if (!blob) return;
          downloadBlob(blob, `${element.id}-${canvasWidth}x${canvasHeight}.png`);
        }, 'image/png');

        URL.revokeObjectURL(svgUrl);
      };
      img.onerror = () => {
        setExporting(false);
        URL.revokeObjectURL(svgUrl);
      };
      img.src = svgUrl;
    } catch {
      setExporting(false);
    }
  }, [background, canvasHeight, canvasWidth, element.id, exporting, hasResolvedLayout]);

  const handleExportMasksZip = useCallback(async () => {
    if (exporting || !hasResolvedLayout || !Array.isArray(element.boxes) || typeof element.canvasWidth !== 'number' || typeof element.canvasHeight !== 'number') return;
    setExporting(true);

    try {
      const zip = new JSZip();
      const folder = zip.folder(`${element.id}-${canvasWidth}x${canvasHeight}-masks`);
      if (!folder) throw new Error('failed to create bbox mask archive');

      for (const [index, box] of boxes.entries()) {
        const canvas = document.createElement('canvas');
        canvas.width = canvasWidth;
        canvas.height = canvasHeight;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('failed to create bbox mask canvas');

        ctx.fillStyle = '#000000';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(box.x, box.y, box.width, box.height);

        const blob = await canvasToBlob(canvas);
        const filename = `${String(index + 1).padStart(2, '0')}-${slugifyFilenamePart(box.label ?? box.id)}.png`;
        folder.file(filename, blob);
      }

      const archive = await zip.generateAsync({ type: 'blob' });
      downloadBlob(archive, `${element.id}-${canvasWidth}x${canvasHeight}-masks.zip`);
    } finally {
      setExporting(false);
    }
  }, [boxes, canvasHeight, canvasWidth, element.id, exporting, hasResolvedLayout]);

  return (
    <figure className={`canvas-card bbox-overlay-card ${isMovable ? 'is-movable' : ''}`} style={style} {...handlers}>
      <DragHandle elementId={element.id} isMovable={isMovable} handlers={handlers} />
      <div className="bbox-export-actions">
        <button
          type="button"
          className="bbox-export-btn"
          aria-label="Export bbox masks as ZIP"
          title="Export mask ZIP"
          disabled={exporting || !hasResolvedLayout}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            void handleExportMasksZip();
          }}
        >
          {exporting ? '…' : 'Export ZIP'}
        </button>
        <button
          type="button"
          className="bbox-export-btn"
          aria-label="Export bbox overlay as PNG"
          title="Export as PNG"
          disabled={exporting || !hasResolvedLayout}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            handleExportPng();
          }}
        >
          {exporting ? '…' : 'Export PNG'}
        </button>
      </div>
      {hasResolvedLayout && typeof element.canvasWidth === 'number' && typeof element.canvasHeight === 'number' && Array.isArray(element.boxes) ? (
        <div className="bbox-overlay-stage" style={{ aspectRatio: `${canvasWidth} / ${canvasHeight}`, background }}>
        {element.imageResolvedUrl ? <img className="bbox-overlay-image" src={element.imageResolvedUrl} alt={label} /> : <div className="bbox-overlay-plain" role="img" aria-label={label} />}
        <svg ref={svgRef} className="bbox-overlay-svg" viewBox={`0 0 ${canvasWidth} ${canvasHeight}`} aria-label={`${label} bbox overlay`}>
          {boxes.map((box, index) => {
            const color = box.color ?? overlayAccent(index);
            const align = box.labelAlign ?? 'left';
            const verticalAlign = box.labelVerticalAlign ?? 'top';
            const padding = box.labelPadding ?? 8;
            const textAnchor = align === 'center' ? 'middle' : align === 'right' ? 'end' : 'start';
            const textX = align === 'center' ? box.x + box.width / 2 : align === 'right' ? box.x + box.width - padding : box.x + padding;
            const dominantBaseline = verticalAlign === 'middle' ? 'middle' : verticalAlign === 'bottom' ? 'text-after-edge' : 'hanging';
            const textY = verticalAlign === 'middle' ? box.y + box.height / 2 : verticalAlign === 'bottom' ? box.y + box.height - padding : box.y + padding;
              return (
                <g key={box.id} className="bbox-overlay-box">
                  <rect
                    data-bbox-id={box.id}
                    x={box.x}
                    y={box.y}
                    width={box.width}
                    height={box.height}
                    fill={box.fill ?? `${color}22`}
                    stroke={color}
                    strokeWidth={box.strokeWidth ?? Math.max(2, Math.round(canvasWidth / 512))}
                  />
                  {showLabels && (
                    <text
                      x={textX}
                      y={textY}
                      textAnchor={textAnchor}
                      dominantBaseline={dominantBaseline}
                      fill={color}
                      fontSize={28}
                      fontWeight={700}
                      paintOrder="stroke"
                      stroke="#ffffff"
                      strokeWidth={5}
                    >
                      {box.label ?? box.id}
                    </text>
                  )}
                </g>
              );
            })}
          </svg>
        </div>
      ) : (
        <div className="asset-placeholder" role="note" aria-label={`BBox layout asset for ${element.id} unavailable`}>
          <strong>bbox layout unavailable</strong>
          <span>{element.layoutAssetRef?.assetId ?? element.id}</span>
          {element.layoutResolutionError && <span>{element.layoutResolutionError}</span>}
        </div>
      )}
      {element.caption && <figcaption>{element.caption}</figcaption>}
    </figure>
  );
}

function PathOverlayCard({ element, style, handlers, isMovable }: { element: PathOverlayElement } & CardProps) {
  const label = element.caption ?? element.alt ?? element.id;
  const showLabels = element.showLabels !== false;
  const background = element.background ?? '#f8fafc';

  return (
    <figure className={`canvas-card path-overlay-card ${isMovable ? 'is-movable' : ''}`} style={style} {...handlers}>
      <DragHandle elementId={element.id} isMovable={isMovable} handlers={handlers} />
      <div className="path-overlay-stage" style={{ aspectRatio: `${element.canvasWidth} / ${element.canvasHeight}`, background }} role="img" aria-label={label}>
        <svg className="path-overlay-svg" viewBox={`0 0 ${element.canvasWidth} ${element.canvasHeight}`} aria-label={`${label} path overlay`}>
          {element.paths.map((path, index) => {
            const color = path.color ?? overlayAccent(index);
            return (
              <path
                key={path.id}
                data-path-id={path.id}
                d={path.d}
                fill={path.fill ?? 'transparent'}
                stroke={color}
                strokeWidth={path.strokeWidth ?? Math.max(2, Math.round(element.canvasWidth / 512))}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            );
          })}
        </svg>
      </div>
      {showLabels && element.paths.length > 0 && (
        <ul className="path-overlay-legend" aria-label={`${label} paths`}>
          {element.paths.map((path, index) => {
            const color = path.color ?? overlayAccent(index);
            return (
              <li key={path.id}>
                <span className="path-overlay-swatch" style={{ backgroundColor: color }} aria-hidden="true" />
                <span>{path.label ?? path.id}</span>
              </li>
            );
          })}
        </ul>
      )}
      {element.caption && <figcaption>{element.caption}</figcaption>}
    </figure>
  );
}

export function CanvasView({ canvas, readOnly = false, initialViewport, loadViewport, onViewportChange, onElementMove }: CanvasViewProps) {
  const [viewport, setViewport] = useState<CanvasViewport>(() => coerceViewport(initialViewport));
  const [isDragging, setIsDragging] = useState(false);
  const [movingElementId, setMovingElementId] = useState<string | null>(null);
  const [positionOverrides, setPositionOverrides] = useState<Record<string, { x: number; y: number }>>({});
  const [moveError, setMoveError] = useState<string | null>(null);
  const [assetDetails, setAssetDetails] = useState<{ open: boolean; loading: boolean; error: string | null; details: AssetDetailsResponse | null }>({
    open: false,
    loading: false,
    error: null,
    details: null
  });
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ x: number; y: number; centerX: number; centerY: number } | null>(null);
  const nodeDragRef = useRef<{ elementId: string; pointerId: number; x: number; y: number; startX: number; startY: number; currentX: number; currentY: number; zoom: number } | null>(null);
  const lastAgentViewport = useRef<string | null>(initialViewport?.source === 'agent' ? initialViewport.updatedAt : null);
  const connectors = canvas.elements.filter((el) => el.type === 'line' || el.type === 'arrow');
  const cards = canvas.elements.filter((el) => el.type !== 'line' && el.type !== 'arrow');

  const worldTransform = useMemo(() => ({
    transform: `translate(${-viewport.centerX * viewport.zoom}px, ${-viewport.centerY * viewport.zoom}px) scale(${viewport.zoom})`
  }), [viewport.centerX, viewport.centerY, viewport.zoom]);

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
      setAssetDetails({ open: true, loading: false, error: error instanceof Error ? error.message : String(error), details: null });
    }
  }, []);

  useEffect(() => {
    const node = viewportRef.current;
    if (!node) return undefined;

    const handleWheel = (event: WheelEvent) => {
      if (eventStartedInEmbeddedMedia(event)) return;
      event.preventDefault();
      setViewport((current) => coerceViewport({
        ...current,
        zoom: current.zoom * (event.deltaY < 0 ? 1.12 : 1 / 1.12)
      }));
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
    setViewport((current) => coerceViewport({
      ...current,
      centerX: dragState.centerX - dx / current.zoom,
      centerY: dragState.centerY - dy / current.zoom
    }));
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
    if (eventStartedInInteractiveControl(event) && !(event.target instanceof Element && event.target.closest('.node-drag-handle'))) return;
    if (eventStartedInEmbeddedMedia(event)) return;
    event.preventDefault();
    event.stopPropagation();
    trySetPointerCapture(event.currentTarget, event.pointerId);
    const current = elementWithPositionOverride(element);
    nodeDragRef.current = { elementId: element.id, pointerId: event.pointerId, x: event.clientX, y: event.clientY, startX: current.x, startY: current.y, currentX: current.x, currentY: current.y, zoom: viewport.zoom };
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
      if (!changed) setPositionOverrides((current) => {
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
      handlers: movable ? {
        onPointerDown: (event) => startElementDrag(element, event),
        onPointerMove: moveElementDrag,
        onPointerUp: endElementDrag,
        onPointerCancel: endElementDrag
      } : {}
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
          center {Math.round(viewport.centerX)}, {Math.round(viewport.centerY)} · zoom {Math.round(viewport.zoom * 100)}%
        </div>
        <div className="zoom-controls">
          <button type="button" onClick={() => zoomBy(1 / 1.2)} aria-label="Zoom out">−</button>
          <button type="button" onClick={centerAtOrigin}>0,0</button>
          <button type="button" onClick={() => zoomBy(1.2)} aria-label="Zoom in">+</button>
        </div>
      </header>
      {moveError && <div className="node-move-error" role="alert">Could not move node: {moveError}</div>}
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
                return <line key={el.id} x1={x1} y1={y1} x2={x2} y2={y2} stroke={el.stroke ?? '#2563eb'} strokeWidth={el.strokeWidth ?? 2} markerEnd={el.type === 'arrow' ? 'url(#arrowhead)' : undefined} />;
              })}
            </svg>
            {cards.map((el) => {
              const props = cardProps(el);
              if (el.type === 'text') return <div key={el.id} className={`canvas-card text-card ${props.isMovable ? 'is-movable' : ''}`} style={props.style} {...props.handlers}><DragHandle elementId={el.id} isMovable={props.isMovable} handlers={props.handlers} />{el.text}</div>;
              if (el.type === 'markdown') return <div key={el.id} className={`canvas-card markdown-card ${props.isMovable ? 'is-movable' : ''}`} style={props.style} {...props.handlers}><DragHandle elementId={el.id} isMovable={props.isMovable} handlers={props.handlers} /><MarkdownBlock markdown={el.markdown} /></div>;
              if (el.type === 'asset') return <AssetCard key={el.id} element={el} onOpenDetails={openAssetDetails} {...props} />;
              if (el.type === 'glbViewer') return <GlbViewerCard key={el.id} element={el} {...props} />;
              if (el.type === 'video') return <VideoCard key={el.id} element={el} {...props} />;
              if (el.type === 'bboxOverlay') return <BBoxOverlayCard key={el.id} element={el} {...props} />;
              if (el.type === 'pathOverlay') return <PathOverlayCard key={el.id} element={el} {...props} />;
              if (el.type === 'table') return <div key={el.id} className={`canvas-card table-card ${props.isMovable ? 'is-movable' : ''}`} style={props.style} {...props.handlers}><DragHandle elementId={el.id} isMovable={props.isMovable} handlers={props.handlers} /><table><thead><tr>{el.columns.map((c) => <th key={c}>{c}</th>)}</tr></thead><tbody>{el.rows.map((row, idx) => <tr key={idx}>{row.map((cell, cidx) => <td key={cidx}>{cell}</td>)}</tr>)}</tbody></table></div>;
              if (el.type === 'shape') return <div key={el.id} className={`canvas-card shape-card ${el.shape} ${props.isMovable ? 'is-movable' : ''}`} style={props.style} {...props.handlers}><DragHandle elementId={el.id} isMovable={props.isMovable} handlers={props.handlers} />{el.label}</div>;
              return <div key={el.id} className="canvas-card" style={props.style} {...props.handlers}>{el.id}</div>;
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
