import type { Context } from 'hono';
import { nanoid } from 'nanoid';
import type { JsonObject, JsonSchema } from '@agentcanvas/plugin-sdk';
import {
  createProblemDetails,
  defineProblemCodes,
  PROBLEM_DETAILS_SCHEMA,
  PROBLEM_ISSUE_SCHEMA,
  type ProblemCategory,
  type ProblemCodeDefinition,
  type ProblemDetails,
  problemCodeMetadata
} from '@workspace2/api-contracts';
import type { CanvasError } from '../errors.js';
import type { MacroError } from '../macros/index.js';

const code = (
  status: number,
  title: string,
  category: ProblemCategory,
  description: string,
  retryable = false
): ProblemCodeDefinition => ({ status, title, category, retryable, description });

/** The sole owner for AgentCanvas application error meanings across HTTP, OpenAPI, MCP, and docs. */
export const AGENTCANVAS_PROBLEM_CODES = defineProblemCodes({
  validation_error: code(
    400,
    'Request validation failed',
    'validation',
    'The request does not satisfy the declared contract.'
  ),
  plugin_schema_version_unsupported: code(
    503,
    'Plugin schema version unsupported',
    'dependency',
    'An installed plugin schema version is unsupported.'
  ),
  plugin_migration_required: code(
    503,
    'Plugin migration required',
    'dependency',
    'An installed plugin schema migration must be applied.'
  ),
  database_migration_required: code(
    503,
    'Database migration required',
    'dependency',
    'The AgentCanvas database must be migrated.'
  ),
  database_version_unsupported: code(
    503,
    'Database version unsupported',
    'dependency',
    'The database is newer than this AgentCanvas version supports.'
  ),
  macro_definition_invalid: code(400, 'Macro definition invalid', 'validation', 'The macro definition is invalid.'),
  macro_definition_too_large: code(
    400,
    'Macro definition too large',
    'validation',
    'The macro definition exceeds its size limit.'
  ),
  macro_input_invalid: code(400, 'Macro input invalid', 'validation', 'Macro input does not satisfy its schema.'),
  macro_input_too_large: code(400, 'Macro input too large', 'validation', 'Macro input exceeds its size limit.'),
  macro_unsafe: code(400, 'Macro is unsafe', 'validation', 'The macro contains an unsafe construct.'),
  macro_ref_invalid: code(400, 'Macro reference invalid', 'validation', 'A macro reference is invalid.'),
  macro_ref_pointer_invalid: code(
    400,
    'Macro reference pointer invalid',
    'validation',
    'A macro JSON pointer is invalid.'
  ),
  macro_dependency_invalid: code(
    400,
    'Macro dependency invalid',
    'validation',
    'A macro dependency declaration is invalid.'
  ),
  macro_element_invalid: code(400, 'Macro element invalid', 'validation', 'A generated element is invalid.'),
  macro_limit_exceeded: code(400, 'Macro limit exceeded', 'validation', 'Macro output exceeds the supported limit.'),
  macro_canvas_limit_exceeded: code(
    400,
    'Canvas limit exceeded',
    'validation',
    'Macro output would exceed the canvas limit.'
  ),
  macro_idempotency_invalid: code(
    400,
    'Idempotency key invalid',
    'validation',
    'The macro idempotency key is invalid.'
  ),
  macro_execution_invalid: code(500, 'Macro execution failed', 'internal', 'Macro execution failed unexpectedly.'),
  permission_denied: code(
    403,
    'Permission denied',
    'authorization',
    'The caller does not have permission for this operation.'
  ),
  plugin_permission_denied: code(
    403,
    'Plugin permission denied',
    'authorization',
    'The plugin did not declare the required permission.'
  ),
  untrusted_host: code(403, 'Untrusted host', 'authorization', 'The request Host header is not allowed.'),
  untrusted_origin: code(403, 'Untrusted origin', 'authorization', 'The request Origin header is not allowed.'),
  embed_canvas_forbidden: code(403, 'Canvas forbidden', 'authorization', 'The canvas is outside this embed session.'),
  macro_scope_denied: code(403, 'Macro scope denied', 'authorization', 'The macro is scoped to another canvas.'),
  not_found: code(404, 'Resource not found', 'not_found', 'The requested resource does not exist.'),
  element_not_found: code(404, 'Element not found', 'not_found', 'The requested element does not exist.'),
  plugin_unavailable: code(404, 'Plugin unavailable', 'not_found', 'The requested plugin is not active.'),
  embed_session_not_found: code(404, 'Embed session not found', 'not_found', 'The embed session does not exist.'),
  procedure_not_found: code(404, 'Procedure not found', 'not_found', 'The plugin procedure does not exist.'),
  resource_not_found: code(404, 'Resource not found', 'not_found', 'The resource handle does not exist.'),
  resource_too_large: code(
    413,
    'Resource too large',
    'validation',
    'The resource exceeds the configured delivery limit.'
  ),
  macro_not_found: code(404, 'Macro not found', 'not_found', 'The macro does not exist.'),
  macro_version_not_found: code(404, 'Macro version not found', 'not_found', 'The exact macro version does not exist.'),
  macro_plan_not_found: code(404, 'Macro plan not found', 'not_found', 'The macro plan does not exist.'),
  macro_ref_missing: code(404, 'Macro reference missing', 'not_found', 'A referenced macro value does not exist.'),
  macro_dependency_missing: code(
    404,
    'Macro dependency missing',
    'dependency',
    'A required macro dependency is unavailable.'
  ),
  macro_archived: code(409, 'Macro archived', 'conflict', 'The macro is archived.'),
  macro_version_mismatch: code(409, 'Macro version conflict', 'conflict', 'The exact macro version changed.'),
  macro_plan_stale: code(409, 'Macro plan stale', 'conflict', 'The canvas changed after the macro was planned.', true),
  macro_revision_conflict: code(409, 'Canvas revision conflict', 'conflict', 'The canvas revision changed.', true),
  macro_idempotency_conflict: code(
    409,
    'Idempotency conflict',
    'conflict',
    'The idempotency key was reused with different input.'
  ),
  revision_conflict: code(409, 'Canvas revision conflict', 'conflict', 'The canvas revision changed.', true),
  idempotency_conflict: code(
    409,
    'Idempotency conflict',
    'conflict',
    'The idempotency key was reused with different input.'
  ),
  immutable_element_identity: code(
    409,
    'Element identity conflict',
    'conflict',
    'Element type and schema version are immutable.'
  ),
  embed_session_expired: code(410, 'Embed session expired', 'authorization', 'The embed session has expired.'),
  macro_plan_expired: code(410, 'Macro plan expired', 'conflict', 'The macro plan has expired.'),
  procedure_timeout: code(
    504,
    'Procedure timed out',
    'dependency',
    'The plugin procedure exceeded its execution deadline.',
    true
  ),
  embed_session_capacity: code(
    503,
    'Embed session capacity reached',
    'dependency',
    'The active embed session limit has been reached.',
    true
  ),
  invalid_parent_origin: code(400, 'Parent origin invalid', 'validation', 'The embed parent origin is invalid.'),
  database_version_invalid: code(
    503,
    'Database unavailable',
    'dependency',
    'The database requires migration or has an unsupported version.'
  ),
  stored_canvas_invalid: code(
    500,
    'Stored canvas invalid',
    'internal',
    'Stored canvas data violates the canonical contract.'
  ),
  internal_error: code(500, 'Internal server error', 'internal', 'AgentCanvas could not complete the request.')
});

export type AgentCanvasProblemCode = keyof typeof AGENTCANVAS_PROBLEM_CODES;

export const PROBLEM_ISSUE_OPENAPI_SCHEMA: JsonSchema = withoutId(PROBLEM_ISSUE_SCHEMA) as unknown as JsonSchema;
export const PROBLEM_DETAILS_OPENAPI_SCHEMA: JsonSchema = {
  ...(withoutId(PROBLEM_DETAILS_SCHEMA) as Record<string, unknown>),
  properties: {
    ...PROBLEM_DETAILS_SCHEMA.properties,
    issues: { type: 'array', items: { $ref: '#/components/schemas/ProblemIssue' } }
  }
} as unknown as JsonSchema;

export const PROBLEM_DETAILS_MCP_SCHEMA: JsonSchema = {
  ...(withoutId(PROBLEM_DETAILS_SCHEMA) as Record<string, unknown>),
  properties: {
    ...PROBLEM_DETAILS_SCHEMA.properties,
    type: { type: 'string', minLength: 1 },
    instance: { type: 'string', minLength: 1 },
    issues: { type: 'array', items: withoutId(PROBLEM_ISSUE_SCHEMA) }
  }
} as unknown as JsonSchema;

export function mcpOutputSchema(successSchema: JsonSchema): JsonSchema {
  return {
    type: 'object',
    oneOf: [
      successSchema,
      {
        type: 'object',
        additionalProperties: false,
        required: ['problem'],
        properties: { problem: PROBLEM_DETAILS_MCP_SCHEMA }
      }
    ]
  } as JsonSchema;
}

export function problemFromCanvasError(error: CanvasError, requestId: string, instance: string): ProblemDetails {
  const definition = AGENTCANVAS_PROBLEM_CODES[error.code as AgentCanvasProblemCode];
  if (!definition) throw new Error(`Unknown AgentCanvas problem code: ${error.code}`);
  return createProblemDetails(AGENTCANVAS_PROBLEM_CODES, error.code, {
    detail: error.status >= 500 ? definition.description : error.message,
    requestId,
    instance
  });
}

export function problemFromMacroError(error: MacroError, requestId: string, instance: string): ProblemDetails {
  return createProblemDetails(AGENTCANVAS_PROBLEM_CODES, error.code, {
    detail: error.status >= 500 ? AGENTCANVAS_PROBLEM_CODES[error.code].description : error.message,
    requestId,
    instance
  });
}

export function problemForCode(
  problemCode: AgentCanvasProblemCode,
  detail: string,
  requestId: string,
  instance: string
): ProblemDetails {
  return createProblemDetails(AGENTCANVAS_PROBLEM_CODES, problemCode, { detail, requestId, instance });
}

export function problemResponse(description: string, codes: readonly AgentCanvasProblemCode[]): JsonObject {
  const metadata = problemCodeMetadata(AGENTCANVAS_PROBLEM_CODES, codes);
  return {
    description,
    'x-error-codes': metadata,
    content: {
      'application/problem+json': {
        schema: { $ref: '#/components/schemas/ProblemDetails' },
        examples: Object.fromEntries(
          metadata.map((entry) => [entry.code, { value: exampleProblem(entry.code as AgentCanvasProblemCode) }])
        )
      }
    }
  } as unknown as JsonObject;
}

export function codesForStatus(status: number): AgentCanvasProblemCode[] {
  return Object.entries(AGENTCANVAS_PROBLEM_CODES)
    .filter(([, definition]) => definition.status === status)
    .map(([problemCode]) => problemCode as AgentCanvasProblemCode);
}

export function exampleProblem(problemCode: AgentCanvasProblemCode): ProblemDetails {
  const definition = AGENTCANVAS_PROBLEM_CODES[problemCode];
  return createProblemDetails(AGENTCANVAS_PROBLEM_CODES, problemCode, {
    detail: definition.description,
    requestId: 'req_example',
    instance: '/api/v1/example'
  });
}

function withoutId(schema: Record<string, unknown>): Record<string, unknown> {
  const { $id: _id, ...value } = schema;
  return structuredClone(value);
}

export function requestId(c: Context): string {
  return c.req.header('x-request-id')?.trim() || `req_${nanoid(16)}`;
}

export function sendProblem(c: Context, problem: ReturnType<typeof problemForCode>): Response {
  return c.json(problem, problem.status as 400 | 403 | 404 | 408 | 409 | 410 | 413 | 500 | 503 | 504, {
    'content-type': 'application/problem+json',
    'x-request-id': problem.requestId
  });
}
