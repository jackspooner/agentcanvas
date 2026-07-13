import React, { useEffect, useState } from 'react';
import type { CanvasBounds } from '../../contracts';

interface CanvasBoundsControlProps {
  bounds: CanvasBounds;
  readOnly: boolean;
  onChange?: (bounds: CanvasBounds) => Promise<void> | void;
  summaryLabel?: string;
  selectLabel?: string;
  helpText?: string;
  applyLabel?: string;
}

function boundsLabel(bounds: CanvasBounds): string {
  return bounds.mode === 'unlimited' ? 'Unlimited canvas' : `${bounds.width} × ${bounds.height}`;
}

export function CanvasBoundsControl({
  bounds,
  readOnly,
  onChange,
  summaryLabel,
  selectLabel = 'Canvas type',
  helpText = 'Bounds define the document. They do not change the visible browser viewport.',
  applyLabel = 'Apply bounds'
}: CanvasBoundsControlProps) {
  const [mode, setMode] = useState<CanvasBounds['mode']>(bounds.mode);
  const [width, setWidth] = useState(bounds.mode === 'fixed' ? String(bounds.width) : '1600');
  const [height, setHeight] = useState(bounds.mode === 'fixed' ? String(bounds.height) : '1000');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setMode(bounds.mode);
    if (bounds.mode === 'fixed') {
      setWidth(String(bounds.width));
      setHeight(String(bounds.height));
    }
  }, [bounds.mode, bounds.mode === 'fixed' ? bounds.width : null, bounds.mode === 'fixed' ? bounds.height : null]);

  const summary = summaryLabel ?? boundsLabel(bounds);
  if (readOnly || !onChange) return <span className="badge canvas-bounds-badge">{summary}</span>;
  const applyChange = onChange;

  async function save() {
    setError(null);
    const nextBounds: CanvasBounds =
      mode === 'unlimited' ? { mode: 'unlimited' } : { mode: 'fixed', width: Number(width), height: Number(height) };
    if (
      nextBounds.mode === 'fixed' &&
      (!Number.isInteger(nextBounds.width) ||
        !Number.isInteger(nextBounds.height) ||
        nextBounds.width <= 0 ||
        nextBounds.height <= 0)
    ) {
      setError('Width and height must be positive whole numbers.');
      return;
    }
    setSaving(true);
    try {
      await applyChange(nextBounds);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  }

  return (
    <details className="canvas-bounds-control">
      <summary>{summary}</summary>
      <div className="canvas-bounds-popover">
        <label>
          {selectLabel}
          <select value={mode} onChange={(event) => setMode(event.target.value as CanvasBounds['mode'])}>
            <option value="unlimited">Unlimited</option>
            <option value="fixed">Fixed size</option>
          </select>
        </label>
        {mode === 'fixed' && (
          <div className="canvas-bounds-dimensions">
            <label>
              Width
              <input
                min="1"
                max="20000"
                step="1"
                inputMode="numeric"
                value={width}
                onChange={(event) => setWidth(event.target.value)}
              />
            </label>
            <label>
              Height
              <input
                min="1"
                max="20000"
                step="1"
                inputMode="numeric"
                value={height}
                onChange={(event) => setHeight(event.target.value)}
              />
            </label>
          </div>
        )}
        <p>{helpText}</p>
        {error && (
          <div className="canvas-bounds-error" role="alert">
            {error}
          </div>
        )}
        <button type="button" disabled={saving} onClick={save}>
          {saving ? 'Saving…' : applyLabel}
        </button>
      </div>
    </details>
  );
}
