import type { JsonObject } from '@agentcanvas/plugin-sdk';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fetchMacroDefinition, fetchMacroList, planMacro } from '../api';
import type { MacroDefinitionRecord, MacroPlan, MacroServicePlanRequest, MacroSummary } from '../../macros/types';
import type { CanvasViewport } from '../v2-types';
import { MacroForm, type MacroFormChange } from './MacroForm';

interface MacroDrawerProps {
  canvasId: string;
  canvasRevision: number;
  viewport: CanvasViewport;
  selectionInvalidationToken: string;
  open: boolean;
  onClose(): void;
  onPlanChange?(plan: MacroPlan | null): void;
  onExecute(plan: MacroPlan): Promise<void>;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function summarySearchText(summary: MacroSummary): string {
  return [summary.id, summary.title, summary.description, summary.category, summary.scope, summary.canvasId]
    .filter(Boolean)
    .join(' ')
    .toLocaleLowerCase();
}

export function MacroDrawer({
  canvasId,
  canvasRevision,
  viewport,
  selectionInvalidationToken,
  open,
  onClose,
  onPlanChange,
  onExecute
}: MacroDrawerProps) {
  const [summaries, setSummaries] = useState<MacroSummary[]>([]);
  const [search, setSearch] = useState('');
  const [selectedSummary, setSelectedSummary] = useState<MacroSummary | null>(null);
  const [selectedVersion, setSelectedVersion] = useState<number | null>(null);
  const [record, setRecord] = useState<MacroDefinitionRecord | null>(null);
  const [input, setInput] = useState<JsonObject>({});
  const [inputValid, setInputValid] = useState(false);
  const [inputErrors, setInputErrors] = useState<readonly string[]>([]);
  const [anchor, setAnchor] = useState(() => ({ x: String(viewport.centerX), y: String(viewport.centerY) }));
  const [plan, setPlan] = useState<MacroPlan | null>(null);
  const [loading, setLoading] = useState(false);
  const [planning, setPlanning] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const requestToken = useRef(0);
  const anchorRef = useRef(anchor);
  const anchorEdited = useRef(false);
  const previewKey = useRef<string | null>(null);

  const updatePlan = useCallback(
    (next: MacroPlan | null) => {
      setPlan(next);
      onPlanChange?.(next);
    },
    [onPlanChange]
  );

  const invalidatePreview = useCallback(() => {
    requestToken.current += 1;
    previewKey.current = null;
    updatePlan(null);
    setStatus(null);
    setPlanning(false);
  }, [updatePlan]);

  useEffect(() => {
    if (!open) return undefined;
    setError(null);
    setStatus(null);
    let cancelled = false;
    setLoading(true);
    void fetchMacroList({ canvasId, includeArchived: false, limit: 100 })
      .then((response) => {
        if (!cancelled) setSummaries(response.items.filter((summary) => !summary.archived));
      })
      .catch((cause) => {
        if (!cancelled) setError(errorMessage(cause));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [canvasId, open]);

  useEffect(() => {
    if (!open) return;
    const defaultAnchor = { x: String(viewport.centerX), y: String(viewport.centerY) };
    anchorRef.current = defaultAnchor;
    anchorEdited.current = false;
    setAnchor(defaultAnchor);
  }, [canvasId, open]);

  useEffect(() => {
    if (!open || anchorEdited.current) return;
    const next = { x: String(viewport.centerX), y: String(viewport.centerY) };
    if (anchorRef.current.x === next.x && anchorRef.current.y === next.y) return;
    anchorRef.current = next;
    setAnchor(next);
    invalidatePreview();
  }, [invalidatePreview, open, viewport.centerX, viewport.centerY]);

  useEffect(() => {
    invalidatePreview();
  }, [canvasRevision, invalidatePreview]);

  useEffect(() => {
    if (open) invalidatePreview();
  }, [invalidatePreview, open, selectionInvalidationToken]);

  useEffect(() => {
    if (!open) invalidatePreview();
  }, [invalidatePreview, open]);

  const visibleSummaries = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase();
    if (!needle) return summaries;
    return summaries.filter((summary) => summarySearchText(summary).includes(needle));
  }, [search, summaries]);

  const loadExactVersion = useCallback(
    async (summary: MacroSummary, version: number) => {
      invalidatePreview();
      const token = ++requestToken.current;
      setSelectedSummary(summary);
      setSelectedVersion(version);
      const defaultAnchor = { x: String(viewport.centerX), y: String(viewport.centerY) };
      anchorRef.current = defaultAnchor;
      setAnchor(defaultAnchor);
      anchorEdited.current = false;
      setRecord(null);
      setInput({});
      setInputValid(true);
      setInputErrors([]);
      setError(null);
      setStatus(null);
      try {
        const next = await fetchMacroDefinition({ macroId: summary.id, macroVersion: version, canvasId });
        if (requestToken.current === token) setRecord(next);
      } catch (cause) {
        if (requestToken.current === token) setError(errorMessage(cause));
      }
    },
    [canvasId, invalidatePreview, viewport.centerX, viewport.centerY]
  );

  const handleFormChange = useCallback(
    (change: MacroFormChange) => {
      setInput(change.input);
      setInputValid(change.valid);
      setInputErrors(change.errors);
      updatePlan(null);
      setStatus(null);
    },
    [updatePlan]
  );

  const handleFormUserChange = useCallback(() => {
    invalidatePreview();
  }, [invalidatePreview]);

  const setAnchorValue = useCallback(
    (axis: 'x' | 'y', value: string) => {
      const next = { ...anchorRef.current, [axis]: value };
      anchorRef.current = next;
      anchorEdited.current = true;
      setAnchor(next);
      invalidatePreview();
    },
    [invalidatePreview]
  );

  async function preview() {
    if (!selectedSummary || !record || selectedVersion === null) return;
    if (!inputValid) {
      setError(inputErrors[0] ?? 'Complete the macro inputs before previewing.');
      return;
    }
    const x = Number(anchor.x);
    const y = Number(anchor.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      setError('Anchor X and Y must be finite numbers.');
      return;
    }
    const token = ++requestToken.current;
    const key = JSON.stringify({
      macroId: selectedSummary.id,
      macroVersion: selectedVersion,
      input,
      anchor,
      canvasRevision
    });
    previewKey.current = key;
    setPlanning(true);
    setError(null);
    setStatus(null);
    const request: Omit<MacroServicePlanRequest, 'now'> = {
      canvasId,
      macroId: selectedSummary.id,
      macroVersion: selectedVersion,
      anchor: { x, y },
      input,
      label: record.definition.title
    };
    try {
      const next = await planMacro(request);
      if (requestToken.current === token && previewKey.current === key) {
        updatePlan(next);
        setStatus(
          `Preview ready for ${next.effectSummary.generatedElementCount} element${next.effectSummary.generatedElementCount === 1 ? '' : 's'}.`
        );
      }
    } catch (cause) {
      if (requestToken.current === token && previewKey.current === key) setError(errorMessage(cause));
    } finally {
      if (requestToken.current === token && previewKey.current === key) setPlanning(false);
    }
  }

  async function execute() {
    if (!plan) return;
    if (plan.canvasRevision !== canvasRevision) {
      updatePlan(null);
      setError('The canvas changed. Preview the macro again.');
      return;
    }
    setExecuting(true);
    setError(null);
    try {
      await onExecute(plan);
      updatePlan(null);
      setStatus('Macro added to the canvas.');
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setExecuting(false);
    }
  }

  if (!open) return null;

  return (
    <aside
      id="macro-drawer"
      className="macro-drawer"
      role="dialog"
      aria-modal="false"
      aria-labelledby="macro-drawer-title"
    >
      <div className="macro-drawer-header">
        <div>
          <h2 id="macro-drawer-title">Macros</h2>
          <p>Choose a saved macro, enter its inputs, then preview before adding it.</p>
        </div>
        <button type="button" className="macro-drawer-close" aria-label="Close Macros" onClick={onClose}>
          Close
        </button>
      </div>
      <div className="macro-drawer-content">
        <label className="macro-search-label" htmlFor="macro-search">
          Search macros
        </label>
        <input
          id="macro-search"
          type="search"
          value={search}
          placeholder="Search installation and canvas macros"
          onChange={(event) => setSearch(event.target.value)}
        />
        <div className="macro-summary-list" aria-label="Available macros">
          {loading && <p className="macro-muted">Loading macros…</p>}
          {!loading && visibleSummaries.length === 0 && <p className="macro-muted">No matching macros.</p>}
          {visibleSummaries.map((summary) => (
            <button
              type="button"
              key={summary.id}
              className={`macro-summary ${selectedSummary?.id === summary.id ? 'is-selected' : ''}`}
              aria-pressed={selectedSummary?.id === summary.id}
              onClick={() => void loadExactVersion(summary, summary.currentVersion)}
            >
              <strong>{summary.title}</strong>
              <span>
                {summary.id} · v{summary.currentVersion} · {summary.scope}
              </span>
              {summary.description && <small>{summary.description}</small>}
            </button>
          ))}
        </div>
        {record && selectedSummary && selectedVersion !== null && (
          <section className="macro-editor" aria-labelledby="macro-editor-title">
            <div className="macro-editor-heading">
              <div>
                <h3 id="macro-editor-title">{record.definition.title}</h3>
                <p>{record.definition.description ?? 'Macro inputs'}</p>
              </div>
              <label htmlFor="macro-version">
                <span>Version</span>
                <select
                  id="macro-version"
                  value={selectedVersion}
                  onChange={(event) => void loadExactVersion(selectedSummary, Number(event.target.value))}
                >
                  <option value={selectedSummary.currentVersion}>{selectedSummary.currentVersion}</option>
                </select>
              </label>
            </div>
            <MacroForm
              schema={record.definition.inputSchema}
              onChange={handleFormChange}
              onUserChange={handleFormUserChange}
              disabled={executing}
            />
            <div className="macro-anchor-fields">
              <label htmlFor="macro-anchor-x">
                <span>X</span>
                <input
                  id="macro-anchor-x"
                  type="number"
                  value={anchor.x}
                  disabled={executing}
                  onChange={(event) => setAnchorValue('x', event.target.value)}
                />
              </label>
              <label htmlFor="macro-anchor-y">
                <span>Y</span>
                <input
                  id="macro-anchor-y"
                  type="number"
                  value={anchor.y}
                  disabled={executing}
                  onChange={(event) => setAnchorValue('y', event.target.value)}
                />
              </label>
            </div>
            {inputErrors.length > 0 && (
              <div className="macro-input-errors" role="status">
                {inputErrors.join(' ')}
              </div>
            )}
            <div className="macro-actions">
              <button type="button" onClick={() => void preview()} disabled={planning || executing || !inputValid}>
                {planning ? 'Previewing…' : 'Preview'}
              </button>
              <button
                type="button"
                className="macro-run-button"
                onClick={() => void execute()}
                disabled={!plan || planning || executing}
              >
                {executing ? 'Running…' : 'Run macro'}
              </button>
            </div>
            {plan && (
              <p className="macro-plan-note">
                Plan revision {plan.canvasRevision}; {plan.effectSummary.operationCount} operation
                {plan.effectSummary.operationCount === 1 ? '' : 's'} ready.
              </p>
            )}
          </section>
        )}
        <div className="macro-live-region" aria-live="polite" role="status">
          {status}
        </div>
        {error && (
          <div className="macro-error" role="alert">
            {error}
          </div>
        )}
      </div>
    </aside>
  );
}
