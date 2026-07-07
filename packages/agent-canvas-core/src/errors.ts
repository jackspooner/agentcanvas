export type CanvasErrorStage = 'validation' | 'permission' | 'not_found' | 'revision' | 'idempotency' | 'asset_resolution' | 'storage' | 'rendering';

export interface CanvasErrorPayload {
  ok: false;
  code: string;
  message: string;
  stage: CanvasErrorStage;
  retryable: boolean;
  correlationId: string;
}

export class CanvasError extends Error {
  readonly code: string;
  readonly stage: CanvasErrorStage;
  readonly retryable: boolean;
  readonly status: number;
  readonly correlationId: string;

  constructor(code: string, message: string, stage: CanvasErrorStage, status = 400, retryable = false) {
    super(message);
    this.name = 'CanvasError';
    this.code = code;
    this.stage = stage;
    this.status = status;
    this.retryable = retryable;
    this.correlationId = makeCorrelationId();
  }

  toPayload(): CanvasErrorPayload {
    return { ok: false, code: this.code, message: this.message, stage: this.stage, retryable: this.retryable, correlationId: this.correlationId };
  }
}

export function toCanvasError(error: unknown): CanvasError {
  if (error instanceof CanvasError) return error;
  const message = error instanceof Error ? error.message : 'Unexpected AgentCanvas error';
  return new CanvasError('internal_error', message, 'storage', 500, false);
}

function makeCorrelationId(): string {
  const random = Math.random().toString(36).slice(2, 14).padEnd(12, '0');
  return `err_${random}`;
}
