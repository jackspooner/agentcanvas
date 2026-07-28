import { describe, expect, it, vi } from 'vitest';
import type { CanvasElement, JsonObject } from '@agentcanvas/plugin-sdk';
import type { CanvasOperation } from '../src/contracts.js';
import {
  InMemoryMacroPlanStore,
  MacroError,
  MacroPlanner,
  MacroService,
  validateMacroDefinition,
  type MacroCanvasSnapshot,
  type MacroDefinitionV1,
  type MacroRepository,
  type MacroAtomicExecutor,
  type MacroAtomicExecutionRequest,
  type MacroPlan
} from '../src/macros/index.js';

const NOW = Date.parse('2026-07-27T10:00:00.000Z');
const ORIGIN = { x: 0, y: 0 };
const identityElementValidator = (element: CanvasElement): CanvasElement => element;

function definition(overrides: Partial<MacroDefinitionV1> = {}): MacroDefinitionV1 {
  return {
    id: 'fixture/table',
    version: 1,
    scope: 'installation',
    title: 'Insert table',
    description: 'A deterministic table macro',
    category: 'tables',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['rows'],
      properties: {
        rows: {
          type: 'array',
          items: {
            type: 'object',
            required: ['label'],
            properties: { label: { type: 'string' } },
            additionalProperties: false
          }
        }
      }
    },
    elements: [
      {
        key: 'table',
        type: 'fixture/table',
        schemaVersion: 2,
        x: 10,
        y: 20,
        width: 400,
        height: 200,
        data: { rows: { $macroRef: 'input', pointer: '/rows' } as JsonObject, source: 'macro' },
        style: { owner: { $macroRef: 'input', pointer: '/rows' } as JsonObject },
        metadata: { generated: { $macroRef: 'generatedElementId', elementKey: 'table' } as JsonObject }
      }
    ],
    outputs: { table: 'table' },
    ...overrides
  };
}

function canvas(overrides: Partial<MacroCanvasSnapshot> = {}): MacroCanvasSnapshot {
  return { id: 'canvas-1', revision: 4, elements: [], bounds: { mode: 'unlimited' }, ...overrides };
}

function plan(
  overrides: Partial<MacroDefinitionV1> = {},
  requestInput: JsonObject = { rows: [{ label: 'A' }] },
  anchor = ORIGIN
): MacroPlan {
  return new MacroPlanner({ now: () => NOW, validateElement: identityElementValidator }).plan(
    definition(overrides),
    { canvasId: 'canvas-1', anchor, input: requestInput, now: NOW },
    canvas()
  );
}

describe('AgentCanvas Macros v1 domain', () => {
  it('validates definitions, applies AJV defaults, expands refs, and preserves fixed geometry', () => {
    const macro = definition({
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: { rows: { type: 'array' }, theme: { type: 'string', default: 'plain' } }
      },
      elements: [
        {
          ...definition().elements[0],
          data: {
            rows: { $macroRef: 'input', pointer: '/rows' },
            theme: { $macroRef: 'input', pointer: '/theme' },
            id: { $macroRef: 'generatedElementId', elementKey: 'table' }
          }
        }
      ]
    });
    const result = new MacroPlanner({ now: () => NOW, validateElement: identityElementValidator }).plan(
      macro,
      { canvasId: 'canvas-1', anchor: ORIGIN, input: { rows: [] }, now: NOW },
      canvas()
    );
    expect(result).not.toHaveProperty('input');
    expect(result.previewElements[0]).toMatchObject({
      x: 10,
      y: 20,
      width: 400,
      height: 200,
      data: { theme: 'plain' }
    });
    expect(result.previewElements[0].data.id).toBe(result.previewElements[0].id);
  });

  it('allows literal payload/schema content and rejects only unsafe external refs and unexpected structural fields', () => {
    const macro = definition({
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          rows: { type: 'array' },
          code: { type: 'string' },
          query: { type: 'string' },
          agent: { type: 'string' }
        }
      },
      elements: [
        {
          ...definition().elements[0],
          data: { code: 'return 1', query: '${rows}', agent: '{{agent}}', literal: '}}' }
        }
      ]
    });
    expect(plan({ inputSchema: macro.inputSchema, elements: macro.elements }, { rows: [] })).toMatchObject({
      previewElements: [{ data: { code: 'return 1', query: '${rows}', agent: '{{agent}}', literal: '}}' } }]
    });
    expect(() =>
      validateMacroDefinition({ ...definition(), inputSchema: { type: 'object', $ref: 'https://example.test/schema' } })
    ).toThrowError(expect.objectContaining({ code: 'macro_unsafe' }));
    expect(() => validateMacroDefinition({ ...definition(), unexpected: true } as unknown)).toThrowError(
      expect.objectContaining({ code: 'macro_definition_invalid' })
    );
    expect(() =>
      validateMacroDefinition({
        ...definition(),
        elements: [{ ...definition().elements[0], ref: 'unexpected' }]
      } as unknown)
    ).toThrowError(expect.objectContaining({ code: 'macro_definition_invalid' }));
    expect(() =>
      plan({ elements: [{ ...definition().elements[0], data: { value: { $macroRef: 'input', pointer: '/rows~2' } } }] })
    ).toThrowError(expect.objectContaining({ code: 'macro_ref_pointer_invalid' }));
    expect(() =>
      plan({
        elements: [{ ...definition().elements[0], data: { value: { $macroRef: 'input', pointer: '/missing' } } }]
      })
    ).toThrowError(expect.objectContaining({ code: 'macro_ref_missing' }));
    expect(() =>
      plan({
        elements: [{ ...definition().elements[0], data: { value: { $macroRef: 'input', pointer: '/rows/0/nope' } } }]
      })
    ).toThrowError(expect.objectContaining({ code: 'macro_ref_missing' }));
  });

  it('preserves draft 2020-12 defaults resolved through local schema references', () => {
    expect(
      plan(
        {
          inputSchema: {
            type: 'object',
            additionalProperties: false,
            properties: { settings: { $ref: '#/$defs/settings' } },
            $defs: {
              settings: {
                type: 'object',
                additionalProperties: false,
                properties: { theme: { type: 'string', default: 'referenced-default' } }
              }
            }
          },
          elements: [
            {
              ...definition().elements[0],
              data: { theme: { $macroRef: 'input', pointer: '/settings/theme' } },
              style: null,
              metadata: {}
            }
          ]
        },
        { settings: {} }
      )
    ).toMatchObject({
      previewElements: [{ data: { theme: 'referenced-default' } }]
    });
  });

  it('requires an object-shaped input schema and preserves dependency contracts', () => {
    expect(() =>
      validateMacroDefinition({ ...definition(), inputSchema: { type: 'array', items: { type: 'string' } } })
    ).toThrowError(expect.objectContaining({ code: 'macro_definition_invalid' }));
    const dependency = { elementType: 'fixture/table', schemaVersion: 2 };
    expect(() => validateMacroDefinition({ ...definition(), dependencies: [dependency, dependency] })).toThrowError(
      expect.objectContaining({ code: 'macro_definition_invalid' })
    );
    expect(() =>
      validateMacroDefinition({ ...definition(), dependencies: [{ elementType: 'fixture/table', schemaVersion: 0 }] })
    ).toThrowError(expect.objectContaining({ code: 'macro_definition_invalid' }));
    expect(() =>
      validateMacroDefinition({ ...definition(), dependencies: [{ elementType: 'Fixture/Table', schemaVersion: 2 }] })
    ).toThrowError(expect.objectContaining({ code: 'macro_definition_invalid' }));
    expect(() => plan({ dependencies: [dependency] })).toThrowError(
      expect.objectContaining({ code: 'macro_dependency_missing' })
    );
    const validateDependencies = vi.fn();
    const planned = new MacroPlanner({
      now: () => NOW,
      validateElement: identityElementValidator,
      validateDependencies
    }).plan(
      definition({ dependencies: [dependency] }),
      { canvasId: 'canvas-1', anchor: ORIGIN, input: { rows: [] }, now: NOW },
      canvas()
    );
    expect(planned.operations).toHaveLength(1);
    expect(validateDependencies).toHaveBeenCalledWith([dependency], expect.objectContaining({ canvasId: 'canvas-1' }));
  });

  it('requires element validation and translates offsets from the invocation anchor before bounds checks', () => {
    expect(() =>
      new MacroPlanner({ now: () => NOW }).plan(
        definition(),
        { canvasId: 'canvas-1', anchor: ORIGIN, input: { rows: [] }, now: NOW },
        canvas()
      )
    ).toThrowError(expect.objectContaining({ code: 'macro_element_invalid' }));
    const planner = new MacroPlanner({ now: () => NOW, validateElement: identityElementValidator });
    const translated = planner.plan(
      definition(),
      { canvasId: 'canvas-1', anchor: { x: -5, y: -10 }, input: { rows: [] }, now: NOW },
      canvas({ bounds: { mode: 'fixed', width: 500, height: 250 } })
    );
    const origin = planner.plan(
      definition(),
      { canvasId: 'canvas-1', anchor: ORIGIN, input: { rows: [] }, now: NOW },
      canvas()
    );
    expect(translated.anchor).toEqual({ x: -5, y: -10 });
    expect(translated.previewElements[0]).toMatchObject({ x: 5, y: 10 });
    expect(translated.planId).not.toBe(origin.planId);
    expect(translated.previewElements[0].id).not.toBe(origin.previewElements[0].id);
    expect(() =>
      planner.plan(
        definition(),
        { canvasId: 'canvas-1', anchor: { x: 100, y: 0 }, input: { rows: [] }, now: NOW },
        canvas({ bounds: { mode: 'fixed', width: 500, height: 250 } })
      )
    ).toThrowError(expect.objectContaining({ code: 'macro_element_invalid' }));
    expect(() =>
      planner.plan(
        definition(),
        { canvasId: 'canvas-1', anchor: { x: Number.NaN, y: 0 }, input: { rows: [] }, now: NOW },
        canvas()
      )
    ).toThrowError(expect.objectContaining({ code: 'macro_definition_invalid' }));
  });

  it('uses scope, archive, and exact-version repository checks', () => {
    const record = {
      definition: definition({ scope: 'canvas', canvasId: 'canvas-1' }),
      currentVersion: 1,
      archived: false
    };
    const repo: MacroRepository = {
      getDefinition: vi.fn(() => record),
      getCanvas: vi.fn(() => canvas())
    };
    const executor: MacroAtomicExecutor = {
      executeMacro: vi.fn((request) => ({
        canvas: canvas({ revision: 5 }),
        provenance: request.provenance,
        outputs: request.outputs,
        history: request.history
      }))
    };
    const service = new MacroService(
      repo,
      new MacroPlanner({ now: () => NOW, validateElement: identityElementValidator }),
      new InMemoryMacroPlanStore({ now: () => NOW }),
      executor
    );
    expect(
      service.plan({
        canvasId: 'canvas-1',
        macroId: 'fixture/table',
        macroVersion: 1,
        anchor: ORIGIN,
        input: { rows: [] },
        now: NOW
      })
    ).toMatchObject({ canvasRevision: 4, anchor: ORIGIN });
    expect(() =>
      service.plan({
        canvasId: 'canvas-2',
        macroId: 'fixture/table',
        macroVersion: 1,
        anchor: ORIGIN,
        input: { rows: [] },
        now: NOW
      })
    ).toThrowError(expect.objectContaining({ code: 'macro_scope_denied' }));
    (repo.getDefinition as ReturnType<typeof vi.fn>).mockReturnValue({
      definition: definition(),
      currentVersion: 1,
      archived: true
    });
    expect(() =>
      service.plan({
        canvasId: 'canvas-1',
        macroId: 'fixture/table',
        macroVersion: 1,
        anchor: ORIGIN,
        input: { rows: [] },
        now: NOW
      })
    ).toThrowError(expect.objectContaining({ code: 'macro_archived' }));
    (repo.getDefinition as ReturnType<typeof vi.fn>).mockReturnValue(definition({ version: 2 }));
    expect(() =>
      service.plan({
        canvasId: 'canvas-1',
        macroId: 'fixture/table',
        macroVersion: 1,
        anchor: ORIGIN,
        input: { rows: [] },
        now: NOW
      })
    ).toThrowError(expect.objectContaining({ code: 'macro_version_mismatch' }));
  });

  it('distinguishes an unavailable exact version and an execution-time revision conflict', async () => {
    const missingVersionRepository: MacroRepository = {
      getDefinition: vi.fn(() => undefined),
      hasMacro: vi.fn(() => true),
      getCanvas: vi.fn(() => canvas())
    };
    const missingVersionService = new MacroService(
      missingVersionRepository,
      new MacroPlanner({ now: () => NOW, validateElement: identityElementValidator }),
      new InMemoryMacroPlanStore({ now: () => NOW }),
      { executeMacro: vi.fn() }
    );
    expect(() =>
      missingVersionService.plan({
        canvasId: 'canvas-1',
        macroId: 'fixture/table',
        macroVersion: 9,
        anchor: ORIGIN,
        input: {},
        now: NOW
      })
    ).toThrowError(expect.objectContaining({ code: 'macro_version_not_found' }));

    const revisionConflictRepository: MacroRepository = {
      getDefinition: vi.fn(() => definition()),
      getCanvas: vi.fn(() => canvas())
    };
    const revisionConflictService = new MacroService(
      revisionConflictRepository,
      new MacroPlanner({ now: () => NOW, validateElement: identityElementValidator }),
      new InMemoryMacroPlanStore({ now: () => NOW }),
      {
        executeMacro: vi.fn(() => {
          throw new MacroError('macro_revision_conflict', 'canvas changed during execution', 'revision', {
            status: 409,
            retryable: true
          });
        })
      }
    );
    const created = revisionConflictService.plan({
      canvasId: 'canvas-1',
      macroId: 'fixture/table',
      macroVersion: 1,
      anchor: ORIGIN,
      input: { rows: [] },
      now: NOW
    });
    await expect(
      revisionConflictService.execute({
        canvasId: 'canvas-1',
        planId: created.planId,
        expectedRevision: 4,
        idempotencyKey: 'idem-1'
      })
    ).rejects.toThrowError(expect.objectContaining({ code: 'macro_revision_conflict' }));
  });

  it('enforces definition, input, generated-element, and canvas limits', () => {
    expect(() =>
      plan({
        elements: Array.from({ length: 101 }, (_, index) => ({ ...definition().elements[0], key: `item-${index}` }))
      })
    ).toThrowError(expect.objectContaining({ code: 'macro_limit_exceeded' }));
    expect(() => plan({}, { rows: [{ label: 'x'.repeat(256 * 1024) }] })).toThrowError(
      expect.objectContaining({ code: 'macro_input_too_large' })
    );
    expect(() =>
      new MacroPlanner({ now: () => NOW, validateElement: identityElementValidator }).plan(
        definition(),
        { canvasId: 'canvas-1', anchor: ORIGIN, input: { rows: [] }, now: NOW },
        canvas({
          elements: Array.from(
            { length: 2_000 },
            (_, index) =>
              ({ id: `e-${index}`, type: 'fixture/table', schemaVersion: 2, x: 0, y: 0, data: {} }) as CanvasElement
          )
        })
      )
    ).toThrowError(expect.objectContaining({ code: 'macro_canvas_limit_exceeded' }));
  });

  it('is deterministic and pure, including IDs, outputs, and digests', () => {
    const validator = vi.fn((element: CanvasElement) => element);
    const planner = new MacroPlanner({ now: () => NOW, validateElement: validator });
    const first = planner.plan(
      definition(),
      { canvasId: 'canvas-1', anchor: ORIGIN, input: { rows: [{ label: 'A' }] }, now: NOW },
      canvas()
    );
    const second = planner.plan(
      definition(),
      { canvasId: 'canvas-1', anchor: ORIGIN, input: { rows: [{ label: 'A' }] }, now: NOW },
      canvas()
    );
    expect(second.planId).toBe(first.planId);
    expect(second.planDigest).toBe(first.planDigest);
    expect(second.inputDigest).toBe(first.inputDigest);
    expect(second.outputs.table).toBe(first.previewElements[0].id);
    expect(first.operations).toEqual([{ op: 'upsertElement', element: first.previewElements[0] }]);
    expect(validator).toHaveBeenCalledTimes(2);
  });

  it('provides deterministic expiry/eviction and retry-safe peek semantics', () => {
    const plans = new InMemoryMacroPlanStore({ maxPlans: 2, now: () => NOW });
    const first = plan({ id: 'fixture/one' });
    const second = plan({ id: 'fixture/two' });
    const third = plan({ id: 'fixture/three' });
    plans.put(first, NOW);
    plans.put(second, NOW + 1);
    plans.put(third, NOW + 2);
    expect(() => plans.peek(first.planId, NOW + 2)).toThrowError(
      expect.objectContaining({ code: 'macro_plan_not_found' })
    );
    expect(plans.peek(second.planId, NOW + 2)).toEqual(plans.peek(second.planId, NOW + 2));
    expect(() => plans.peek(second.planId, NOW + 300_000)).toThrowError(
      expect.objectContaining({ code: 'macro_plan_expired' })
    );
  });

  it('does not replan during execution, delegates idempotency, rejects stale revisions, and returns history', async () => {
    const repo: MacroRepository = { getDefinition: vi.fn(() => definition()), getCanvas: vi.fn(() => canvas()) };
    const executor: MacroAtomicExecutor = {
      executeMacro: vi.fn((request: MacroAtomicExecutionRequest) => ({
        canvas: canvas({
          revision: 5,
          elements: request.operations
            .map((op) => (op.op === 'upsertElement' ? (op.element as CanvasElement) : undefined))
            .filter((element): element is CanvasElement => Boolean(element))
        }),
        provenance: request.provenance,
        outputs: request.outputs,
        history: request.history
      }))
    };
    const planner = new MacroPlanner({ now: () => NOW, validateElement: identityElementValidator });
    const stores = new InMemoryMacroPlanStore({ now: () => NOW });
    const service = new MacroService(repo, planner, stores, executor);
    const created = service.plan({
      canvasId: 'canvas-1',
      macroId: 'fixture/table',
      macroVersion: 1,
      anchor: ORIGIN,
      input: { rows: [] },
      now: NOW
    });
    await expect(
      service.execute({ canvasId: 'canvas-1', planId: created.planId, expectedRevision: 3, idempotencyKey: 'idem-1' })
    ).rejects.toThrowError(expect.objectContaining({ code: 'macro_plan_stale' }));
    const result = await service.execute({
      canvasId: 'canvas-1',
      planId: created.planId,
      expectedRevision: 4,
      idempotencyKey: 'idem-1'
    });
    expect(executor.executeMacro).toHaveBeenCalledWith(
      expect.objectContaining({ expectedRevision: 4, idempotencyKey: 'idem-1', operations: created.operations })
    );
    expect(result.provenance).toMatchObject({ macroId: 'fixture/table', macroVersion: 1, planId: created.planId });
    expect(result.history).toMatchObject({
      label: 'Insert table',
      affectedElementIds: [created.previewElements[0].id]
    });
    expect(result.history.forward).toEqual(created.operations);
    expect(result.history.inverse).toEqual([{ op: 'deleteElement', elementId: created.previewElements[0].id }]);
    await service.execute({
      canvasId: 'canvas-1',
      planId: created.planId,
      expectedRevision: 4,
      idempotencyKey: 'idem-1'
    });
    expect(executor.executeMacro).toHaveBeenCalledTimes(2);
    expect(repo.getDefinition).toHaveBeenCalledTimes(1);
  });
});
