import { MacroError } from './errors.js';
import { InMemoryMacroPlanStore } from './plan-store.js';
import { MacroPlanner } from './planner.js';
import { MacroService, macroExecutionRequestDigest } from './service.js';
import { SqliteMacroRepository } from './repository.js';
import { MACRO_PLAN_TTL_MS } from './definition.js';
import type {
  MacroDefinitionAuthoringV1,
  MacroDefinitionRecord,
  MacroExecutionResult,
  MacroListRequest,
  MacroListResponse,
  MacroServiceExecuteRequest,
  MacroServicePlanRequest,
  MacroCreateVersionInput,
  MacroArchiveResponse,
  MacroPlan,
  CanvasRunMacroDirectRequest
} from './types.js';
import type { V2SqliteCanvasStore } from '../store/v2.js';
import type { FrozenPluginRegistry } from '../plugin-runtime/registry.js';
import { PluginElementValidator } from '../plugin-runtime/elements.js';

export class MacroRuntime {
  readonly plans: InMemoryMacroPlanStore;
  readonly repository: SqliteMacroRepository;
  readonly service: MacroService;

  constructor(
    readonly store: V2SqliteCanvasStore,
    registry: FrozenPluginRegistry
  ) {
    const elementValidator = new PluginElementValidator(registry);
    this.plans = new InMemoryMacroPlanStore({ maxPlans: 500 });
    this.repository = new SqliteMacroRepository(store.db, (canvasId) => store.getCanvas(canvasId));
    const planner = new MacroPlanner({
      validateDependencies: (dependencies) => {
        for (const dependency of dependencies) {
          const descriptor = registry.getElementType(dependency.elementType);
          if (!descriptor || descriptor.schemaVersion !== dependency.schemaVersion) {
            throw new MacroError(
              'macro_dependency_missing',
              `macro dependency is unavailable: ${dependency.elementType}@${dependency.schemaVersion}`,
              'planning'
            );
          }
        }
      },
      validateElement: (element) => {
        try {
          return elementValidator.normalizeForWrite(element);
        } catch (error) {
          if (error instanceof MacroError) throw error;
          throw new MacroError('macro_element_invalid', 'generated element failed canonical validation', 'planning');
        }
      }
    });
    this.service = new MacroService(this.repository, planner, this.plans, {
      replayMacro: (request, requestDigest) => {
        try {
          const cached = store.getCachedMacroResponse(
            request.canvasId,
            request.idempotencyKey,
            request.planId,
            request.expectedRevision,
            requestDigest
          );
          return cached as MacroExecutionResult | undefined;
        } catch (error) {
          throw mapStoreMacroError(error);
        }
      },
      executeMacro: async (request) => {
        const requestDigest = macroExecutionRequestDigest({
          canvasId: request.canvasId,
          macroId: request.provenance.macroId,
          macroVersion: request.provenance.macroVersion,
          planDigest: request.provenance.planDigest,
          inputDigest: request.provenance.inputDigest,
          expectedRevision: request.expectedRevision,
          operations: request.operations
        });
        try {
          return store.applyOperationsWithTransaction(
            request.canvasId,
            {
              expectedRevision: request.expectedRevision,
              idempotencyKey: request.idempotencyKey,
              operations: [...request.operations]
            },
            ({ db, response, revision }) => {
              this.repository.recordInvocation(db, {
                canvasId: request.canvasId,
                resultingRevision: revision,
                idempotencyKey: request.idempotencyKey,
                provenance: request.provenance,
                outputs: request.outputs,
                effectSummary: request.effectSummary,
                history: request.history
              });
              return {
                canvas: response,
                provenance: request.provenance,
                outputs: request.outputs,
                history: request.history
              };
            },
            { idempotencyRequestDigest: requestDigest }
          );
        } catch (error) {
          if (error instanceof MacroError) throw error;
          throw mapStoreMacroError(error);
        }
      }
    });
  }

  list(request: MacroListRequest): MacroListResponse {
    return this.repository.list(request);
  }
  get(macroId: string, macroVersion: number, canvasId: string): MacroDefinitionRecord {
    const value = this.repository.getDefinition(macroId, macroVersion, canvasId);
    if (!value) {
      throw new MacroError(
        this.repository.hasMacro(macroId, canvasId) ? 'macro_version_not_found' : 'macro_not_found',
        'macro definition was not found',
        'repository',
        { status: 404 }
      );
    }
    return value;
  }
  create(input: MacroDefinitionAuthoringV1): MacroDefinitionRecord {
    return this.repository.create(input);
  }
  createVersion(input: MacroCreateVersionInput): MacroDefinitionRecord {
    return this.repository.createVersion(input);
  }
  archive(macroId: string, archived: boolean): MacroArchiveResponse {
    return this.repository.archive(macroId, archived);
  }
  plan(request: MacroServicePlanRequest): MacroPlan {
    return this.service.plan(request);
  }
  execute(request: MacroServiceExecuteRequest): Promise<MacroExecutionResult> {
    return this.service.execute(request);
  }
  direct(request: CanvasRunMacroDirectRequest): Promise<MacroExecutionResult> {
    const plan = this.plan({
      canvasId: request.canvasId,
      macroId: request.macroId,
      macroVersion: request.macroVersion,
      anchor: request.anchor,
      input: request.input,
      label: request.label
    });
    return this.execute({
      canvasId: request.canvasId,
      planId: plan.planId,
      expectedRevision: request.expectedRevision,
      idempotencyKey: request.idempotencyKey
    });
  }
}

function mapStoreMacroError(error: unknown): MacroError {
  if (error instanceof Error && 'code' in error) {
    const code = (error as { code?: unknown }).code;
    if (code === 'revision_conflict')
      return new MacroError('macro_revision_conflict', error.message, 'revision', { status: 409, retryable: true });
    if (code === 'idempotency_conflict')
      return new MacroError('macro_idempotency_conflict', error.message, 'idempotency', { status: 409 });
  }
  if (error instanceof MacroError) return error;
  return new MacroError('macro_execution_invalid', 'macro transaction failed', 'execution', { status: 500 });
}

export const MACRO_RUNTIME_LIMITS = Object.freeze({
  version: 1,
  maxTemplates: 100,
  maxCanvasElements: 2_000,
  maxPlans: 500,
  planTtlMs: MACRO_PLAN_TTL_MS
});
