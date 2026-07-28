import Ajv2020, { type ErrorObject } from 'ajv/dist/2020.js';
import type { JsonObject, JsonSchema } from '@agentcanvas/plugin-sdk';
import { applyMacroInputDefaults } from './input-defaults.js';

export interface MacroInputValidationResult {
  input: JsonObject;
  errors: readonly string[];
}

function errorPath(error: ErrorObject): string {
  const path = error.instancePath
    .split('/')
    .filter(Boolean)
    .map((part) => part.replaceAll('~1', '/').replaceAll('~0', '~'));
  if (error.keyword === 'required' && typeof error.params.missingProperty === 'string') {
    path.push(error.params.missingProperty);
  }
  return path.length === 0 ? 'Input' : `Input.${path.join('.')}`;
}

function describeError(error: ErrorObject): string {
  const path = errorPath(error);
  if (error.keyword === 'required') return `${path} is required.`;
  if (error.keyword === 'additionalProperties') return `${path} contains an unsupported property.`;
  if (error.keyword === 'type') return `${path} ${error.message ?? 'has an invalid type'}.`;
  if (error.keyword === 'pattern') return `${path} must match the required pattern.`;
  if (error.keyword === 'minItems') return `${path} must contain at least ${String(error.params.limit)} item(s).`;
  if (error.keyword === 'maxItems') return `${path} must contain at most ${String(error.params.limit)} item(s).`;
  if (error.keyword === 'minLength') return `${path} is too short.`;
  if (error.keyword === 'maxLength') return `${path} is too long.`;
  if (error.keyword === 'minimum' || error.keyword === 'exclusiveMinimum') return `${path} is below the minimum.`;
  if (error.keyword === 'maximum' || error.keyword === 'exclusiveMaximum') return `${path} is above the maximum.`;
  return `${path} ${error.message ?? 'is invalid'}.`;
}

export function validateMacroInput(schema: JsonSchema, raw: JsonObject): MacroInputValidationResult {
  const ajv = new Ajv2020({ strict: true, allErrors: true, useDefaults: true });
  ajv.addFormat('textarea', true);
  ajv.addFormat('multiline', true);
  const validator = ajv.compile(schema);
  const input = applyMacroInputDefaults(schema, raw);
  const valid = validator(input);
  return {
    input,
    errors: valid ? [] : (validator.errors ?? []).map(describeError)
  };
}

export function defaultMacroInput(schema: JsonSchema): JsonObject {
  return applyMacroInputDefaults(schema, {});
}
