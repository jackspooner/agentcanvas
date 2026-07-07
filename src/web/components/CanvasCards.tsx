import JSZip from 'jszip';
import React, { useCallback, useRef, useState } from 'react';
import type {
  AssetElement,
  BBoxOverlayElement,
  CanvasElement,
  GlbViewerElement,
  PathOverlayElement,
  VideoElement
} from '../../contracts';

export type CardPointerHandlers = Pick<
  React.HTMLAttributes<HTMLElement>,
  'onPointerDown' | 'onPointerMove' | 'onPointerUp' | 'onPointerCancel'
>;

export interface CardProps {
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
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'bbox';
}

function overlayAccent(index: number): string {
  return ['#2563eb', '#9333ea', '#0891b2', '#db2777', '#ea580c', '#16a34a'][index % 6];
}

export function elementStyle(el: CanvasElement): React.CSSProperties {
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

export function eventStartedInEmbeddedMedia(event: { target: EventTarget | null }): boolean {
  const target = event.target;
  return target instanceof Element && Boolean(target.closest('model-viewer, video'));
}

export function eventStartedInInteractiveControl(event: { target: EventTarget | null }): boolean {
  const target = event.target;
  return (
    target instanceof Element &&
    Boolean(target.closest('button, a, input, textarea, select, option, [role="button"], [contenteditable="true"]'))
  );
}

export function isMovableElement(el: CanvasElement, readOnly: boolean): boolean {
  return !readOnly && el.locked !== true && el.type !== 'line' && el.type !== 'arrow' && el.type !== 'group';
}

export function DragHandle({
  elementId,
  isMovable,
  handlers
}: {
  elementId: string;
  isMovable: boolean;
  handlers: CardPointerHandlers;
}) {
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

export function trySetPointerCapture(element: HTMLElement, pointerId: number) {
  try {
    element.setPointerCapture?.(pointerId);
  } catch {
    // Synthetic/browser-test PointerEvents may not be active pointers. Dragging still works
    // through React events; real user pointer input keeps capture for out-of-card moves.
  }
}

export function AssetCard({
  element,
  style,
  handlers,
  isMovable,
  onOpenDetails
}: { element: AssetElement; onOpenDetails: (element: AssetElement) => void } & CardProps) {
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

export function GlbViewerCard({ element, style, handlers, isMovable }: { element: GlbViewerElement } & CardProps) {
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

export function VideoCard({ element, style, handlers, isMovable }: { element: VideoElement } & CardProps) {
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
        <div
          className="asset-placeholder"
          role="note"
          aria-label={`Video asset ${element.assetRef.assetId} unavailable`}
        >
          <strong>video unavailable</strong>
          <span>{element.assetRef.assetId}</span>
        </div>
      )}
      {element.caption && <figcaption>{element.caption}</figcaption>}
    </figure>
  );
}

export function BBoxOverlayCard({ element, style, handlers, isMovable }: { element: BBoxOverlayElement } & CardProps) {
  const label = element.caption ?? element.alt ?? element.id;
  const showLabels = element.showLabels !== false;
  const background = element.background ?? '#f8fafc';
  const canvasWidth = element.canvasWidth ?? 1024;
  const canvasHeight = element.canvasHeight ?? 1024;
  const boxes = Array.isArray(element.boxes) ? element.boxes : [];
  const svgRef = useRef<SVGSVGElement>(null);
  const [exporting, setExporting] = useState(false);
  const hasResolvedLayout =
    typeof element.canvasWidth === 'number' && typeof element.canvasHeight === 'number' && Array.isArray(element.boxes);

  const handleExportPng = useCallback(() => {
    const svgEl = svgRef.current;
    if (!svgEl || exporting || !hasResolvedLayout) return;
    setExporting(true);

    try {
      // Clone the SVG and set native pixel dimensions.
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
        if (!ctx) {
          setExporting(false);
          return;
        }

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
    if (
      exporting ||
      !hasResolvedLayout ||
      !Array.isArray(element.boxes) ||
      typeof element.canvasWidth !== 'number' ||
      typeof element.canvasHeight !== 'number'
    )
      return;
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
      {hasResolvedLayout &&
      typeof element.canvasWidth === 'number' &&
      typeof element.canvasHeight === 'number' &&
      Array.isArray(element.boxes) ? (
        <div className="bbox-overlay-stage" style={{ aspectRatio: `${canvasWidth} / ${canvasHeight}`, background }}>
          {element.imageResolvedUrl ? (
            <img className="bbox-overlay-image" src={element.imageResolvedUrl} alt={label} />
          ) : (
            <div className="bbox-overlay-plain" role="img" aria-label={label} />
          )}
          <svg
            ref={svgRef}
            className="bbox-overlay-svg"
            viewBox={`0 0 ${canvasWidth} ${canvasHeight}`}
            aria-label={`${label} bbox overlay`}
          >
            {boxes.map((box, index) => {
              const color = box.color ?? overlayAccent(index);
              const align = box.labelAlign ?? 'left';
              const verticalAlign = box.labelVerticalAlign ?? 'top';
              const padding = box.labelPadding ?? 8;
              const textAnchor = align === 'center' ? 'middle' : align === 'right' ? 'end' : 'start';
              const textX =
                align === 'center'
                  ? box.x + box.width / 2
                  : align === 'right'
                    ? box.x + box.width - padding
                    : box.x + padding;
              const dominantBaseline =
                verticalAlign === 'middle' ? 'middle' : verticalAlign === 'bottom' ? 'text-after-edge' : 'hanging';
              const textY =
                verticalAlign === 'middle'
                  ? box.y + box.height / 2
                  : verticalAlign === 'bottom'
                    ? box.y + box.height - padding
                    : box.y + padding;
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

export function PathOverlayCard({ element, style, handlers, isMovable }: { element: PathOverlayElement } & CardProps) {
  const label = element.caption ?? element.alt ?? element.id;
  const showLabels = element.showLabels !== false;
  const background = element.background ?? '#f8fafc';

  return (
    <figure className={`canvas-card path-overlay-card ${isMovable ? 'is-movable' : ''}`} style={style} {...handlers}>
      <DragHandle elementId={element.id} isMovable={isMovable} handlers={handlers} />
      <div
        className="path-overlay-stage"
        style={{ aspectRatio: `${element.canvasWidth} / ${element.canvasHeight}`, background }}
        role="img"
        aria-label={label}
      >
        <svg
          className="path-overlay-svg"
          viewBox={`0 0 ${element.canvasWidth} ${element.canvasHeight}`}
          aria-label={`${label} path overlay`}
        >
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
