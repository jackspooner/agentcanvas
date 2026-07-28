import { MacroError } from './errors.js';
import { InMemoryMacroPlanStore } from './plan-store.js';
import { MacroPlanner, provenanceForPlan, validateMacroAnchor } from './planner.js';
import { sha256 } from './canonical-json.js';
import type {
  MacroAtomicExecutionResult,
  MacroAtomicExecutor,
  MacroDefinitionRecord,
  MacroDefinitionV1,
  MacroExecutionResult,
  MacroHistory,
  MacroPlan,
  MacroRepository,
  MacroServiceExecuteRequest,
  MacroServicePlanRequest
} from './types.js';

export class MacroService {
  constructor(
    private readonly repository: MacroRepository,
    private readonly planner: MacroPlanner,
    private readonly plans: InMemoryMacroPlanStore,
    private readonly executor: MacroAtomicExecutor
  ) {}

  plan(request: MacroServicePlanRequest): MacroPlan {
    validatePlanRequest(request);
    const record = this.repository.getDefinition(request.macroId, request.macroVersion, request.canvasId);
    if (!record) {
      const exactVersionMissing = this.repository.hasMacro?.(request.macroId, request.canvasId) === true;
      throw new MacroError(
        exactVersionMissing ? 'macro_version_not_found' : 'macro_not_found',
        exactVersionMissing ? 'macro definition version was not found' : 'macro definition was not found',
        'repository',
        { status: 404 }
      );
    }
    const definition = unwrapDefinition(record);
    if (isRecord(record) && record.archived)
      throw new MacroError('macro_archived', 'macro definition is archived', 'repository', { status: 409 });
    if (definition.id !== request.macroId || definition.version !== request.macroVersion) {
      throw new MacroError('macro_version_mismatch', 'macro definition version is not an exact match', 'repository', {
        status: 409
      });
    }
    if (definition.scope === 'canvas' && definition.canvasId !== request.canvasId) {
      throw new MacroError('macro_scope_denied', 'macro definition is scoped to another canvas', 'repository', {
        status: 403
      });
    }
    const canvas = this.repository.getCanvas(request.canvasId);
    const plan = this.planner.plan(
      definition,
      {
        canvasId: request.canvasId,
        anchor: request.anchor,
        input: request.input,
        label: request.label,
        now: request.now
      },
      canvas
    );
    this.plans.put(plan, request.now instanceof Date ? request.now.getTime() : request.now);
    return plan;
  }

  async execute(request: MacroServiceExecuteRequest): Promise<MacroExecutionResult> {
    validateExecuteRequest(request);
    let plan: MacroPlan;
    try {
      plan = this.plans.peek(request.planId);
    } catch (error) {
      if (this.executor.replayMacro) {
        const replay = await this.executor.replayMacro(request);
        if (replay !== undefined) return replay;
      }
      throw error;
    }
    if (plan.canvasId !== request.canvasId)
      throw new MacroError('macro_scope_denied', 'macro plan belongs to another canvas', 'execution', { status: 403 });
    if (plan.canvasRevision !== request.expectedRevision) {
      throw new MacroError('macro_plan_stale', 'macro plan revision is stale', 'revision', {
        status: 409,
        retryable: true
      });
    }
    const provenance = provenanceForPlan(plan);
    const history: MacroHistory = {
      label: plan.effectSummary.label,
      forward: plan.operations,
      inverse: plan.previewElements.map((element) => ({ op: 'deleteElement', elementId: element.id })),
      affectedElementIds: plan.effectSummary.affectedElementIds
    };
    const requestDigest = macroExecutionRequestDigest({
      canvasId: request.canvasId,
      macroId: provenance.macroId,
      macroVersion: provenance.macroVersion,
      planDigest: provenance.planDigest,
      inputDigest: provenance.inputDigest,
      expectedRevision: request.expectedRevision,
      operations: plan.operations
    });
    if (this.executor.replayMacro) {
      const replay = await this.executor.replayMacro(request, requestDigest);
      if (replay !== undefined) return replay;
    }
    let committed: MacroAtomicExecutionResult;
    try {
      committed = await this.executor.executeMacro({
        canvasId: request.canvasId,
        expectedRevision: request.expectedRevision,
        idempotencyKey: request.idempotencyKey,
        operations: plan.operations,
        provenance,
        outputs: plan.outputs,
        effectSummary: plan.effectSummary,
        history
      });
    } catch (error) {
      if (error instanceof MacroError) throw error;
      throw new MacroError('macro_execution_invalid', 'macro execution failed', 'execution');
    }
    if (!committed || !committed.canvas || !committed.provenance || !committed.outputs || !committed.history) {
      throw new MacroError('macro_execution_invalid', 'macro executor returned an incomplete result', 'execution');
    }
    return committed;
  }
}

export function macroExecutionRequestDigest(input: {
  canvasId: string;
  macroId: string;
  macroVersion: number;
  planDigest: string;
  inputDigest: string;
  expectedRevision: number;
  operations: readonly unknown[];
}): string {
  return sha256({
    operationKind: 'macro.execute',
    canvasId: input.canvasId,
    macroId: input.macroId,
    macroVersion: input.macroVersion,
    planDigest: input.planDigest,
    inputDigest: input.inputDigest,
    expectedRevision: input.expectedRevision,
    operations: input.operations
  });
}

function unwrapDefinition(value: MacroDefinitionRecord | MacroDefinitionV1): MacroDefinitionV1 {
  return 'definition' in value ? value.definition : value;
}

function isRecord(value: MacroDefinitionRecord | MacroDefinitionV1): value is MacroDefinitionRecord {
  return 'definition' in value;
}

function validatePlanRequest(request: MacroServicePlanRequest): void {
  if (
    !request ||
    typeof request !== 'object' ||
    !request.canvasId ||
    !request.macroId ||
    !Number.isSafeInteger(request.macroVersion) ||
    request.macroVersion < 1
  ) {
    throw new MacroError('macro_definition_invalid', 'macro plan request is invalid', 'repository');
  }
  validateMacroAnchor(request.anchor);
}

function validateExecuteRequest(request: MacroServiceExecuteRequest): void {
  if (
    !request ||
    typeof request !== 'object' ||
    !request.canvasId ||
    !request.planId ||
    !Number.isSafeInteger(request.expectedRevision) ||
    request.expectedRevision < 1
  ) {
    throw new MacroError('macro_plan_stale', 'macro execution requires a valid expectedRevision', 'revision');
  }
  if (
    typeof request.idempotencyKey !== 'string' ||
    request.idempotencyKey.length === 0 ||
    request.idempotencyKey.length > 256
  ) {
    throw new MacroError(
      'macro_idempotency_invalid',
      'macro execution requires a bounded idempotencyKey',
      'idempotency'
    );
  }
}
