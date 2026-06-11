import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { AssetElement, CanvasElement, CanvasRecord, CanvasViewport, CanvasViewportState, GlbViewerElement } from '../../contracts';
import { coerceViewport, DEFAULT_REPORTED_VIEWPORT_HEIGHT, DEFAULT_REPORTED_VIEWPORT_WIDTH } from '../viewport';
import { MarkdownBlock } from './MarkdownBlock';

interface CanvasViewProps {
  canvas: CanvasRecord;
  readOnly?: boolean;
  initialViewport?: CanvasViewport;
  loadViewport?: () => Promise<CanvasViewportState>;
  onViewportChange?: (viewport: CanvasViewport) => void;
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

function eventStartedInModelViewer(event: { target: EventTarget | null }): boolean {
  const target = event.target;
  return target instanceof Element && Boolean(target.closest('model-viewer'));
}

function AssetCard({ element }: { element: AssetElement }) {
  const [failed, setFailed] = useState(false);
  const label = element.caption ?? element.alt ?? element.id;
  const showImage = Boolean(element.resolvedUrl) && !failed;

  return (
    <figure className="canvas-card asset-card" style={elementStyle(element)}>
      {showImage ? (
        <img src={element.resolvedUrl ?? undefined} alt={label} onError={() => setFailed(true)} />
      ) : (
        <div className="asset-placeholder" role="note" aria-label={`Asset ${element.assetRef.assetId} unavailable`}>
          <strong>asset unavailable</strong>
          <span>{element.assetRef.assetId}</span>
        </div>
      )}
      {element.caption && <figcaption>{element.caption}</figcaption>}
    </figure>
  );
}

function GlbViewerCard({ element }: { element: GlbViewerElement }) {
  const label = element.caption ?? element.alt ?? element.id;

  return (
    <figure className="canvas-card glb-viewer-card" style={elementStyle(element)}>
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

export function CanvasView({ canvas, readOnly = false, initialViewport, loadViewport, onViewportChange }: CanvasViewProps) {
  const [viewport, setViewport] = useState<CanvasViewport>(() => coerceViewport(initialViewport));
  const [isDragging, setIsDragging] = useState(false);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ x: number; y: number; centerX: number; centerY: number } | null>(null);
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

  useEffect(() => {
    const node = viewportRef.current;
    if (!node) return undefined;

    const handleWheel = (event: WheelEvent) => {
      if (eventStartedInModelViewer(event)) return;
      event.preventDefault();
      setViewport((current) => {
        if (event.ctrlKey || event.metaKey) {
          return coerceViewport({ ...current, zoom: current.zoom * (event.deltaY < 0 ? 1.12 : 1 / 1.12) });
        }
        return coerceViewport({
          ...current,
          centerX: current.centerX + event.deltaX / current.zoom,
          centerY: current.centerY + event.deltaY / current.zoom
        });
      });
    };

    node.addEventListener('wheel', handleWheel, { passive: false });
    return () => node.removeEventListener('wheel', handleWheel);
  }, []);

  function onPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    if (eventStartedInModelViewer(event)) return;
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

  return (
    <div className="canvas-shell">
      <header className="topbar">
        <div className="topbar-title">
          <strong>{canvas.title}</strong>
          <span>revision {canvas.revision}</span>
          {readOnly && <span className="badge">read-only</span>}
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
              if (el.type === 'text') return <div key={el.id} className="canvas-card text-card" style={elementStyle(el)}>{el.text}</div>;
              if (el.type === 'markdown') return <div key={el.id} className="canvas-card markdown-card" style={elementStyle(el)}><MarkdownBlock markdown={el.markdown} /></div>;
              if (el.type === 'asset') return <AssetCard key={el.id} element={el} />;
              if (el.type === 'glbViewer') return <GlbViewerCard key={el.id} element={el} />;
              if (el.type === 'table') return <div key={el.id} className="canvas-card table-card" style={elementStyle(el)}><table><thead><tr>{el.columns.map((c) => <th key={c}>{c}</th>)}</tr></thead><tbody>{el.rows.map((row, idx) => <tr key={idx}>{row.map((cell, cidx) => <td key={cidx}>{cell}</td>)}</tr>)}</tbody></table></div>;
              if (el.type === 'shape') return <div key={el.id} className={`canvas-card shape-card ${el.shape}`} style={elementStyle(el)}>{el.label}</div>;
              return <div key={el.id} className="canvas-card" style={elementStyle(el)}>{el.id}</div>;
            })}
          </div>
        </div>
      </main>
    </div>
  );
}
