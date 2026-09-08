import { useEffect, useState } from 'react';
import { MAX_OVERLAP_WARNING_LIMIT, type DiagnosticsConfiguration } from '../../configuration';

interface DiagnosticsControlProps {
  value: DiagnosticsConfiguration;
  onChange(value: DiagnosticsConfiguration): Promise<void>;
}

export function DiagnosticsControl({ value, onChange }: DiagnosticsControlProps) {
  const [mode, setMode] = useState(value.overlapMode);
  const [limit, setLimit] = useState(String(value.maxOverlapWarnings));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setMode(value.overlapMode);
    setLimit(String(value.maxOverlapWarnings));
  }, [value.overlapMode, value.maxOverlapWarnings]);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await onChange({
        overlapMode: mode,
        maxOverlapWarnings: mode === 'bounded' ? Number(limit) : value.maxOverlapWarnings
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  }

  return (
    <details className="canvas-bounds-control">
      <summary>Diagnostics</summary>
      <form
        className="canvas-bounds-popover"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <label>
          Overlap warnings
          <select
            value={mode}
            disabled={saving}
            onChange={(event) => setMode(event.target.value as DiagnosticsConfiguration['overlapMode'])}
          >
            <option value="off">Off</option>
            <option value="bounded">Limited</option>
            <option value="all">All</option>
          </select>
        </label>
        {mode === 'bounded' && (
          <label>
            Maximum overlap warnings
            <input
              type="number"
              required
              min="1"
              max={MAX_OVERLAP_WARNING_LIMIT}
              step="1"
              value={limit}
              disabled={saving}
              onChange={(event) => setLimit(event.target.value)}
            />
          </label>
        )}
        <p>Applies to all canvases, including agent responses and snapshots. Other diagnostics remain enabled.</p>
        {mode === 'all' && <p>All checks every pair and can produce very large responses on crowded canvases.</p>}
        {error && (
          <div className="canvas-bounds-error" role="alert">
            {error}
          </div>
        )}
        <button type="submit" disabled={saving}>
          {saving ? 'Saving…' : 'Save diagnostics'}
        </button>
      </form>
    </details>
  );
}
