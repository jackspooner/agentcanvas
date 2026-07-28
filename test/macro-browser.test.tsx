import type { BrowserElementRenderer, CanvasElement, JsonObject, JsonSchema } from '@agentcanvas/plugin-sdk';
import { fireEvent, render, waitFor } from '@testing-library/react';
import React, { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MacroDefinitionRecord, MacroExecutionResult, MacroPlan, MacroSummary } from '../src/macros/types';
import type { CanvasOperation } from '../src/contracts';
import { CanvasView } from '../src/web/components/CanvasView';
import { MacroForm } from '../src/web/components/MacroForm';
import { MacroDrawer } from '../src/web/components/MacroDrawer';
import type { LoadedBrowserRegistry } from '../src/web/plugins/catalog';
import type { CanvasDocument, CanvasViewportState } from '../src/web/v2-types';
import { validateMacroInput } from '../src/macros/input-validation';
import { applyMacroInputDefaults } from '../src/macros/input-defaults';
import macroFormSource from '../src/web/components/MacroForm.tsx?raw';
import inputDefaultsSource from '../src/macros/input-defaults.ts?raw';

const api = vi.hoisted(() => ({
  fetchMacroList: vi.fn(),
  fetchMacroDefinition: vi.fn(),
  planMacro: vi.fn()
}));

vi.mock('../src/web/api', () => api);

const renderer: BrowserElementRenderer = {
  type: 'fixture.cards/card',
  schemaVersions: [1],
  placement: 'node',
  mount(root, context) {
    const element = document.createElement('div');
    element.textContent = String(context.element.data.title ?? 'ghost');
    root.replaceChildren(element);
    return { update: () => undefined, dispose: () => root.replaceChildren() };
  }
};

function registry(): LoadedBrowserRegistry {
  return {
    plugins: { plugins: [] },
    renderers: new Map([[renderer.type, renderer]]),
    commands: new Map(),
    diagnostics: [],
    dispose: async () => undefined
  };
}

function canvas(revision = 1, elements: CanvasElement[] = []): CanvasDocument {
  return {
    id: 'canvas_macros',
    title: 'Macros canvas',
    createdBy: 'agent',
    createdAt: '2026-07-27T00:00:00.000Z',
    updatedAt: `2026-07-27T00:00:0${revision}.000Z`,
    bounds: { mode: 'unlimited' },
    revision,
    documentVersion: 2,
    elements
  };
}

const definition: MacroDefinitionRecord = {
  definition: {
    id: 'fixture/cards',
    version: 2,
    scope: 'installation',
    title: 'Card macro',
    description: 'Creates a card.',
    inputSchema: {
      type: 'object',
      required: ['title', 'count'],
      properties: {
        title: { type: 'string', format: 'textarea', default: 'Card' },
        count: { type: 'number', default: 1 },
        enabled: { type: 'boolean', default: true },
        tone: { enum: ['blue', 'neutral'], default: 'blue' },
        tags: { type: 'array', default: [] },
        metadata: { type: 'object', default: {} }
      }
    },
    elements: []
  },
  currentVersion: 2,
  archived: false
};

const summary: MacroSummary = {
  id: 'fixture/cards',
  scope: 'installation',
  currentVersion: 2,
  archived: false,
  title: 'Card macro',
  description: 'Creates a card.',
  createdAt: '2026-07-27T00:00:00.000Z',
  updatedAt: '2026-07-27T00:00:00.000Z'
};

const ghost: CanvasElement = {
  id: 'macro-card-1',
  type: 'fixture.cards/card',
  schemaVersion: 1,
  x: 120,
  y: 80,
  width: 160,
  height: 80,
  data: { title: 'Preview card' }
};

const plan: MacroPlan = {
  planId: 'macro_plan_preview',
  macroId: summary.id,
  macroVersion: 2,
  canvasId: 'canvas_macros',
  canvasRevision: 1,
  anchor: { x: 100, y: 60 },
  inputDigest: 'a'.repeat(64),
  planDigest: 'b'.repeat(64),
  createdAt: '2026-07-27T00:00:00.000Z',
  expiresAt: '2026-07-27T00:05:00.000Z',
  operations: [{ op: 'upsertElement', element: ghost }],
  previewElements: [ghost],
  outputs: {},
  effectSummary: { label: 'Card macro', operationCount: 1, generatedElementCount: 1, affectedElementIds: [ghost.id] }
};

function executionResult(): MacroExecutionResult {
  return {
    canvas: canvas(2, [ghost]),
    provenance: {
      macroId: summary.id,
      macroVersion: 2,
      planId: plan.planId,
      inputDigest: plan.inputDigest,
      planDigest: plan.planDigest
    },
    outputs: {},
    history: {
      label: 'Card macro',
      forward: plan.operations,
      inverse: [{ op: 'deleteElement', elementId: ghost.id }],
      affectedElementIds: [ghost.id]
    }
  };
}

beforeEach(() => {
  api.fetchMacroList.mockClear();
  api.fetchMacroDefinition.mockClear();
  api.planMacro.mockClear();
  api.fetchMacroList.mockResolvedValue({ items: [summary] });
  api.fetchMacroDefinition.mockResolvedValue(definition);
  api.planMacro.mockResolvedValue(plan);
});

describe('macro form and drawer', () => {
  it('renders primitive, enum, and JSON controls with defaults', async () => {
    const onChange = vi.fn();
    const { getByLabelText } = render(<MacroForm schema={definition.definition.inputSchema} onChange={onChange} />);
    expect(getByLabelText(/^title/)).toBeInstanceOf(HTMLTextAreaElement);
    expect((getByLabelText(/^count/) as HTMLInputElement).value).toBe('1');
    expect((getByLabelText(/^enabled/) as HTMLInputElement).checked).toBe(true);
    expect((getByLabelText(/^tone/) as HTMLSelectElement).value).toBe('"blue"');
    expect(getByLabelText(/^tags/)).toBeInstanceOf(HTMLTextAreaElement);
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ valid: true })));
  });

  it('reports invalid JSON and blocks preview until corrected', async () => {
    const onChange = vi.fn();
    const { getByLabelText, getByText } = render(
      <MacroForm schema={definition.definition.inputSchema} onChange={onChange} />
    );
    fireEvent.change(getByLabelText(/^tags/), { target: { value: '{' } });
    expect(getByText('Enter valid JSON.')).toBeTruthy();
    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ valid: false })));
  });

  it('loads an exact current version and plans only after explicit Preview', async () => {
    const onExecute = vi.fn(async () => undefined);
    const onPlanChange = vi.fn();
    const { getByRole, getByLabelText } = render(
      <MacroDrawer
        canvasId="canvas_macros"
        canvasRevision={1}
        viewport={{ centerX: 100, centerY: 60, zoom: 1, width: 800, height: 600, source: 'user', updatedAt: null }}
        selectionInvalidationToken=""
        open
        onClose={vi.fn()}
        onPlanChange={onPlanChange}
        onExecute={onExecute}
      />
    );
    await waitFor(() => expect(getByRole('button', { name: /Card macro/ })).toBeTruthy());
    fireEvent.click(getByRole('button', { name: /Card macro/ }));
    await waitFor(() =>
      expect(api.fetchMacroDefinition).toHaveBeenCalledWith({
        macroId: summary.id,
        macroVersion: 2,
        canvasId: 'canvas_macros'
      })
    );
    expect(api.planMacro).not.toHaveBeenCalled();
    fireEvent.click(getByRole('button', { name: 'Preview' }));
    await waitFor(() => expect(api.planMacro).toHaveBeenCalled());
    await waitFor(() => expect(onPlanChange).toHaveBeenLastCalledWith(plan));
    expect((getByLabelText('Version') as HTMLSelectElement).value).toBe('2');
  });

  it('clears planning state and ignores a deferred preview after invalidation', async () => {
    let resolvePlan!: (value: MacroPlan) => void;
    api.planMacro.mockImplementationOnce(
      () =>
        new Promise<MacroPlan>((resolve) => {
          resolvePlan = resolve;
        })
    );
    const onPlanChange = vi.fn();
    const { getByRole, getByLabelText } = render(
      <MacroDrawer
        canvasId="canvas_macros"
        canvasRevision={1}
        viewport={{ centerX: 100, centerY: 60, zoom: 1, width: 800, height: 600, source: 'user', updatedAt: null }}
        selectionInvalidationToken=""
        open
        onClose={vi.fn()}
        onPlanChange={onPlanChange}
        onExecute={vi.fn(async () => undefined)}
      />
    );
    await waitFor(() => expect(getByRole('button', { name: /Card macro/ })).toBeTruthy());
    fireEvent.click(getByRole('button', { name: /Card macro/ }));
    await waitFor(() => expect(getByRole('button', { name: 'Preview' })).toBeTruthy());
    fireEvent.click(getByRole('button', { name: 'Preview' }));
    await waitFor(() => expect(api.planMacro).toHaveBeenCalled());
    fireEvent.change(getByLabelText('X'), { target: { value: '200' } });
    resolvePlan(plan);
    await waitFor(() => expect((getByRole('button', { name: 'Preview' }) as HTMLButtonElement).disabled).toBe(false));
    expect(onPlanChange).toHaveBeenLastCalledWith(null);
  });

  it('follows viewport center until either anchor coordinate is edited', async () => {
    const onPlanChange = vi.fn();
    const view = {
      centerX: 100,
      centerY: 60,
      zoom: 1,
      width: 800,
      height: 600,
      source: 'user' as const,
      updatedAt: null
    };
    const { getByRole, getByLabelText, rerender } = render(
      <MacroDrawer
        canvasId="canvas_macros"
        canvasRevision={1}
        viewport={view}
        selectionInvalidationToken=""
        open
        onClose={vi.fn()}
        onPlanChange={onPlanChange}
        onExecute={vi.fn(async () => undefined)}
      />
    );
    await waitFor(() => expect(getByRole('button', { name: /Card macro/ })).toBeTruthy());
    fireEvent.click(getByRole('button', { name: /Card macro/ }));
    await waitFor(() => expect((getByLabelText('X') as HTMLInputElement).value).toBe('100'));
    rerender(
      <MacroDrawer
        canvasId="canvas_macros"
        canvasRevision={1}
        viewport={{ ...view, centerX: 140, centerY: 80 }}
        selectionInvalidationToken=""
        open
        onClose={vi.fn()}
        onPlanChange={onPlanChange}
        onExecute={vi.fn(async () => undefined)}
      />
    );
    await waitFor(() => expect((getByLabelText('X') as HTMLInputElement).value).toBe('140'));
    fireEvent.change(getByLabelText('X'), { target: { value: '200' } });
    rerender(
      <MacroDrawer
        canvasId="canvas_macros"
        canvasRevision={1}
        viewport={{ ...view, centerX: 300, centerY: 220 }}
        selectionInvalidationToken=""
        open
        onClose={vi.fn()}
        onPlanChange={onPlanChange}
        onExecute={vi.fn(async () => undefined)}
      />
    );
    await waitFor(() => expect((getByLabelText('X') as HTMLInputElement).value).toBe('200'));
    fireEvent.click(getByRole('button', { name: /Card macro/ }));
    await waitFor(() => expect((getByLabelText('X') as HTMLInputElement).value).toBe('300'));
    expect((getByLabelText('Y') as HTMLInputElement).value).toBe('220');
  });
});

function CanvasHarness({
  onRun,
  onOperations,
  loadViewport
}: {
  onRun: (result: MacroExecutionResult) => void;
  onOperations?: (operations: readonly CanvasOperation[]) => void;
  loadViewport?: () => Promise<CanvasViewportState>;
}) {
  const [current, setCurrent] = useState(() => canvas());
  return (
    <CanvasView
      canvas={current}
      elementRuntime={{}}
      diagnostics={[]}
      browserRegistry={registry()}
      initialViewport={{ centerX: 100, centerY: 60, zoom: 1, width: 800, height: 600, source: 'user', updatedAt: null }}
      loadViewport={loadViewport}
      onMacroExecute={async () => {
        const result = executionResult();
        onRun(result);
        setCurrent(result.canvas as CanvasDocument);
        return result;
      }}
      onCanvasOperations={async (operations) => {
        onOperations?.(operations);
        const next = canvas(
          current.revision + 1,
          operations[0]?.op === 'upsertElement' ? [operations[0].element as CanvasElement] : []
        );
        setCurrent(next);
        return next;
      }}
    />
  );
}

describe('macro canvas lifecycle', () => {
  it('keeps preview explicit, renders a noninteractive ghost, and invalidates it on anchor change', async () => {
    const { container, getByRole, getByLabelText } = render(<CanvasHarness onRun={vi.fn()} />);
    fireEvent.click(getByRole('button', { name: 'Macros' }));
    await waitFor(() => expect(getByRole('button', { name: /Card macro/ })).toBeTruthy());
    fireEvent.click(getByRole('button', { name: /Card macro/ }));
    await waitFor(() => expect(getByRole('button', { name: 'Preview' })).toBeTruthy());
    expect(container.querySelector('[data-testid="macro-ghost-preview"]')).toBeNull();
    fireEvent.click(getByRole('button', { name: 'Preview' }));
    await waitFor(() => expect(api.planMacro).toHaveBeenCalled());
    await waitFor(() => expect(container.querySelector('[data-testid="macro-ghost-preview"]')).not.toBeNull());
    expect(container.querySelector('[data-macro-ghost="true"]')?.className).toContain('macro-ghost-element');
    expect((container.querySelector('[data-macro-ghost="true"]') as HTMLElement).style.pointerEvents).toBe('none');
    fireEvent.change(getByLabelText('X'), { target: { value: '200' } });
    await waitFor(() => expect(container.querySelector('[data-testid="macro-ghost-preview"]')).toBeNull());
  });

  it('invalidates a preview when the real canvas selection changes', async () => {
    const existing: CanvasElement = {
      id: 'existing-card',
      type: 'fixture.cards/card',
      schemaVersion: 1,
      x: 20,
      y: 20,
      width: 160,
      height: 80,
      data: { title: 'Existing card' }
    };
    const { container, getByRole } = render(
      <CanvasView
        canvas={canvas(1, [existing])}
        elementRuntime={{}}
        diagnostics={[]}
        browserRegistry={registry()}
        initialViewport={{
          centerX: 100,
          centerY: 60,
          zoom: 1,
          width: 800,
          height: 600,
          source: 'user',
          updatedAt: null
        }}
      />
    );
    fireEvent.click(getByRole('button', { name: 'Macros' }));
    await waitFor(() => expect(getByRole('button', { name: /Card macro/ })).toBeTruthy());
    fireEvent.click(getByRole('button', { name: /Card macro/ }));
    await waitFor(() => expect(getByRole('button', { name: 'Preview' })).toBeTruthy());
    fireEvent.click(getByRole('button', { name: 'Preview' }));
    await waitFor(() => expect(container.querySelector('[data-testid="macro-ghost-preview"]')).not.toBeNull());
    expect((getByRole('button', { name: 'Run macro' }) as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(container.querySelector('[data-element-id="existing-card"]') as Element);
    await waitFor(() => expect(container.querySelector('[data-testid="macro-ghost-preview"]')).toBeNull());
    expect((getByRole('button', { name: 'Run macro' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('suppresses a deferred preview response after a real canvas selection change', async () => {
    const existing: CanvasElement = {
      id: 'existing-card',
      type: 'fixture.cards/card',
      schemaVersion: 1,
      x: 20,
      y: 20,
      width: 160,
      height: 80,
      data: { title: 'Existing card' }
    };
    let resolvePlan!: (value: MacroPlan) => void;
    api.planMacro.mockImplementationOnce(
      () =>
        new Promise<MacroPlan>((resolve) => {
          resolvePlan = resolve;
        })
    );
    const { container, getByRole } = render(
      <CanvasView
        canvas={canvas(1, [existing])}
        elementRuntime={{}}
        diagnostics={[]}
        browserRegistry={registry()}
        initialViewport={{
          centerX: 100,
          centerY: 60,
          zoom: 1,
          width: 800,
          height: 600,
          source: 'user',
          updatedAt: null
        }}
      />
    );
    fireEvent.click(getByRole('button', { name: 'Macros' }));
    await waitFor(() => expect(getByRole('button', { name: /Card macro/ })).toBeTruthy());
    fireEvent.click(getByRole('button', { name: /Card macro/ }));
    await waitFor(() => expect(getByRole('button', { name: 'Preview' })).toBeTruthy());
    fireEvent.click(getByRole('button', { name: 'Preview' }));
    await waitFor(() => expect(api.planMacro).toHaveBeenCalled());
    fireEvent.click(container.querySelector('[data-element-id="existing-card"]') as Element);
    resolvePlan(plan);
    await waitFor(() => expect((getByRole('button', { name: 'Run macro' }) as HTMLButtonElement).disabled).toBe(true));
    expect(container.querySelector('[data-testid="macro-ghost-preview"]')).toBeNull();
  });

  it('hides macro controls in read-only shares', () => {
    const { queryByRole } = render(
      <CanvasView canvas={canvas()} elementRuntime={{}} diagnostics={[]} browserRegistry={registry()} readOnly />
    );
    expect(queryByRole('button', { name: 'Macros' })).toBeNull();
  });

  it('records one successful history entry and applies inverse then forward operations', async () => {
    const onRun = vi.fn();
    const operations: CanvasOperation[][] = [];
    const { container, getByRole } = render(
      <CanvasHarness onRun={onRun} onOperations={(next) => operations.push([...next])} />
    );
    fireEvent.click(getByRole('button', { name: 'Macros' }));
    await waitFor(() => expect(getByRole('button', { name: /Card macro/ })).toBeTruthy());
    fireEvent.click(getByRole('button', { name: /Card macro/ }));
    await waitFor(() => expect(getByRole('button', { name: 'Preview' })).toBeTruthy());
    fireEvent.click(getByRole('button', { name: 'Preview' }));
    await waitFor(() => expect((getByRole('button', { name: 'Run macro' }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(getByRole('button', { name: 'Run macro' }));
    await waitFor(() => expect(onRun).toHaveBeenCalledOnce());
    expect(operations).toHaveLength(0);
    const shell = container.querySelector('.canvas-shell') as HTMLElement;
    fireEvent.keyDown(shell, { key: 'z', ctrlKey: true });
    await waitFor(() => expect(operations).toHaveLength(1));
    expect(operations[0]).toEqual([{ op: 'deleteElement', elementId: ghost.id }]);
    fireEvent.keyDown(shell, { key: 'y', ctrlKey: true });
    await waitFor(() => expect(operations).toHaveLength(2));
    expect(operations[1]).toEqual(plan.operations);
  });

  it('preserves macro history while viewport polling refreshes the view', async () => {
    const operations: CanvasOperation[][] = [];
    const loadViewport = vi.fn(
      async () =>
        ({
          userViewport: {
            centerX: 100,
            centerY: 60,
            zoom: 1,
            width: 800,
            height: 600,
            source: 'user',
            updatedAt: null
          },
          agentViewport: null
        }) satisfies CanvasViewportState
    );
    const { getByRole } = render(
      <CanvasHarness onRun={vi.fn()} onOperations={(next) => operations.push([...next])} loadViewport={loadViewport} />
    );
    fireEvent.click(getByRole('button', { name: 'Macros' }));
    await waitFor(() => expect(getByRole('button', { name: /Card macro/ })).toBeTruthy());
    fireEvent.click(getByRole('button', { name: /Card macro/ }));
    await waitFor(() => expect(getByRole('button', { name: 'Preview' })).toBeTruthy());
    fireEvent.click(getByRole('button', { name: 'Preview' }));
    await waitFor(() => expect((getByRole('button', { name: 'Run macro' }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(getByRole('button', { name: 'Run macro' }));
    await waitFor(() => expect(loadViewport).toHaveBeenCalled());
    expect(loadViewport).toHaveBeenCalled();
    fireEvent.click(getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(operations).toHaveLength(1));
  });

  it('does not record a failed execution', async () => {
    const failed = vi.fn(async () => {
      throw new Error('macro execution failed');
    });
    const { getByRole, getByLabelText, findByRole } = render(
      <CanvasView
        canvas={canvas()}
        elementRuntime={{}}
        diagnostics={[]}
        browserRegistry={registry()}
        onMacroExecute={failed}
      />
    );
    fireEvent.click(getByRole('button', { name: 'Macros' }));
    await waitFor(() => expect(getByRole('button', { name: /Card macro/ })).toBeTruthy());
    fireEvent.click(getByRole('button', { name: /Card macro/ }));
    await waitFor(() => expect(getByRole('button', { name: 'Preview' })).toBeTruthy());
    fireEvent.click(getByRole('button', { name: 'Preview' }));
    await waitFor(() => expect((getByRole('button', { name: 'Run macro' }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(getByRole('button', { name: 'Run macro' }));
    expect((await findByRole('alert')).textContent).toContain('macro execution failed');
  });

  it('reuses an execution idempotency key after failure and changes it for a new plan', async () => {
    const requests: string[] = [];
    let failures = 1;
    const onMacroExecute = vi.fn(async (request) => {
      requests.push(request.idempotencyKey);
      if (failures > 0) {
        failures -= 1;
        throw new Error('network failure');
      }
      return executionResult();
    });
    const { getByRole, getByLabelText, findByRole } = render(
      <CanvasView
        canvas={canvas()}
        elementRuntime={{}}
        diagnostics={[]}
        browserRegistry={registry()}
        onMacroExecute={onMacroExecute}
      />
    );
    fireEvent.click(getByRole('button', { name: 'Macros' }));
    await waitFor(() => expect(getByRole('button', { name: /Card macro/ })).toBeTruthy());
    fireEvent.click(getByRole('button', { name: /Card macro/ }));
    await waitFor(() => expect(getByRole('button', { name: 'Preview' })).toBeTruthy());
    fireEvent.click(getByRole('button', { name: 'Preview' }));
    await waitFor(() => expect((getByRole('button', { name: 'Run macro' }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(getByRole('button', { name: 'Run macro' }));
    await findByRole('alert');
    fireEvent.click(getByRole('button', { name: 'Run macro' }));
    await waitFor(() => expect(onMacroExecute).toHaveBeenCalledTimes(2));
    expect(requests[0]).toBe(requests[1]);

    api.planMacro.mockResolvedValueOnce({ ...plan, planId: 'macro_plan_new', anchor: { x: 200, y: 60 } });
    fireEvent.change(getByLabelText('X'), { target: { value: '200' } });
    await waitFor(() => expect(getByRole('button', { name: 'Preview' })).toBeTruthy());
    fireEvent.click(getByRole('button', { name: 'Preview' }));
    await waitFor(() => expect((getByRole('button', { name: 'Run macro' }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(getByRole('button', { name: 'Run macro' }));
    await waitFor(() => expect(onMacroExecute).toHaveBeenCalledTimes(3));
    expect(requests[2]).not.toBe(requests[0]);
  });
});

describe('canonical macro input validation', () => {
  const nestedSchema = {
    type: 'object',
    required: ['settings'],
    properties: {
      settings: {
        type: 'object',
        required: ['name', 'rows'],
        properties: {
          name: { type: 'string', default: 'defaultname', pattern: '^[a-z]+$' },
          rows: {
            type: 'array',
            minItems: 1,
            items: { type: 'object', required: ['code'], properties: { code: { type: 'string', pattern: '^[A-Z]+$' } } }
          }
        }
      }
    }
  } as JsonSchema;

  it('keeps browser defaults identical to planner defaults', () => {
    const raw = { settings: { rows: [{ code: 'OK' }] } };
    expect(applyMacroInputDefaults(nestedSchema, raw)).toEqual(validateMacroInput(nestedSchema, raw).input);
  });

  it('applies nested defaults without deciding semantic validity locally', () => {
    expect(applyMacroInputDefaults(nestedSchema, { settings: { rows: [{ code: 'OK' }] } })).toEqual({
      settings: { name: 'defaultname', rows: [{ code: 'OK' }] }
    });
  });

  it('accepts valid nested JSON after editor parsing', async () => {
    const changes: Array<{ valid: boolean; input: unknown }> = [];
    const { getByLabelText } = render(
      <MacroForm
        schema={nestedSchema}
        onChange={(change) => changes.push({ valid: change.valid, input: change.input })}
      />
    );
    fireEvent.change(getByLabelText(/^settings/), {
      target: { value: '{"rows":[{"code":"OK"}]}' }
    });
    await waitFor(() => expect(changes.at(-1)).toMatchObject({ valid: true }));
    expect(changes.at(-1)?.input).toEqual({ settings: { name: 'defaultname', rows: [{ code: 'OK' }] } });
  });

  it('submits semantically invalid nested JSON to planning and keeps no ghost or run state', async () => {
    const nestedDefinition = {
      ...definition,
      definition: { ...definition.definition, inputSchema: nestedSchema as JsonObject }
    } satisfies MacroDefinitionRecord;
    api.fetchMacroDefinition.mockResolvedValueOnce(nestedDefinition);
    api.planMacro.mockRejectedValueOnce(new Error('macro input does not satisfy the input schema'));
    const { getByLabelText, getByRole, queryByRole, queryByTestId } = render(
      <MacroDrawer
        canvasId="canvas_macros"
        canvasRevision={1}
        viewport={{ centerX: 100, centerY: 60, zoom: 1, width: 800, height: 600, source: 'user', updatedAt: null }}
        selectionInvalidationToken=""
        open
        onClose={vi.fn()}
        onPlanChange={vi.fn()}
        onExecute={vi.fn(async () => undefined)}
      />
    );
    await waitFor(() => expect(getByRole('button', { name: /Card macro/ })).toBeTruthy());
    fireEvent.click(getByRole('button', { name: /Card macro/ }));
    await waitFor(() => expect(getByLabelText(/^settings/)).toBeTruthy());
    fireEvent.change(getByLabelText(/^settings/), {
      target: { value: '{"name":"Bad Name","rows":[]}' }
    });
    await waitFor(() => expect((getByRole('button', { name: 'Preview' }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(getByRole('button', { name: 'Preview' }));
    await waitFor(() =>
      expect(api.planMacro).toHaveBeenCalledWith(
        expect.objectContaining({
          input: { settings: { name: 'Bad Name', rows: [] } }
        })
      )
    );
    expect(getByRole('alert').textContent).toContain('macro input does not satisfy the input schema');
    expect(queryByTestId('macro-ghost-preview')).toBeNull();
    expect((queryByRole('button', { name: 'Run macro' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('keeps MacroForm and its default helper free of Ajv browser imports', () => {
    expect(macroFormSource).not.toContain('Ajv');
    expect(inputDefaultsSource).not.toContain('Ajv');
  });
});
