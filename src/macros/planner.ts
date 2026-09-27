import type { CanvasElement, CanvasOperation, JsonObject } from '../contracts.js';
import { isJsonObject, isJsonValue, type JsonValue } from '@agentcanvas/plugin-sdk';
import { elementFitsCanvasBounds } from '../validation.js';
import { MacroError } from './errors.js';
import { validateMacroInput } from './input-validation.js';
import { canonicalJson, deepFreeze, sha256 } from './canonical-json.js';
import {
  MACRO_INPUT_MAX_BYTES,
  MACRO_MAX_CANVAS_ELEMENTS,
  MACRO_MAX_ELEMENTS,
  MACRO_PLAN_TTL_MS,
  validateMacroDefinition,
  validateRefShape
} from './definition.js';
import type {
  MacroCanvasSnapshot,
  MacroAnchor,
  MacroDefinitionV1,
  MacroElementValidationContext,
  MacroElementTemplate,
  MacroPlan,
  MacroPlanRequest,
  MacroPlannerOptions,
  MacroProvenance,
  MacroUpsertOperation
} from './types.js';

export class MacroPlanner {
  private readonly options: MacroPlannerOptions;

  constructor(options: MacroPlannerOptions = {}) {
    this.options = options;
  }

  plan(definition: MacroDefinitionV1, request: MacroPlanRequest, canvas: MacroCanvasSnapshot): MacroPlan {
    return createMacroPlan(definition, request, canvas, this.options);
  }
}

export function createMacroPlan(
  definitionValue: MacroDefinitionV1,
  request: MacroPlanRequest,
  canvas: MacroCanvasSnapshot,
  options: MacroPlannerOptions = {}
): MacroPlan {
  const definition = validateMacroDefinition(definitionValue);
  const anchor = validateMacroAnchor(request.anchor);
  checkCanvas(request, canvas);
  if (definition.scope === 'canvas' && definition.canvasId !== request.canvasId) {
    throw new MacroError('macro_scope_denied', 'macro definition is scoped to another canvas', 'planning', {
      status: 403
    });
  }
  if (!isJsonObject(request.input)) inputInvalid('macro input must be an object');
  if (jsonBytes(request.input) > MACRO_INPUT_MAX_BYTES) {
    throw new MacroError('macro_input_too_large', 'macro input exceeds 256 KiB', 'input');
  }
  const input = validateInput(definition.inputSchema, request.input);
  if (jsonBytes(input) > MACRO_INPUT_MAX_BYTES) {
    throw new MacroError('macro_input_too_large', 'macro input with defaults exceeds 256 KiB', 'input');
  }
  if (definition.dependencies !== undefined) {
    if (!options.validateDependencies) {
      throw new MacroError('macro_dependency_missing', 'macro dependencies are unavailable', 'planning');
    }
    try {
      options.validateDependencies(definition.dependencies, { canvasId: request.canvasId, definition });
    } catch (error) {
      if (error instanceof MacroError) throw error;
      throw new MacroError('macro_dependency_missing', 'macro dependencies are unavailable', 'planning');
    }
  }
  if (definition.elements.length > MACRO_MAX_ELEMENTS) {
    throw new MacroError('macro_limit_exceeded', 'macro plan exceeds 100 generated elements', 'planning');
  }
  if (!options.validateElement) {
    throw new MacroError('macro_element_invalid', 'generated elements require an element validator', 'planning');
  }
  const validateElement = options.validateElement;
  const inputDigest = sha256(input);
  const seed = sha256(
    canonicalJson({
      canvasId: request.canvasId,
      canvasRevision: canvas.revision,
      anchor,
      definition,
      input
    })
  );
  const generatedIds = new Map<string, string>();
  for (const template of definition.elements) generatedIds.set(template.key, generatedId(seed, template.key));
  const elements = definition.elements.map((template) => expandTemplate(template, anchor, generatedIds, input));
  const validated = elements.map((element, index) =>
    validatePlannedElement(element, definition.elements[index], request, definition, validateElement)
  );
  checkCanvasBounds(validated, canvas);
  if (
    canvas.elements.length > MACRO_MAX_CANVAS_ELEMENTS ||
    canvas.elements.length + validated.length > MACRO_MAX_CANVAS_ELEMENTS
  ) {
    throw new MacroError('macro_canvas_limit_exceeded', 'macro plan would exceed 2000 canvas elements', 'planning');
  }
  const operations: readonly MacroUpsertOperation[] = validated.map((element) => ({ op: 'upsertElement', element }));
  const planDigest = sha256({
    canvasId: request.canvasId,
    canvasRevision: canvas.revision,
    anchor,
    definition,
    input,
    operations
  });
  const now = resolveNow(request.now, options.now);
  const createdAt = new Date(now).toISOString();
  const expiresAt = new Date(now + MACRO_PLAN_TTL_MS).toISOString();
  const planId = `macro_plan_${sha256(`${request.canvasId}\0${planDigest}`).slice(0, 48)}`;
  const outputs = Object.fromEntries(
    Object.entries(definition.outputs ?? {}).map(([name, key]) => [name, generatedIds.get(key) as string])
  );
  const affectedElementIds = validated.map((element) => element.id);
  const label = request.label ?? definition.title;
  const plan: MacroPlan = {
    planId,
    macroId: definition.id,
    macroVersion: definition.version,
    canvasId: request.canvasId,
    canvasRevision: canvas.revision,
    anchor,
    inputDigest,
    planDigest,
    createdAt,
    expiresAt,
    operations,
    previewElements: structuredClone(validated),
    outputs,
    effectSummary: {
      label,
      operationCount: operations.length,
      generatedElementCount: validated.length,
      affectedElementIds
    }
  };
  return deepFreeze(plan);
}

export const planMacro = createMacroPlan;

export function resolveMacroRef(
  value: JsonValue,
  input: JsonObject,
  generatedIds: ReadonlyMap<string, string>
): JsonValue {
  if (Array.isArray(value)) return value.map((child) => resolveMacroRef(child, input, generatedIds));
  if (!value || typeof value !== 'object') return value;
  if ('$macroRef' in value) {
    validateRefShape(value);
    const reference = value as unknown as Record<string, unknown>;
    if (reference.$macroRef === 'generatedElementId') {
      const id = generatedIds.get(reference.elementKey as string);
      if (!id)
        throw new MacroError('macro_ref_missing', 'generated element reference points to an unknown key', 'planning');
      return id;
    }
    return resolveJsonPointer(input, reference.pointer as string);
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [key, resolveMacroRef(child, input, generatedIds)])
  ) as JsonObject;
}

export function resolveJsonPointer(document: JsonValue, pointer: string): JsonValue {
  if (pointer === '') return structuredClone(document);
  if (typeof pointer !== 'string' || !pointer.startsWith('/')) {
    throw new MacroError(
      'macro_ref_pointer_invalid',
      'input reference pointer must be an RFC 6901 JSON Pointer',
      'planning'
    );
  }
  let current: JsonValue = document;
  for (const rawToken of pointer.slice(1).split('/')) {
    const token = decodePointerToken(rawToken);
    if (Array.isArray(current)) {
      if (!/^(0|[1-9][0-9]*)$/.test(token)) pointerMissing(pointer);
      const index = Number(token);
      if (!Number.isSafeInteger(index) || index >= current.length) pointerMissing(pointer);
      current = current[index];
    } else if (current !== null && typeof current === 'object') {
      if (!Object.hasOwn(current, token) || token === '__proto__' || token === 'constructor' || token === 'prototype')
        pointerMissing(pointer);
      current = current[token];
    } else pointerMissing(pointer);
  }
  return structuredClone(current);
}

function expandTemplate(
  template: MacroElementTemplate,
  anchor: MacroAnchor,
  generatedIds: ReadonlyMap<string, string>,
  input: JsonObject
): CanvasElement {
  const data = resolveMacroRef(template.data, input, generatedIds);
  const style =
    template.style === null || template.style === undefined
      ? template.style
      : resolveMacroRef(template.style, input, generatedIds);
  const metadata =
    template.metadata === undefined ? undefined : resolveMacroRef(template.metadata, input, generatedIds);
  if (!isJsonObject(data))
    throw new MacroError('macro_element_invalid', `${template.key} data must resolve to an object`, 'planning');
  if (style !== undefined && style !== null && !isJsonObject(style))
    throw new MacroError('macro_element_invalid', `${template.key} style must resolve to an object`, 'planning');
  if (metadata !== undefined && !isJsonObject(metadata))
    throw new MacroError('macro_element_invalid', `${template.key} metadata must resolve to an object`, 'planning');
  const x = anchor.x + template.x;
  const y = anchor.y + template.y;
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    throw new MacroError(
      'macro_element_invalid',
      `${template.key} position must be finite after applying the anchor`,
      'planning'
    );
  }
  return {
    id: generatedIds.get(template.key) as string,
    type: template.type as CanvasElement['type'],
    schemaVersion: template.schemaVersion,
    x,
    y,
    width: template.width,
    height: template.height,
    data,
    ...(style !== undefined ? { style } : {}),
    ...(metadata !== undefined ? { metadata } : {})
  } as CanvasElement;
}

function validatePlannedElement(
  element: CanvasElement,
  template: MacroElementTemplate,
  request: MacroPlanRequest,
  definition: MacroDefinitionV1,
  validateElement: NonNullable<MacroPlannerOptions['validateElement']>
): CanvasElement {
  try {
    const result = validateElement(element, { canvasId: request.canvasId, definition, elementKey: template.key });
    if (
      !result ||
      result.id !== element.id ||
      result.type !== template.type ||
      result.schemaVersion !== template.schemaVersion
    ) {
      throw new Error('element validator changed immutable element identity');
    }
    if (
      result.x !== element.x ||
      result.y !== element.y ||
      result.width !== element.width ||
      result.height !== element.height
    ) {
      throw new Error('element validator changed fixed macro geometry');
    }
    return structuredClone(result);
  } catch (error) {
    if (error instanceof MacroError) throw error;
    throw new MacroError('macro_element_invalid', `element ${template.key} failed validation`, 'planning');
  }
}

function validateInput(schema: JsonObject, raw: JsonObject): JsonObject {
  try {
    const result = validateMacroInput(schema, raw);
    if (result.errors.length > 0) throw new Error(result.errors.join(' '));
    return result.input;
  } catch {
    throw new MacroError('macro_input_invalid', 'macro input does not satisfy the input schema', 'input');
  }
}

export function validateMacroAnchor(value: unknown): MacroAnchor {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new MacroError('macro_definition_invalid', 'macro invocation anchor must be an object', 'planning');
  }
  const anchor = value as Record<string, unknown>;
  if (
    Object.keys(anchor).length !== 2 ||
    typeof anchor.x !== 'number' ||
    !Number.isFinite(anchor.x) ||
    typeof anchor.y !== 'number' ||
    !Number.isFinite(anchor.y)
  ) {
    throw new MacroError(
      'macro_definition_invalid',
      'macro invocation anchor.x and anchor.y must be finite numbers',
      'planning'
    );
  }
  return { x: anchor.x, y: anchor.y };
}

function checkCanvas(request: MacroPlanRequest, canvas: MacroCanvasSnapshot): void {
  if (canvas.id !== request.canvasId)
    throw new MacroError('macro_scope_denied', 'macro canvas context does not match the requested canvas', 'planning');
  if (canvas.archived) throw new MacroError('macro_archived', 'canvas is archived', 'planning');
  if (!Number.isSafeInteger(canvas.revision) || canvas.revision < 1)
    throw new MacroError('macro_plan_stale', 'canvas revision is invalid', 'revision');
  if (!Array.isArray(canvas.elements))
    throw new MacroError('macro_element_invalid', 'canvas elements are invalid', 'planning');
}

function checkCanvasBounds(elements: readonly CanvasElement[], canvas: MacroCanvasSnapshot): void {
  for (const element of elements) {
    if (!elementFitsCanvasBounds(element, canvas.bounds)) {
      throw new MacroError(
        'macro_element_invalid',
        `element ${element.id} does not fit within the canvas bounds`,
        'planning'
      );
    }
  }
}

function generatedId(seed: string, key: string): string {
  return `macro_${seed.slice(0, 32)}_${key}`;
}

function decodePointerToken(token: string): string {
  let decoded = '';
  for (let index = 0; index < token.length; index += 1) {
    if (token[index] !== '~') {
      decoded += token[index];
      continue;
    }
    const escapeCode = token[index + 1];
    if (escapeCode !== '0' && escapeCode !== '1') {
      throw new MacroError(
        'macro_ref_pointer_invalid',
        'input reference pointer contains an invalid escape',
        'planning'
      );
    }
    decoded += escapeCode === '0' ? '~' : '/';
    index += 1;
  }
  return decoded;
}

function pointerMissing(pointer: string): never {
  throw new MacroError('macro_ref_missing', `input reference pointer does not resolve: ${pointer}`, 'planning');
}

function inputInvalid(message: string): never {
  throw new MacroError('macro_input_invalid', message, 'input');
}

function jsonBytes(value: JsonValue): number {
  return Buffer.byteLength(canonicalJson(value), 'utf8');
}

function resolveNow(value: Date | number | undefined, clock: (() => number) | undefined): number {
  const now = value instanceof Date ? value.getTime() : (value ?? clock?.() ?? Date.now());
  if (!Number.isFinite(now))
    throw new MacroError('macro_execution_invalid', 'macro clock returned an invalid time', 'planning');
  return now;
}

export function provenanceForPlan(plan: MacroPlan): MacroProvenance {
  return {
    macroId: plan.macroId,
    macroVersion: plan.macroVersion,
    planId: plan.planId,
    inputDigest: plan.inputDigest,
    planDigest: plan.planDigest
  };
}
