import Ajv2020, { type ValidateFunction } from 'ajv/dist/2020.js';
import type { JsonObject } from '../contracts.js';
import { isJsonObject, isJsonValue, type JsonValue } from '@agentcanvas/plugin-sdk';
import { MacroError } from './errors.js';
import { MACRO_ELEMENT_TYPE_PATTERN } from './schema-catalog.js';
import type { MacroDefinitionV1, MacroDependency, MacroElementTemplate, MacroRef } from './types.js';
import { byteLength, deepFreeze } from './canonical-json.js';

export const MACRO_DEFINITION_MAX_BYTES = 256 * 1024;
export const MACRO_INPUT_MAX_BYTES = 256 * 1024;
export const MACRO_MAX_ELEMENTS = 100;
export const MACRO_MAX_CANVAS_ELEMENTS = 2_000;
export const MACRO_PLAN_TTL_MS = 5 * 60 * 1_000;

const KEY_PATTERN = /^[A-Za-z][A-Za-z0-9_.:-]{0,63}$/;
const ID_PATTERN = /^[A-Za-z][A-Za-z0-9_.:-]{0,63}(?:\/[A-Za-z][A-Za-z0-9_.:-]{0,63})?$/;
const OUTPUT_PATTERN = /^[A-Za-z][A-Za-z0-9_.:-]{0,63}$/;

export function validateMacroDefinition(value: unknown): MacroDefinitionV1 {
  if (!isJsonValue(value) || !value || typeof value !== 'object' || Array.isArray(value))
    invalid('definition must be a JSON object');
  const input = value as Record<string, unknown>;
  if (byteLength(input as JsonObject) > MACRO_DEFINITION_MAX_BYTES) {
    throw new MacroError('macro_definition_too_large', 'macro definition exceeds 256 KiB', 'definition');
  }
  exactKeys(
    input,
    [
      'id',
      'version',
      'scope',
      'canvasId',
      'title',
      'description',
      'category',
      'inputSchema',
      'dependencies',
      'elements',
      'outputs'
    ],
    'definition'
  );
  stringField(input.id, 'definition.id', ID_PATTERN);
  if (!Number.isSafeInteger(input.version) || (input.version as number) < 1)
    invalid('definition.version must be a positive integer');
  if (input.scope !== 'installation' && input.scope !== 'canvas')
    invalid('definition.scope must be installation or canvas');
  if (input.scope === 'canvas') stringField(input.canvasId, 'definition.canvasId', KEY_PATTERN);
  if (input.scope === 'installation' && input.canvasId !== undefined)
    invalid('installation definitions cannot specify canvasId');
  stringField(input.title, 'definition.title');
  if (input.description !== undefined) stringField(input.description, 'definition.description');
  if (input.category !== undefined) stringField(input.category, 'definition.category');
  if (!isJsonObject(input.inputSchema)) invalid('definition.inputSchema must be an object JSON Schema');
  validateLocalSchema(input.inputSchema);
  let dependencies: readonly MacroDependency[] | undefined;
  if (input.dependencies !== undefined) {
    if (!Array.isArray(input.dependencies))
      invalid('definition.dependencies must be an array of exact dependency objects');
    dependencies = input.dependencies.map((dependency, index) => validateDependency(dependency, index));
    const dependencyKeys = new Set(
      dependencies.map((dependency) => `${dependency.elementType}\0${dependency.schemaVersion}`)
    );
    if (dependencyKeys.size !== dependencies.length) invalid('definition.dependencies must be unique');
  }
  if (!Array.isArray(input.elements)) invalid('definition.elements must be an array');
  if (input.elements.length > MACRO_MAX_ELEMENTS) {
    throw new MacroError(
      'macro_limit_exceeded',
      'macro definition cannot contain more than 100 elements',
      'definition'
    );
  }
  const elements = input.elements.map((element, index) => validateTemplate(element, index));
  const keys = new Set(elements.map((element) => element.key));
  if (keys.size !== elements.length) invalid('definition.elements keys must be unique');
  if (input.outputs !== undefined) {
    if (!isJsonObject(input.outputs)) invalid('definition.outputs must be an object');
    for (const [name, key] of Object.entries(input.outputs)) {
      if (!OUTPUT_PATTERN.test(name)) invalid(`definition.outputs.${name} has an invalid output name`);
      stringField(key, `definition.outputs.${name}`, KEY_PATTERN);
      if (!keys.has(key)) invalid(`definition.outputs.${name} references an unknown element key`);
    }
  }
  return deepFreeze(
    structuredClone({
      ...input,
      elements,
      ...(dependencies !== undefined ? { dependencies: structuredClone(dependencies) } : {}),
      ...(input.outputs !== undefined ? { outputs: { ...input.outputs } } : {})
    }) as unknown as MacroDefinitionV1
  );
}

export function isMacroRef(value: unknown): value is MacroRef {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as unknown as Record<string, unknown>;
  return record.$macroRef === 'input' || record.$macroRef === 'generatedElementId';
}

export function validateRefShape(value: unknown): asserts value is MacroRef {
  if (!isMacroRef(value)) invalid('invalid macro reference', 'macro_ref_invalid');
  const record = value as unknown as Record<string, unknown>;
  const keys = Object.keys(record);
  if (record.$macroRef === 'input') {
    if (keys.length !== 2 || typeof record.pointer !== 'string')
      invalid('input macro reference requires only a pointer', 'macro_ref_invalid');
  } else if (keys.length !== 2 || typeof record.elementKey !== 'string' || !KEY_PATTERN.test(record.elementKey)) {
    invalid('generatedElementId macro reference requires only a valid elementKey', 'macro_ref_invalid');
  }
}

function validateTemplate(value: unknown, index: number): MacroElementTemplate {
  if (!isJsonObject(value)) invalid(`definition.elements[${index}] must be an object`);
  exactKeys(
    value,
    ['key', 'type', 'schemaVersion', 'x', 'y', 'width', 'height', 'data', 'style', 'metadata'],
    `definition.elements[${index}]`
  );
  stringField(value.key, `definition.elements[${index}].key`, KEY_PATTERN);
  if (typeof value.type !== 'string' || !MACRO_ELEMENT_TYPE_PATTERN.test(value.type))
    invalid(`definition.elements[${index}].type is invalid`);
  if (!Number.isSafeInteger(value.schemaVersion) || (value.schemaVersion as number) < 1)
    invalid(`definition.elements[${index}].schemaVersion must be a positive integer`);
  for (const name of ['x', 'y', 'width', 'height'] as const) {
    if (typeof value[name] !== 'number' || !Number.isFinite(value[name]))
      invalid(`definition.elements[${index}].${name} must be finite`);
    if ((name === 'width' || name === 'height') && (value[name] as number) <= 0)
      invalid(`definition.elements[${index}].${name} must be positive`);
  }
  if (!isJsonObject(value.data)) invalid(`definition.elements[${index}].data must be an object`);
  validateRefsOnlyInPayload(value.data, true);
  if (value.style !== undefined && value.style !== null) {
    if (!isJsonObject(value.style)) invalid(`definition.elements[${index}].style must be an object or null`);
    validateRefsOnlyInPayload(value.style, true);
  }
  if (value.metadata !== undefined) {
    if (!isJsonObject(value.metadata)) invalid(`definition.elements[${index}].metadata must be an object`);
    validateRefsOnlyInPayload(value.metadata, true);
  }
  return structuredClone(value) as unknown as MacroElementTemplate;
}

function validateDependency(value: unknown, index: number): MacroDependency {
  if (!isJsonObject(value)) invalid(`definition.dependencies[${index}] must be an object`);
  exactKeys(value, ['elementType', 'schemaVersion'], `definition.dependencies[${index}]`);
  if (typeof value.elementType !== 'string' || !MACRO_ELEMENT_TYPE_PATTERN.test(value.elementType)) {
    invalid(`definition.dependencies[${index}].elementType is invalid`);
  }
  if (!Number.isSafeInteger(value.schemaVersion) || (value.schemaVersion as number) < 1) {
    invalid(`definition.dependencies[${index}].schemaVersion must be a positive integer`);
  }
  return structuredClone(value) as unknown as MacroDependency;
}

function validateRefsOnlyInPayload(value: JsonValue, inPayload: boolean): void {
  if (Array.isArray(value)) {
    for (const child of value) validateRefsOnlyInPayload(child, inPayload);
    return;
  }
  if (!value || typeof value !== 'object') return;
  if ('$macroRef' in value) {
    if (!inPayload) invalid('macro references are only allowed in data, style, and metadata', 'macro_ref_invalid');
    validateRefShape(value);
    return;
  }
  for (const child of Object.values(value)) validateRefsOnlyInPayload(child, inPayload);
}

function validateLocalSchema(schema: JsonObject): void {
  if (schema.type !== 'object') invalid('definition.inputSchema.type must be object');
  walkSchema(schema, []);
  try {
    new Ajv2020({ strict: true, allErrors: true, useDefaults: true }).compile(schema);
  } catch {
    invalid('definition.inputSchema is not a valid draft 2020-12 schema');
  }
}

function walkSchema(value: JsonValue, path: string[]): void {
  if (Array.isArray(value)) {
    value.forEach((child, index) => {
      walkSchema(child, [...path, String(index)]);
    });
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if ((key === '$ref' || key === '$dynamicRef') && typeof child === 'string' && !child.startsWith('#')) {
      invalid('inputSchema cannot access external schemas', 'macro_unsafe');
    }
    walkSchema(child, [...path, key]);
  }
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[], label: string): void {
  const set = new Set(allowed);
  const unexpected = Object.keys(value).find((key) => !set.has(key));
  if (unexpected) invalid(`${label} has unexpected field ${unexpected}`);
}

function stringField(value: unknown, label: string, pattern?: RegExp): asserts value is string {
  if (typeof value !== 'string' || value.length === 0 || (pattern && !pattern.test(value)))
    invalid(`${label} is invalid`);
}

function invalid(
  message: string,
  code: 'macro_definition_invalid' | 'macro_unsafe' | 'macro_ref_invalid' = 'macro_definition_invalid'
): never {
  throw new MacroError(code, message, 'definition');
}
