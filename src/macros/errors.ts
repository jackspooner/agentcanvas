export type MacroErrorStage =
  | 'definition'
  | 'input'
  | 'planning'
  | 'repository'
  | 'plan'
  | 'execution'
  | 'revision'
  | 'idempotency';

export type MacroErrorCode =
  | 'macro_definition_invalid'
  | 'macro_definition_too_large'
  | 'macro_input_invalid'
  | 'macro_input_too_large'
  | 'macro_unsafe'
  | 'macro_ref_invalid'
  | 'macro_ref_pointer_invalid'
  | 'macro_ref_missing'
  | 'macro_scope_denied'
  | 'macro_not_found'
  | 'macro_version_not_found'
  | 'macro_archived'
  | 'macro_version_mismatch'
  | 'macro_dependency_invalid'
  | 'macro_dependency_missing'
  | 'macro_element_invalid'
  | 'macro_limit_exceeded'
  | 'macro_canvas_limit_exceeded'
  | 'macro_plan_not_found'
  | 'macro_plan_expired'
  | 'macro_plan_stale'
  | 'macro_revision_conflict'
  | 'macro_idempotency_invalid'
  | 'macro_idempotency_conflict'
  | 'macro_execution_invalid';

export class MacroError extends Error {
  readonly code: MacroErrorCode;
  readonly stage: MacroErrorStage;
  readonly retryable: boolean;
  readonly status: number;

  constructor(
    code: MacroErrorCode,
    message: string,
    stage: MacroErrorStage,
    options: { retryable?: boolean; status?: number } = {}
  ) {
    super(message);
    this.name = 'MacroError';
    this.code = code;
    this.stage = stage;
    this.retryable = options.retryable ?? false;
    this.status = options.status ?? 400;
  }
}

export function macroError(
  code: MacroErrorCode,
  message: string,
  stage: MacroErrorStage,
  options?: { retryable?: boolean; status?: number }
): MacroError {
  return new MacroError(code, message, stage, options);
}
