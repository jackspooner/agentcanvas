import React from 'react';
import type { AgentCanvasConfiguration, DiagnosticsConfiguration } from '../../configuration';
import type { CanvasBounds } from '../../contracts';
import type { CanvasDocument } from '../v2-types';
import { CanvasBoundsControl } from './CanvasBoundsControl';
import { DiagnosticsControl } from './DiagnosticsControl';

interface CanvasIndexProps {
  canvases: CanvasDocument[];
  configuration: AgentCanvasConfiguration;
  onDefaultCanvasSizeChange: (size: CanvasBounds) => Promise<void> | void;
  onDiagnosticsChange: (diagnostics: DiagnosticsConfiguration) => Promise<void>;
}

function formatDate(value: string): string {
  if (!value) return 'Unknown';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function canvasMeta(canvas: CanvasDocument): string {
  const parts = [
    `${canvas.elements.length} ${canvas.elements.length === 1 ? 'element' : 'elements'}`,
    `revision ${canvas.revision}`,
    canvas.bounds.mode === 'unlimited' ? 'unlimited' : `${canvas.bounds.width} × ${canvas.bounds.height}`
  ];
  if (canvas.project) parts.push(canvas.project);
  return parts.join(' · ');
}

export function CanvasIndex({
  canvases,
  configuration,
  onDefaultCanvasSizeChange,
  onDiagnosticsChange
}: CanvasIndexProps) {
  const defaultSize = configuration.defaultCanvasSize;
  const defaultSizeLabel =
    defaultSize.mode === 'unlimited' ? 'Default: Unlimited' : `Default: ${defaultSize.width} × ${defaultSize.height}`;
  return (
    <main className="canvas-index-shell">
      <header className="canvas-index-header">
        <div>
          <h1>AgentCanvas</h1>
          <p>
            {canvases.length} {canvases.length === 1 ? 'canvas' : 'canvases'}
          </p>
        </div>
        <div className="canvas-index-settings">
          <CanvasBoundsControl
            bounds={defaultSize}
            readOnly={false}
            onChange={onDefaultCanvasSizeChange}
            summaryLabel={defaultSizeLabel}
            selectLabel="Default canvas size"
            helpText="Used when a new canvas does not provide its own size."
            applyLabel="Save default"
          />
          <DiagnosticsControl value={configuration.diagnostics} onChange={onDiagnosticsChange} />
        </div>
      </header>

      {canvases.length === 0 ? (
        <section className="canvas-index-empty" aria-label="No canvases">
          <h2>No canvases yet</h2>
        </section>
      ) : (
        <section className="canvas-index-list" aria-label="Agent canvases">
          {canvases.map((canvas) => (
            <a className="canvas-index-row" href={`/canvases/${encodeURIComponent(canvas.id)}`} key={canvas.id}>
              <div className="canvas-index-main">
                <h2>{canvas.title}</h2>
                <p>{canvasMeta(canvas)}</p>
              </div>
              <dl className="canvas-index-times">
                <div>
                  <dt>Updated</dt>
                  <dd>{formatDate(canvas.updatedAt)}</dd>
                </div>
                <div>
                  <dt>Created</dt>
                  <dd>{formatDate(canvas.createdAt)}</dd>
                </div>
              </dl>
              <span className="canvas-index-open">Open</span>
            </a>
          ))}
        </section>
      )}
    </main>
  );
}
