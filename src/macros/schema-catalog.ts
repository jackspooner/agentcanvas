import type { JsonObject, JsonSchema } from '@agentcanvas/plugin-sdk';
import { deepFreeze } from './canonical-json.js';

const DRAFT_2020_12 = 'https://json-schema.org/draft/2020-12/schema';
export const MACRO_ELEMENT_TYPE_PATTERN = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*\/[a-z][a-z0-9-]*$/;
export const MACRO_ELEMENT_TYPE_PATTERN_SOURCE = MACRO_ELEMENT_TYPE_PATTERN.source;

const ID_PATTERN = '^[A-Za-z][A-Za-z0-9_.:-]{0,63}(?:\/[A-Za-z][A-Za-z0-9_.:-]{0,63})?$';
const KEY_PATTERN = '^[A-Za-z][A-Za-z0-9_.:-]{0,63}$';
const HASH_PATTERN = '^[a-f0-9]{64}$';
const PLAN_ID_PATTERN = '^macro_plan_[A-Za-z0-9_-]{1,80}$';
const COMPONENT_PREFIX = 'https://agentcanvas.local/schemas/macros/v1/';

function conditionalSchema(condition: JsonObject, consequence: JsonObject): JsonObject {
  const schema: JsonObject = { if: condition };
  schema['then'] = consequence;
  return schema;
}

const macroScopeConditions: JsonObject[] = [
  conditionalSchema(
    { properties: { scope: { const: 'canvas' } }, required: ['scope'] },
    { required: ['canvasId'], properties: { canvasId: { type: 'string', pattern: KEY_PATTERN } } }
  ),
  conditionalSchema(
    { properties: { scope: { const: 'installation' } }, required: ['scope'] },
    { not: { required: ['canvasId'] } }
  )
];

const jsonValue: JsonObject = {
  oneOf: [
    { type: 'null' },
    { type: 'boolean' },
    { type: 'string' },
    { type: 'number' },
    { type: 'array', items: { $ref: '#/$defs/JsonValue' } },
    { type: 'object', additionalProperties: { $ref: '#/$defs/JsonValue' } }
  ]
};

const jsonObject: JsonObject = {
  type: 'object',
  additionalProperties: { $ref: '#/$defs/JsonValue' }
};

const anchor: JsonObject = {
  type: 'object',
  additionalProperties: false,
  required: ['x', 'y'],
  properties: {
    x: { type: 'number' },
    y: { type: 'number' }
  }
};

const macroRef: JsonObject = {
  oneOf: [
    {
      type: 'object',
      additionalProperties: false,
      required: ['$macroRef', 'pointer'],
      properties: {
        $macroRef: { const: 'input' },
        pointer: { type: 'string' }
      }
    },
    {
      type: 'object',
      additionalProperties: false,
      required: ['$macroRef', 'elementKey'],
      properties: {
        $macroRef: { const: 'generatedElementId' },
        elementKey: { type: 'string', pattern: KEY_PATTERN }
      }
    }
  ]
};

const dependency: JsonObject = {
  type: 'object',
  additionalProperties: false,
  required: ['elementType', 'schemaVersion'],
  properties: {
    elementType: { type: 'string', pattern: MACRO_ELEMENT_TYPE_PATTERN_SOURCE },
    schemaVersion: { type: 'integer', minimum: 1 }
  }
};

const elementTemplate: JsonObject = {
  type: 'object',
  additionalProperties: false,
  required: ['key', 'type', 'schemaVersion', 'x', 'y', 'width', 'height', 'data'],
  properties: {
    key: { type: 'string', pattern: KEY_PATTERN },
    type: { type: 'string', pattern: MACRO_ELEMENT_TYPE_PATTERN_SOURCE },
    schemaVersion: { type: 'integer', minimum: 1 },
    x: { type: 'number' },
    y: { type: 'number' },
    width: { type: 'number', exclusiveMinimum: 0 },
    height: { type: 'number', exclusiveMinimum: 0 },
    data: jsonObject,
    style: { oneOf: [jsonObject, { type: 'null' }] },
    metadata: jsonObject
  }
};

const inputSchema: JsonObject = {
  type: 'object',
  required: ['type'],
  properties: { type: { const: 'object' } },
  additionalProperties: { $ref: '#/$defs/JsonValue' }
};

const authoringDefinition: JsonObject = {
  type: 'object',
  additionalProperties: false,
  required: ['scope', 'title', 'inputSchema', 'elements'],
  properties: {
    scope: { enum: ['installation', 'canvas'] },
    canvasId: { type: 'string', pattern: KEY_PATTERN },
    title: { type: 'string', minLength: 1 },
    description: { type: 'string' },
    category: { type: 'string' },
    inputSchema,
    dependencies: { type: 'array', items: { $ref: '#/$defs/MacroDependency' }, uniqueItems: true },
    elements: { type: 'array', items: { $ref: '#/$defs/MacroElementTemplate' }, maxItems: 100 },
    outputs: { type: 'object', additionalProperties: { type: 'string', pattern: KEY_PATTERN } }
  },
  allOf: macroScopeConditions
};

const storedDefinition: JsonObject = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'version', 'scope', 'title', 'inputSchema', 'elements'],
  properties: {
    id: { type: 'string', pattern: ID_PATTERN },
    version: { type: 'integer', minimum: 1 },
    scope: { enum: ['installation', 'canvas'] },
    canvasId: { type: 'string', pattern: KEY_PATTERN },
    title: { type: 'string', minLength: 1 },
    description: { type: 'string' },
    category: { type: 'string' },
    inputSchema,
    dependencies: { type: 'array', items: { $ref: '#/$defs/MacroDependency' }, uniqueItems: true },
    elements: { type: 'array', items: { $ref: '#/$defs/MacroElementTemplate' }, maxItems: 100 },
    outputs: { type: 'object', additionalProperties: { type: 'string', pattern: KEY_PATTERN } }
  },
  allOf: macroScopeConditions
};

const canvasElement: JsonObject = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'type', 'schemaVersion', 'x', 'y', 'data'],
  properties: {
    id: { type: 'string', minLength: 1 },
    type: { type: 'string', pattern: MACRO_ELEMENT_TYPE_PATTERN_SOURCE },
    schemaVersion: { type: 'integer', minimum: 1 },
    x: { type: 'number' },
    y: { type: 'number' },
    width: { type: ['number', 'null'] },
    height: { type: ['number', 'null'] },
    zIndex: { type: ['number', 'null'] },
    rotation: { type: ['number', 'null'] },
    opacity: { type: ['number', 'null'] },
    locked: { type: ['boolean', 'null'] },
    style: { oneOf: [jsonObject, { type: 'null' }] },
    metadata: jsonObject,
    data: jsonObject
  }
};

const bounds: JsonObject = {
  oneOf: [
    {
      type: 'object',
      additionalProperties: false,
      required: ['mode'],
      properties: { mode: { const: 'unlimited' } }
    },
    {
      type: 'object',
      additionalProperties: false,
      required: ['mode', 'width', 'height'],
      properties: {
        mode: { const: 'fixed' },
        width: { type: 'number', exclusiveMinimum: 0 },
        height: { type: 'number', exclusiveMinimum: 0 }
      }
    }
  ]
};

const canvasSnapshot: JsonObject = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'revision', 'elements', 'bounds'],
  properties: {
    id: { type: 'string', minLength: 1 },
    revision: { type: 'integer', minimum: 1 },
    elements: { type: 'array', items: { $ref: '#/$defs/CanvasElement' } },
    bounds,
    archived: { type: 'boolean' }
  }
};

const canvasRecord: JsonObject = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'title', 'createdBy', 'createdAt', 'updatedAt', 'bounds', 'elements', 'revision', 'documentVersion'],
  properties: {
    id: { type: 'string', minLength: 1 },
    title: { type: 'string' },
    description: { type: ['string', 'null'] },
    project: { type: ['string', 'null'] },
    conversationId: { type: ['string', 'null'] },
    createdBy: { enum: ['agent', 'user', 'system'] },
    createdAt: { type: 'string' },
    updatedAt: { type: 'string' },
    bounds,
    width: { type: 'number' },
    height: { type: 'number' },
    background: { oneOf: [jsonObject, { type: 'null' }] },
    theme: { oneOf: [jsonObject, { type: 'null' }] },
    elements: { type: 'array', items: { $ref: '#/$defs/CanvasElement' } },
    revision: { type: 'integer', minimum: 1 },
    metadata: jsonObject,
    documentVersion: { const: 2 }
  }
};

const macroOperation: JsonObject = {
  oneOf: [
    {
      type: 'object',
      additionalProperties: false,
      required: ['op', 'element'],
      properties: { op: { const: 'upsertElement' }, element: { $ref: '#/$defs/CanvasElement' } }
    },
    {
      type: 'object',
      additionalProperties: false,
      required: ['op', 'elementId'],
      properties: { op: { const: 'deleteElement' }, elementId: { type: 'string', minLength: 1 } }
    },
    {
      type: 'object',
      additionalProperties: false,
      required: ['op', 'elementId', 'frame'],
      properties: {
        op: { const: 'patchElementFrame' },
        elementId: { type: 'string', minLength: 1 },
        frame: { type: 'object', additionalProperties: { $ref: '#/$defs/JsonValue' } }
      }
    },
    {
      type: 'object',
      additionalProperties: false,
      required: ['op'],
      properties: { op: { const: 'clear' } }
    }
  ]
};

const effectSummary: JsonObject = {
  type: 'object',
  additionalProperties: false,
  required: ['label', 'operationCount', 'generatedElementCount', 'affectedElementIds'],
  properties: {
    label: { type: 'string' },
    operationCount: { type: 'integer', minimum: 0 },
    generatedElementCount: { type: 'integer', minimum: 0 },
    affectedElementIds: { type: 'array', items: { type: 'string', minLength: 1 }, uniqueItems: true }
  }
};

const provenance: JsonObject = {
  type: 'object',
  additionalProperties: false,
  required: ['macroId', 'macroVersion', 'planId', 'inputDigest', 'planDigest'],
  properties: {
    macroId: { type: 'string', pattern: ID_PATTERN },
    macroVersion: { type: 'integer', minimum: 1 },
    planId: { type: 'string', pattern: PLAN_ID_PATTERN },
    inputDigest: { type: 'string', pattern: HASH_PATTERN },
    planDigest: { type: 'string', pattern: HASH_PATTERN }
  }
};

const history: JsonObject = {
  type: 'object',
  additionalProperties: false,
  required: ['label', 'forward', 'inverse', 'affectedElementIds'],
  properties: {
    label: { type: 'string' },
    forward: { type: 'array', items: { $ref: '#/$defs/MacroOperation' } },
    inverse: { type: 'array', items: { $ref: '#/$defs/MacroOperation' } },
    affectedElementIds: { type: 'array', items: { type: 'string', minLength: 1 }, uniqueItems: true }
  }
};

const plan: JsonObject = {
  type: 'object',
  additionalProperties: false,
  required: [
    'planId',
    'macroId',
    'macroVersion',
    'canvasId',
    'canvasRevision',
    'anchor',
    'inputDigest',
    'planDigest',
    'createdAt',
    'expiresAt',
    'operations',
    'previewElements',
    'outputs',
    'effectSummary'
  ],
  properties: {
    planId: { type: 'string', pattern: PLAN_ID_PATTERN },
    macroId: { type: 'string', pattern: ID_PATTERN },
    macroVersion: { type: 'integer', minimum: 1 },
    canvasId: { type: 'string', minLength: 1 },
    canvasRevision: { type: 'integer', minimum: 1 },
    anchor: { $ref: '#/$defs/MacroAnchor' },
    inputDigest: { type: 'string', pattern: HASH_PATTERN },
    planDigest: { type: 'string', pattern: HASH_PATTERN },
    createdAt: { type: 'string' },
    expiresAt: { type: 'string' },
    operations: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['op', 'element'],
        properties: { op: { const: 'upsertElement' }, element: { $ref: '#/$defs/CanvasElement' } }
      }
    },
    previewElements: { type: 'array', items: { $ref: '#/$defs/CanvasElement' } },
    outputs: { type: 'object', additionalProperties: { type: 'string', minLength: 1 } },
    effectSummary: { $ref: '#/$defs/MacroEffectSummary' }
  }
};

const executionResult: JsonObject = {
  type: 'object',
  additionalProperties: false,
  required: ['canvas', 'provenance', 'outputs', 'history'],
  properties: {
    canvas: { oneOf: [{ $ref: '#/$defs/MacroCanvasSnapshot' }, { $ref: '#/$defs/MacroCanvasRecord' }] },
    provenance: { $ref: '#/$defs/MacroProvenance' },
    outputs: { type: 'object', additionalProperties: { type: 'string', minLength: 1 } },
    history: { $ref: '#/$defs/MacroHistory' }
  }
};

const errorEnvelope: JsonObject = {
  type: 'object',
  additionalProperties: false,
  required: ['ok', 'code', 'message', 'stage', 'retryable', 'status'],
  properties: {
    ok: { const: false },
    code: {
      enum: [
        'macro_definition_invalid',
        'macro_definition_too_large',
        'macro_input_invalid',
        'macro_input_too_large',
        'macro_unsafe',
        'macro_ref_invalid',
        'macro_ref_pointer_invalid',
        'macro_ref_missing',
        'macro_scope_denied',
        'macro_not_found',
        'macro_version_not_found',
        'macro_archived',
        'macro_version_mismatch',
        'macro_dependency_invalid',
        'macro_dependency_missing',
        'macro_element_invalid',
        'macro_limit_exceeded',
        'macro_canvas_limit_exceeded',
        'macro_plan_not_found',
        'macro_plan_expired',
        'macro_plan_stale',
        'macro_revision_conflict',
        'macro_idempotency_invalid',
        'macro_idempotency_conflict',
        'macro_execution_invalid'
      ]
    },
    message: { type: 'string', minLength: 1 },
    stage: { enum: ['definition', 'input', 'planning', 'repository', 'plan', 'execution', 'revision', 'idempotency'] },
    retryable: { type: 'boolean' },
    status: { type: 'integer', minimum: 400, maximum: 599 },
    details: { type: 'object', additionalProperties: { $ref: '#/$defs/JsonValue' } }
  }
};

const macroDefinitionRecord: JsonObject = {
  type: 'object',
  additionalProperties: false,
  required: ['definition', 'currentVersion', 'archived'],
  properties: {
    definition: { $ref: '#/$defs/MacroDefinitionV1' },
    currentVersion: { type: 'integer', minimum: 1 },
    archived: { type: 'boolean' }
  }
};

const macroSummary: JsonObject = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'scope', 'currentVersion', 'archived', 'title', 'createdAt', 'updatedAt'],
  properties: {
    id: { type: 'string', pattern: ID_PATTERN },
    scope: { enum: ['installation', 'canvas'] },
    canvasId: { type: 'string', pattern: KEY_PATTERN },
    currentVersion: { type: 'integer', minimum: 1 },
    archived: { type: 'boolean' },
    title: { type: 'string', minLength: 1 },
    description: { type: 'string' },
    category: { type: 'string' },
    createdAt: { type: 'string', minLength: 1 },
    updatedAt: { type: 'string', minLength: 1 }
  },
  allOf: macroScopeConditions
};

const requestCanvasId = { type: 'string', minLength: 1 };
const requestMacroId = { type: 'string', pattern: ID_PATTERN };
const requestVersion = { type: 'integer', minimum: 1 };
const requestInput = {
  ...jsonObject,
  description:
    'Macro references are evaluated in saved template payloads. Values read from invocation input are inserted as literal JSON.'
};
const planRequest: JsonObject = {
  type: 'object',
  additionalProperties: false,
  required: ['canvasId', 'macroId', 'macroVersion', 'anchor', 'input'],
  properties: {
    canvasId: requestCanvasId,
    macroId: requestMacroId,
    macroVersion: requestVersion,
    anchor: { $ref: '#/$defs/MacroAnchor' },
    input: requestInput,
    label: { type: 'string' }
  }
};

const executeRequest: JsonObject = {
  type: 'object',
  additionalProperties: false,
  required: ['canvasId', 'planId', 'expectedRevision', 'idempotencyKey'],
  properties: {
    canvasId: requestCanvasId,
    planId: { type: 'string', pattern: PLAN_ID_PATTERN },
    expectedRevision: { type: 'integer', minimum: 1 },
    idempotencyKey: { type: 'string', minLength: 1, maxLength: 256 }
  }
};

const listRequest: JsonObject = {
  type: 'object',
  additionalProperties: false,
  properties: {
    canvasId: requestCanvasId,
    includeArchived: { type: 'boolean' },
    limit: { type: 'integer', minimum: 1, maximum: 100 },
    cursor: { type: 'string', minLength: 1 }
  }
};

const listResponse: JsonObject = {
  type: 'object',
  additionalProperties: false,
  required: ['items'],
  properties: {
    items: { type: 'array', items: { $ref: '#/$defs/MacroSummary' } },
    nextCursor: { type: 'string', minLength: 1 }
  }
};

const getRequest: JsonObject = {
  type: 'object',
  additionalProperties: false,
  required: ['macroId', 'macroVersion'],
  properties: { macroId: requestMacroId, macroVersion: requestVersion, canvasId: requestCanvasId }
};

const archiveRequest: JsonObject = {
  type: 'object',
  additionalProperties: false,
  required: ['macroId', 'archived'],
  properties: { macroId: requestMacroId, archived: { type: 'boolean' } }
};

const archiveResponse: JsonObject = {
  type: 'object',
  additionalProperties: false,
  required: ['macroId', 'currentVersion', 'archived'],
  properties: { macroId: requestMacroId, currentVersion: requestVersion, archived: { type: 'boolean' } }
};

const createVersionRequest: JsonObject = {
  ...authoringDefinition,
  required: ['macroId', ...(authoringDefinition.required as string[]).filter((key) => key !== 'macroId')],
  properties: {
    ...(authoringDefinition.properties as JsonObject),
    macroId: requestMacroId,
    expectedCurrentVersion: requestVersion
  }
};

const httpCreateVersionRequest: JsonObject = {
  ...authoringDefinition,
  properties: {
    ...(authoringDefinition.properties as JsonObject),
    expectedCurrentVersion: requestVersion
  }
};

const httpArchiveRequest: JsonObject = {
  type: 'object',
  additionalProperties: false,
  required: ['archived'],
  properties: { archived: { type: 'boolean' } }
};

const httpPlanRequest: JsonObject = {
  type: 'object',
  additionalProperties: false,
  required: ['macroVersion', 'anchor', 'input'],
  properties: {
    macroVersion: requestVersion,
    anchor: { $ref: '#/$defs/MacroAnchor' },
    input: requestInput,
    label: { type: 'string' }
  }
};

const httpExecuteRequest: JsonObject = {
  type: 'object',
  additionalProperties: false,
  required: ['planId', 'expectedRevision', 'idempotencyKey'],
  properties: {
    planId: { type: 'string', pattern: PLAN_ID_PATTERN },
    expectedRevision: { type: 'integer', minimum: 1 },
    idempotencyKey: { type: 'string', minLength: 1, maxLength: 256 }
  }
};

const directRequest: JsonObject = {
  type: 'object',
  additionalProperties: false,
  required: ['mode', 'canvasId', 'macroId', 'macroVersion', 'anchor', 'input', 'expectedRevision', 'idempotencyKey'],
  properties: {
    mode: { const: 'direct' },
    canvasId: requestCanvasId,
    macroId: requestMacroId,
    macroVersion: requestVersion,
    anchor: { $ref: '#/$defs/MacroAnchor' },
    input: requestInput,
    expectedRevision: { type: 'integer', minimum: 1 },
    idempotencyKey: { type: 'string', minLength: 1, maxLength: 256 },
    label: { type: 'string' }
  }
};

const runPlanRequest: JsonObject = {
  type: 'object',
  additionalProperties: false,
  required: ['mode', 'canvasId', 'planId', 'expectedRevision', 'idempotencyKey'],
  properties: {
    mode: { const: 'plan' },
    canvasId: requestCanvasId,
    planId: { type: 'string', pattern: PLAN_ID_PATTERN },
    expectedRevision: { type: 'integer', minimum: 1 },
    idempotencyKey: { type: 'string', minLength: 1, maxLength: 256 }
  }
};

const canvasRunMacroRequest: JsonObject = {
  type: 'object',
  oneOf: [directRequest, runPlanRequest]
};

const sharedDefinitions: Record<string, JsonObject> = {
  JsonValue: jsonValue,
  JsonObject: jsonObject,
  MacroAnchor: anchor,
  MacroRef: macroRef,
  MacroDependency: dependency,
  MacroElementTemplate: elementTemplate,
  InputSchemaObject: inputSchema,
  MacroDefinitionAuthoringV1: authoringDefinition,
  MacroDefinitionV1: storedDefinition,
  CanvasElement: canvasElement,
  MacroCanvasSnapshot: canvasSnapshot,
  MacroCanvasRecord: canvasRecord,
  MacroOperation: macroOperation,
  MacroEffectSummary: effectSummary,
  MacroProvenance: provenance,
  MacroHistory: history,
  MacroPlan: plan,
  MacroExecutionResult: executionResult,
  MacroErrorEnvelope: errorEnvelope,
  MacroDefinitionRecord: macroDefinitionRecord,
  MacroSummary: macroSummary
};

function root(id: string, shape: JsonObject): JsonSchema {
  return { $id: `${COMPONENT_PREFIX}${id}.json`, $schema: DRAFT_2020_12, ...shape, $defs: sharedDefinitions };
}

const componentShapes: Record<string, JsonSchema> = {
  MacroDefinitionV1: root('MacroDefinitionV1', storedDefinition),
  MacroDefinitionAuthoringV1: root('MacroDefinitionAuthoringV1', authoringDefinition),
  MacroSummary: root('MacroSummary', macroSummary),
  MacroRef: root('MacroRef', macroRef),
  MacroAnchor: root('MacroAnchor', anchor),
  MacroDependency: root('MacroDependency', dependency),
  MacroElementTemplate: root('MacroElementTemplate', elementTemplate),
  MacroPlan: root('MacroPlan', plan),
  MacroEffectSummary: root('MacroEffectSummary', effectSummary),
  MacroProvenance: root('MacroProvenance', provenance),
  MacroHistory: root('MacroHistory', history),
  MacroExecutionResult: root('MacroExecutionResult', executionResult),
  MacroErrorEnvelope: root('MacroErrorEnvelope', errorEnvelope),
  MacroListRequest: root('MacroListRequest', listRequest),
  MacroListResponse: root('MacroListResponse', listResponse),
  MacroGetRequest: root('MacroGetRequest', getRequest),
  MacroGetResponse: root('MacroGetResponse', macroDefinitionRecord),
  MacroCreateRequest: root('MacroCreateRequest', authoringDefinition),
  MacroCreateResponse: root('MacroCreateResponse', macroDefinitionRecord),
  MacroCreateVersionRequest: root('MacroCreateVersionRequest', createVersionRequest),
  MacroHttpCreateVersionRequest: root('MacroHttpCreateVersionRequest', httpCreateVersionRequest),
  MacroCreateVersionResponse: root('MacroCreateVersionResponse', macroDefinitionRecord),
  MacroArchiveRequest: root('MacroArchiveRequest', archiveRequest),
  MacroHttpArchiveRequest: root('MacroHttpArchiveRequest', httpArchiveRequest),
  MacroArchiveResponse: root('MacroArchiveResponse', archiveResponse),
  MacroPlanRequest: root('MacroPlanRequest', planRequest),
  MacroHttpPlanRequest: root('MacroHttpPlanRequest', httpPlanRequest),
  MacroPlanResponse: root('MacroPlanResponse', plan),
  MacroExecuteRequest: root('MacroExecuteRequest', executeRequest),
  MacroHttpExecuteRequest: root('MacroHttpExecuteRequest', httpExecuteRequest),
  MacroExecuteResponse: root('MacroExecuteResponse', executionResult),
  CanvasRunMacroDirectRequest: root('CanvasRunMacroDirectRequest', directRequest),
  CanvasRunMacroDirectResponse: root('CanvasRunMacroDirectResponse', executionResult),
  CanvasRunMacroPlanRequest: root('CanvasRunMacroPlanRequest', runPlanRequest),
  CanvasRunMacroPlanResponse: root('CanvasRunMacroPlanResponse', executionResult),
  CanvasRunMacroRequest: root('CanvasRunMacroRequest', canvasRunMacroRequest),
  CanvasRunMacroResponse: root('CanvasRunMacroResponse', executionResult)
};

export type MacroSchemaName = keyof typeof componentShapes;

export const MACRO_SCHEMA_CATALOG = deepFreeze({
  components: componentShapes,
  schemas: componentShapes,
  ids: Object.fromEntries(
    Object.entries(componentShapes).map(([name, schema]) => [name, typeof schema === 'boolean' ? '' : schema.$id])
  )
}) as Readonly<{
  components: Readonly<Record<MacroSchemaName, JsonSchema>>;
  schemas: Readonly<Record<MacroSchemaName, JsonSchema>>;
  ids: Readonly<Record<MacroSchemaName, string>>;
}>;

export const macroSchemaCatalog = MACRO_SCHEMA_CATALOG;

export function getMacroOpenApiComponentSchemas(): Readonly<Record<MacroSchemaName, JsonSchema>> {
  const sharedNames = Object.keys(sharedDefinitions);
  const componentNameFor = (name: string): string => (name === 'CanvasElement' ? 'MacroCanvasElement' : `Macro${name}`);
  const rewrite = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(rewrite);
    if (!value || typeof value !== 'object') return value;
    const object = value as Record<string, unknown>;
    const rewritten = Object.fromEntries(Object.entries(object).map(([key, entry]) => [key, rewrite(entry)]));
    if (typeof rewritten.$ref === 'string' && rewritten.$ref.startsWith('#/$defs/')) {
      const name = rewritten.$ref.slice('#/$defs/'.length);
      rewritten.$ref = `#/components/schemas/${componentNameFor(name)}`;
    }
    delete rewritten.$defs;
    delete rewritten.$id;
    delete rewritten.$schema;
    return rewritten;
  };
  const projected: Record<string, JsonSchema> = {};
  for (const name of sharedNames) projected[componentNameFor(name)] = rewrite(sharedDefinitions[name]) as JsonSchema;
  for (const [name, schema] of Object.entries(MACRO_SCHEMA_CATALOG.components))
    projected[name] = rewrite(schema) as JsonSchema;
  return Object.freeze(projected) as Readonly<Record<MacroSchemaName, JsonSchema>>;
}

export const macroOpenApiComponentSchemas = getMacroOpenApiComponentSchemas;

export const MACRO_DEFINITION_V1_SCHEMA = MACRO_SCHEMA_CATALOG.schemas.MacroDefinitionV1;
export const MACRO_DEFINITION_AUTHORING_V1_SCHEMA = MACRO_SCHEMA_CATALOG.schemas.MacroDefinitionAuthoringV1;
export const MACRO_SUMMARY_SCHEMA = MACRO_SCHEMA_CATALOG.schemas.MacroSummary;
export const MACRO_REF_SCHEMA = MACRO_SCHEMA_CATALOG.schemas.MacroRef;
export const MACRO_ANCHOR_SCHEMA = MACRO_SCHEMA_CATALOG.schemas.MacroAnchor;
export const MACRO_DEPENDENCY_SCHEMA = MACRO_SCHEMA_CATALOG.schemas.MacroDependency;
export const MACRO_ELEMENT_TEMPLATE_SCHEMA = MACRO_SCHEMA_CATALOG.schemas.MacroElementTemplate;
export const MACRO_PLAN_SCHEMA = MACRO_SCHEMA_CATALOG.schemas.MacroPlan;
export const MACRO_EFFECT_SUMMARY_SCHEMA = MACRO_SCHEMA_CATALOG.schemas.MacroEffectSummary;
export const MACRO_PROVENANCE_SCHEMA = MACRO_SCHEMA_CATALOG.schemas.MacroProvenance;
export const MACRO_HISTORY_SCHEMA = MACRO_SCHEMA_CATALOG.schemas.MacroHistory;
export const MACRO_EXECUTION_RESULT_SCHEMA = MACRO_SCHEMA_CATALOG.schemas.MacroExecutionResult;
export const MACRO_ERROR_ENVELOPE_SCHEMA = MACRO_SCHEMA_CATALOG.schemas.MacroErrorEnvelope;
export const MACRO_LIST_REQUEST_SCHEMA = MACRO_SCHEMA_CATALOG.schemas.MacroListRequest;
export const MACRO_LIST_RESPONSE_SCHEMA = MACRO_SCHEMA_CATALOG.schemas.MacroListResponse;
export const MACRO_GET_REQUEST_SCHEMA = MACRO_SCHEMA_CATALOG.schemas.MacroGetRequest;
export const MACRO_GET_RESPONSE_SCHEMA = MACRO_SCHEMA_CATALOG.schemas.MacroGetResponse;
export const MACRO_CREATE_REQUEST_SCHEMA = MACRO_SCHEMA_CATALOG.schemas.MacroCreateRequest;
export const MACRO_CREATE_RESPONSE_SCHEMA = MACRO_SCHEMA_CATALOG.schemas.MacroCreateResponse;
export const MACRO_CREATE_VERSION_REQUEST_SCHEMA = MACRO_SCHEMA_CATALOG.schemas.MacroCreateVersionRequest;
export const MACRO_HTTP_CREATE_VERSION_REQUEST_SCHEMA = MACRO_SCHEMA_CATALOG.schemas.MacroHttpCreateVersionRequest;
export const MACRO_CREATE_VERSION_RESPONSE_SCHEMA = MACRO_SCHEMA_CATALOG.schemas.MacroCreateVersionResponse;
export const MACRO_ARCHIVE_REQUEST_SCHEMA = MACRO_SCHEMA_CATALOG.schemas.MacroArchiveRequest;
export const MACRO_HTTP_ARCHIVE_REQUEST_SCHEMA = MACRO_SCHEMA_CATALOG.schemas.MacroHttpArchiveRequest;
export const MACRO_ARCHIVE_RESPONSE_SCHEMA = MACRO_SCHEMA_CATALOG.schemas.MacroArchiveResponse;
export const MACRO_PLAN_REQUEST_SCHEMA = MACRO_SCHEMA_CATALOG.schemas.MacroPlanRequest;
export const MACRO_HTTP_PLAN_REQUEST_SCHEMA = MACRO_SCHEMA_CATALOG.schemas.MacroHttpPlanRequest;
export const MACRO_PLAN_RESPONSE_SCHEMA = MACRO_SCHEMA_CATALOG.schemas.MacroPlanResponse;
export const MACRO_EXECUTE_REQUEST_SCHEMA = MACRO_SCHEMA_CATALOG.schemas.MacroExecuteRequest;
export const MACRO_HTTP_EXECUTE_REQUEST_SCHEMA = MACRO_SCHEMA_CATALOG.schemas.MacroHttpExecuteRequest;
export const MACRO_EXECUTE_RESPONSE_SCHEMA = MACRO_SCHEMA_CATALOG.schemas.MacroExecuteResponse;
export const CANVAS_RUN_MACRO_DIRECT_REQUEST_SCHEMA = MACRO_SCHEMA_CATALOG.schemas.CanvasRunMacroDirectRequest;
export const CANVAS_RUN_MACRO_DIRECT_RESPONSE_SCHEMA = MACRO_SCHEMA_CATALOG.schemas.CanvasRunMacroDirectResponse;
export const CANVAS_RUN_MACRO_PLAN_REQUEST_SCHEMA = MACRO_SCHEMA_CATALOG.schemas.CanvasRunMacroPlanRequest;
export const CANVAS_RUN_MACRO_PLAN_RESPONSE_SCHEMA = MACRO_SCHEMA_CATALOG.schemas.CanvasRunMacroPlanResponse;
export const CANVAS_RUN_MACRO_REQUEST_SCHEMA = MACRO_SCHEMA_CATALOG.schemas.CanvasRunMacroRequest;
export const CANVAS_RUN_MACRO_RESPONSE_SCHEMA = MACRO_SCHEMA_CATALOG.schemas.CanvasRunMacroResponse;
