import React from 'react';
import type { CanvasRecord } from '../../contracts';

interface CanvasIndexProps {
  canvases: CanvasRecord[];
}

function formatDate(value: string): string {
  if (!value) return 'Unknown';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function canvasMeta(canvas: CanvasRecord): string {
  const parts = [
    `${canvas.elements.length} ${canvas.elements.length === 1 ? 'element' : 'elements'}`,
    `revision ${canvas.revision}`
  ];
  if (canvas.project) parts.push(canvas.project);
  return parts.join(' · ');
}

export function CanvasIndex({ canvases }: CanvasIndexProps) {
  return (
    <main className="canvas-index-shell">
      <header className="canvas-index-header">
        <div>
          <h1>AgentCanvas</h1>
          <p>{canvases.length} {canvases.length === 1 ? 'canvas' : 'canvases'}</p>
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
