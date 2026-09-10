import Ajv2020 from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';
import {
  MACRO_ERROR_ENVELOPE_SCHEMA,
  MACRO_HTTP_ARCHIVE_REQUEST_SCHEMA,
  MACRO_HTTP_CREATE_VERSION_REQUEST_SCHEMA,
  MACRO_HTTP_EXECUTE_REQUEST_SCHEMA,
  MACRO_HTTP_PLAN_REQUEST_SCHEMA,
  MACRO_SCHEMA_CATALOG,
  getMacroOpenApiComponentSchemas
} from '../src/macros/index.js';

const DIGEST = 'a'.repeat(64);

const element = {
  id: 'macro_seed_table',
  type: 'fixture/table',
  schemaVersion: 2,
  x: 10,
  y: 20,
  width: 400,
  height: 200,
  data: {}
};

const definition = {
  id: 'fixture/table',
  version: 1,
  scope: 'installation',
  title: 'Insert table',
  inputSchema: { type: 'object', additionalProperties: false, properties: {} },
  elements: [{ key: 'table', type: 'fixture/table', schemaVersion: 2, x: 10, y: 20, width: 400, height: 200, data: {} }]
};

const plan = {
  planId: 'macro_plan_seed',
  macroId: 'fixture/table',
  macroVersion: 1,
  canvasId: 'canvas-1',
  canvasRevision: 4,
  anchor: { x: 0, y: 0 },
  inputDigest: DIGEST,
  planDigest: DIGEST,
  createdAt: '2026-07-27T10:00:00.000Z',
  expiresAt: '2026-07-27T10:05:00.000Z',
  operations: [{ op: 'upsertElement', element }],
  previewElements: [element],
  outputs: { table: element.id },
  effectSummary: {
    label: 'Insert table',
    operationCount: 1,
    generatedElementCount: 1,
    affectedElementIds: [element.id]
  }
};

const executionResult = {
  canvas: { id: 'canvas-1', revision: 5, elements: [element], bounds: { mode: 'unlimited' } },
  provenance: {
    macroId: 'fixture/table',
    macroVersion: 1,
    planId: plan.planId,
    inputDigest: DIGEST,
    planDigest: DIGEST
  },
  outputs: { table: element.id },
  history: {
    label: 'Insert table',
    forward: [{ op: 'upsertElement', element }],
    inverse: [{ op: 'deleteElement', elementId: element.id }],
    affectedElementIds: [element.id]
  }
};

const record = { definition, currentVersion: 2, archived: false };
const summary = {
  id: definition.id,
  scope: definition.scope,
  currentVersion: 2,
  archived: false,
  title: definition.title,
  createdAt: '2026-07-27T09:00:00.000Z',
  updatedAt: '2026-07-27T10:00:00.000Z'
};

function validator(schemaName: keyof typeof MACRO_SCHEMA_CATALOG.schemas) {
  const schema = MACRO_SCHEMA_CATALOG.schemas[schemaName];
  const ajv = new Ajv2020({ strict: true, allErrors: true });
  return ajv.compile(schema);
}

function localRefs(value: unknown, refs = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) localRefs(item, refs);
  } else if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      if (key === '$ref' && typeof item === 'string' && item.startsWith('#/$defs/')) refs.add(item.slice(8));
      else if (key !== '$defs') localRefs(item, refs);
    }
  }
  return refs;
}

describe('macro canonical schema catalog', () => {
  it('is deeply frozen, has stable ids, and compiles every schema in strict AJV 2020 mode', () => {
    for (const [name, schema] of Object.entries(MACRO_SCHEMA_CATALOG.schemas)) {
      expect(typeof schema).toBe('object');
      expect((schema as Record<string, unknown>).$id).toBe(
        MACRO_SCHEMA_CATALOG.ids[name as keyof typeof MACRO_SCHEMA_CATALOG.ids]
      );
      expect(Object.isFrozen(schema)).toBe(true);
      expect(() => validator(name as keyof typeof MACRO_SCHEMA_CATALOG.schemas)).not.toThrow();
    }
    expect(Object.isFrozen(MACRO_SCHEMA_CATALOG)).toBe(true);
    expect(getMacroOpenApiComponentSchemas()).not.toBe(MACRO_SCHEMA_CATALOG.components);
    expect(getMacroOpenApiComponentSchemas().MacroDefinitionV1).not.toHaveProperty('$defs');
    expect(Object.isFrozen(getMacroOpenApiComponentSchemas())).toBe(true);
  });

  it('includes only transitively referenced local definitions', () => {
    for (const schema of Object.values(MACRO_SCHEMA_CATALOG.schemas)) {
      const definitions = ((schema as Record<string, unknown>).$defs ?? {}) as Record<string, unknown>;
      const reachable = localRefs(schema);
      for (const name of reachable) localRefs(definitions[name], reachable);
      expect(Object.keys(definitions).sort()).toEqual([...reachable].sort());
    }
  });

  it('validates representative definitions, requests, plans, results, and direct/plan MCP modes', () => {
    expect(validator('MacroDefinitionV1')(definition)).toBe(true);
    expect(validator('MacroCreateRequest')({ ...definition, id: undefined, version: undefined })).toBe(false);
    expect(
      validator('MacroCreateRequest')({
        scope: 'installation',
        title: definition.title,
        inputSchema: definition.inputSchema,
        elements: definition.elements
      })
    ).toBe(true);
    expect(
      validator('MacroCreateVersionRequest')({
        macroId: definition.id,
        expectedCurrentVersion: 1,
        scope: 'installation',
        title: definition.title,
        inputSchema: definition.inputSchema,
        elements: definition.elements
      })
    ).toBe(true);
    expect(validator('MacroListRequest')({ limit: 20, includeArchived: false })).toBe(true);
    expect(validator('MacroListResponse')({ items: [summary] })).toBe(true);
    expect(validator('MacroListResponse')({ items: [record] })).toBe(false);
    expect(validator('MacroGetRequest')({ macroId: definition.id, macroVersion: 1 })).toBe(true);
    expect(validator('MacroGetResponse')(record)).toBe(true);
    expect(validator('MacroCreateResponse')(record)).toBe(true);
    expect(validator('MacroCreateVersionResponse')(record)).toBe(true);
    expect(validator('MacroArchiveRequest')({ macroId: definition.id, archived: true })).toBe(true);
    expect(validator('MacroArchiveRequest')({ macroId: definition.id, archived: false })).toBe(true);
    expect(validator('MacroArchiveResponse')({ macroId: definition.id, currentVersion: 2, archived: false })).toBe(
      true
    );
    expect(
      validator('MacroPlanRequest')({
        canvasId: 'canvas-1',
        macroId: definition.id,
        macroVersion: 1,
        anchor: { x: 0, y: 0 },
        input: {}
      })
    ).toBe(true);
    expect(validator('MacroPlanResponse')(plan)).toBe(true);
    expect(
      validator('MacroExecuteRequest')({
        canvasId: 'canvas-1',
        planId: plan.planId,
        expectedRevision: 4,
        idempotencyKey: 'idem-1'
      })
    ).toBe(true);
    expect(validator('MacroExecuteResponse')(executionResult)).toBe(true);
    expect(
      validator('CanvasRunMacroDirectRequest')({
        mode: 'direct',
        canvasId: 'canvas-1',
        macroId: definition.id,
        macroVersion: 1,
        anchor: { x: 0, y: 0 },
        input: {},
        expectedRevision: 4,
        idempotencyKey: 'idem-1'
      })
    ).toBe(true);
    expect(validator('CanvasRunMacroDirectResponse')(executionResult)).toBe(true);
    expect(
      validator('CanvasRunMacroPlanRequest')({
        mode: 'plan',
        canvasId: 'canvas-1',
        planId: plan.planId,
        expectedRevision: 4,
        idempotencyKey: 'idem-1'
      })
    ).toBe(true);
    expect(validator('CanvasRunMacroPlanResponse')(executionResult)).toBe(true);
    const { id: _id, version: _version, ...authoring } = definition;
    expect(
      new Ajv2020({ strict: true }).compile(MACRO_HTTP_CREATE_VERSION_REQUEST_SCHEMA)({
        ...authoring,
        expectedCurrentVersion: 1
      })
    ).toBe(true);
    expect(new Ajv2020({ strict: true }).compile(MACRO_HTTP_ARCHIVE_REQUEST_SCHEMA)({ archived: true })).toBe(true);
    expect(
      new Ajv2020({ strict: true }).compile(MACRO_HTTP_PLAN_REQUEST_SCHEMA)({
        macroVersion: 1,
        anchor: { x: 0, y: 0 },
        input: {}
      })
    ).toBe(true);
    expect(
      new Ajv2020({ strict: true }).compile(MACRO_HTTP_EXECUTE_REQUEST_SCHEMA)({
        planId: plan.planId,
        expectedRevision: 1,
        idempotencyKey: 'idem-1'
      })
    ).toBe(true);
    expect(
      new Ajv2020({ strict: true }).compile(MACRO_HTTP_PLAN_REQUEST_SCHEMA)({ ...plan, macroId: definition.id })
    ).toBe(false);
  });

  it('rejects host-assigned fields in authoring and raw invocation input in durable outputs', () => {
    const authoring = {
      scope: 'installation',
      title: definition.title,
      inputSchema: definition.inputSchema,
      elements: definition.elements
    };
    expect(validator('MacroCreateRequest')({ ...authoring, id: definition.id })).toBe(false);
    expect(validator('MacroCreateRequest')({ ...authoring, version: 1 })).toBe(false);
    expect(validator('MacroCreateVersionRequest')({ ...authoring, macroId: definition.id, id: definition.id })).toBe(
      false
    );
    expect(validator('MacroCreateVersionRequest')({ ...authoring, macroId: definition.id, version: 2 })).toBe(false);

    expect(validator('MacroGetRequest')({ macroId: definition.id })).toBe(false);
    expect(validator('MacroGetRequest')({ macroId: definition.id, latest: true })).toBe(false);
    expect(validator('MacroArchiveRequest')({ macroId: definition.id, macroVersion: 1, archived: true })).toBe(false);
    expect(
      validator('CanvasRunMacroDirectRequest')({
        mode: 'direct',
        canvasId: 'canvas-1',
        macroId: definition.id,
        anchor: { x: 0, y: 0 },
        input: {},
        expectedRevision: 4,
        idempotencyKey: 'idem-1'
      })
    ).toBe(false);
    expect(
      validator('CanvasRunMacroPlanRequest')({
        mode: 'plan',
        canvasId: 'canvas-1',
        macroId: definition.id,
        macroVersion: 1,
        anchor: { x: 0, y: 0 },
        input: {}
      })
    ).toBe(false);
    expect(validator('CanvasRunMacroPlanResponse')(plan)).toBe(false);

    expect(validator('MacroDefinitionV1')({ ...definition, inputSchema: { additionalProperties: false } })).toBe(false);
    expect(validator('MacroCreateRequest')({ ...authoring, inputSchema: { type: 'string' } })).toBe(false);

    expect(validator('MacroPlanResponse')({ ...plan, input: { secret: 'must-not-be-stored' } })).toBe(false);
    expect(validator('MacroExecuteResponse')({ ...executionResult, input: { secret: 'must-not-be-stored' } })).toBe(
      false
    );
    expect(
      validator('MacroProvenance')({ ...executionResult.provenance, input: { secret: 'must-not-be-stored' } })
    ).toBe(false);
  });

  it('covers the explicit error taxonomy, including the new distinctions', () => {
    const codes = [
      'macro_not_found',
      'macro_version_not_found',
      'macro_archived',
      'macro_input_invalid',
      'macro_dependency_missing',
      'macro_limit_exceeded',
      'macro_plan_expired',
      'macro_plan_stale',
      'macro_revision_conflict',
      'macro_idempotency_conflict'
    ] as const;
    const validate = validator('MacroErrorEnvelope');
    for (const code of codes) {
      expect(validate({ ok: false, code, message: code, stage: 'execution', retryable: false, status: 409 })).toBe(
        true
      );
    }
    expect(
      validate({
        ok: false,
        code: 'macro_revision_conflict',
        message: 'canvas changed',
        stage: 'revision',
        retryable: true,
        status: 409
      })
    ).toBe(true);
    expect(MACRO_ERROR_ENVELOPE_SCHEMA).toBe(MACRO_SCHEMA_CATALOG.schemas.MacroErrorEnvelope);
  });
});
