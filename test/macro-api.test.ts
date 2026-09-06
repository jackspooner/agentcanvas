import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { executeMacro, fetchMacroDefinition, fetchMacroList, planMacro } from '../src/web/api';

const fetchMock = vi.fn();

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

describe('macro browser API adapters', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('uses typed list, exact-get, plan, and execute routes', async () => {
    const list = { items: [{ id: 'demo/card', currentVersion: 3 }] };
    const definition = { definition: { id: 'demo/card', version: 3 }, currentVersion: 3 };
    const plan = { planId: 'plan-1' };
    const execution = { canvas: { id: 'canvas-1' }, history: { forward: [], inverse: [] } };
    fetchMock
      .mockResolvedValueOnce(jsonResponse(list))
      .mockResolvedValueOnce(jsonResponse(definition))
      .mockResolvedValueOnce(jsonResponse(plan))
      .mockResolvedValueOnce(jsonResponse(execution));

    await expect(fetchMacroList({ canvasId: 'canvas-1', includeArchived: false, limit: 10 })).resolves.toEqual(list);
    await expect(
      fetchMacroDefinition({ macroId: 'demo/card', macroVersion: 3, canvasId: 'canvas-1' })
    ).resolves.toEqual(definition);
    const planRequest = {
      canvasId: 'canvas-1',
      macroId: 'demo/card',
      macroVersion: 3,
      anchor: { x: 12, y: 24 },
      input: { title: 'Card' }
    };
    await expect(planMacro(planRequest)).resolves.toEqual(plan);
    const executeRequest = {
      canvasId: 'canvas-1',
      planId: 'plan-1',
      expectedRevision: 7,
      idempotencyKey: 'macro-key'
    };
    await expect(executeMacro(executeRequest)).resolves.toEqual(execution);

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      '/api/v1/macros?canvasId=canvas-1&includeArchived=false&limit=10',
      '/api/v1/macros/demo%2Fcard/versions/3?canvasId=canvas-1',
      '/api/v1/canvases/canvas-1/macros/demo%2Fcard:plan',
      '/api/v1/canvases/canvas-1/macros:execute'
    ]);
    expect(JSON.parse(fetchMock.mock.calls[2][1].body)).toEqual({
      macroVersion: 3,
      anchor: { x: 12, y: 24 },
      input: { title: 'Card' }
    });
    expect(JSON.parse(fetchMock.mock.calls[3][1].body)).toEqual({
      planId: 'plan-1',
      expectedRevision: 7,
      idempotencyKey: 'macro-key'
    });
  });

  it('omits canvasId when loading an exact version without a canvas scope', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ definition: {}, currentVersion: 3 }));
    await fetchMacroDefinition({ macroId: 'demo/card', macroVersion: 3 });
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/macros/demo%2Fcard/versions/3');
  });

  it('surfaces the canonical server error message without logging the payload', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ detail: 'macro input is invalid', code: 'macro_input_invalid', requestId: 'req_macro' }, 400)
    );

    await expect(fetchMacroDefinition({ macroId: 'demo/card', macroVersion: 3 })).rejects.toThrow(
      'macro input is invalid'
    );
  });
});
