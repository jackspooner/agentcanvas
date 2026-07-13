import type { CanvasElement, CanvasElementFramePatch, JsonObject } from '@agentcanvas/plugin-sdk';
import { isJsonObject, isLocalContributionName, isPluginId } from '@agentcanvas/plugin-sdk';
import Ajv2020, { type ValidateFunction } from 'ajv/dist/2020.js';
import { CanvasError } from '../errors.js';
import type { FrozenPluginRegistry } from './registry.js';

const ENVELOPE_KEYS = new Set([
  'id',
  'type',
  'schemaVersion',
  'x',
  'y',
  'width',
  'height',
  'zIndex',
  'rotation',
  'opacity',
  'locked',
  'style',
  'metadata',
  'data'
]);
const FRAME_KEYS = new Set(['x', 'y', 'width', 'height', 'zIndex', 'rotation', 'opacity', 'locked']);
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;

interface CompiledElementType {
  data: ValidateFunction;
  style?: ValidateFunction;
}

function validation(code: string, message: string, status = 400): never {
  throw new CanvasError(code, message, 'validation', status, false);
}

function optionalFinite(value: unknown, name: string): number | null | undefined {
  if (value === undefined || value === null) return value;
  if (typeof value !== 'number' || !Number.isFinite(value)) validation('validation_error', `${name} must be finite`);
  return value;
}

function elementType(value: unknown): `${string}/${string}` {
  if (typeof value !== 'string') validation('validation_error', 'element.type is required');
  const split = value.lastIndexOf('/');
  const pluginId = value.slice(0, split);
  const localName = value.slice(split + 1);
  if (split < 1 || !isPluginId(pluginId) || !isLocalContributionName(localName))
    validation('validation_error', 'element.type must be <plugin-id>/<local-type>');
  return value as `${string}/${string}`;
}

function schemaError(label: string, validator: ValidateFunction): never {
  const detail = (validator.errors ?? [])
    .map((issue) => `${issue.instancePath || '/'} ${issue.message ?? 'is invalid'}`)
    .join('; ');
  validation('validation_error', `${label} failed schema validation: ${detail}`);
}

export class PluginElementValidator {
  private readonly compiled = new Map<string, CompiledElementType>();

  constructor(readonly registry: FrozenPluginRegistry) {
    const ajv = new Ajv2020({ strict: true, allErrors: true, useDefaults: false });
    for (const plugin of registry.plugins) {
      for (const descriptor of plugin.elements) {
        const type = `${plugin.plugin.manifest.id}/${descriptor.name}`;
        this.compiled.set(type, {
          data: ajv.compile(descriptor.dataSchema),
          ...(descriptor.styleSchema ? { style: ajv.compile(descriptor.styleSchema) } : {})
        });
      }
    }
  }

  normalizeForWrite(value: unknown): CanvasElement {
    if (!value || typeof value !== 'object' || Array.isArray(value))
      validation('validation_error', 'element must be an object');
    const input = value as Record<string, unknown>;
    for (const key of Object.keys(input)) {
      if (!ENVELOPE_KEYS.has(key)) validation('validation_error', `unexpected element field: ${key}`);
    }
    if (typeof input.id !== 'string' || !SAFE_ID.test(input.id))
      validation('validation_error', 'element.id is invalid');
    const type = elementType(input.type);
    if (!Number.isSafeInteger(input.schemaVersion) || (input.schemaVersion as number) < 1)
      validation('validation_error', 'element.schemaVersion must be a positive safe integer');
    if (typeof input.x !== 'number' || !Number.isFinite(input.x))
      validation('validation_error', 'element.x must be finite');
    if (typeof input.y !== 'number' || !Number.isFinite(input.y))
      validation('validation_error', 'element.y must be finite');
    if (!isJsonObject(input.data)) validation('validation_error', 'element.data must be a finite JSON object');
    if (input.style !== undefined && input.style !== null && !isJsonObject(input.style))
      validation('validation_error', 'element.style must be a finite JSON object or null');
    if (input.metadata !== undefined && !isJsonObject(input.metadata))
      validation('validation_error', 'element.metadata must be a finite JSON object');
    if (input.locked !== undefined && input.locked !== null && typeof input.locked !== 'boolean')
      validation('validation_error', 'element.locked must be boolean or null');

    const descriptor = this.registry.getElementType(type);
    if (!descriptor) validation('plugin_unavailable', `plugin element type is unavailable: ${type}`, 409);
    if (descriptor.schemaVersion !== input.schemaVersion)
      validation(
        'element_schema_version_unsupported',
        `${type} requires schemaVersion ${descriptor.schemaVersion}, received ${String(input.schemaVersion)}`,
        409
      );
    const validators = this.compiled.get(type) as CompiledElementType;
    if (!validators.data(input.data)) schemaError(`${type} data`, validators.data);
    if (input.style !== undefined && input.style !== null) {
      if (!validators.style) validation('validation_error', `${type} does not accept element.style`);
      if (!validators.style(input.style)) schemaError(`${type} style`, validators.style);
    }

    const element: CanvasElement = {
      id: input.id,
      type,
      schemaVersion: input.schemaVersion as number,
      x: input.x,
      y: input.y,
      data: structuredClone(input.data)
    };
    for (const key of ['width', 'height', 'zIndex', 'rotation', 'opacity'] as const) {
      const normalized = optionalFinite(input[key], `element.${key}`);
      if (normalized !== undefined) element[key] = normalized;
    }
    if (element.width === undefined && descriptor.defaultFrame?.width !== undefined)
      element.width = descriptor.defaultFrame.width;
    if (element.height === undefined && descriptor.defaultFrame?.height !== undefined)
      element.height = descriptor.defaultFrame.height;
    if (input.locked !== undefined) element.locked = input.locked as boolean | null;
    if (input.style !== undefined) element.style = structuredClone(input.style as JsonObject | null);
    if (input.metadata !== undefined) element.metadata = structuredClone(input.metadata as JsonObject);
    const issues = descriptor.validate?.(element, {
      pluginId: type.slice(0, type.lastIndexOf('/')),
      type,
      schemaVersion: element.schemaVersion
    });
    if (issues?.length) {
      validation(
        'validation_error',
        issues.map((issue) => `${issue.path || '/'} [${issue.code}] ${issue.message}`).join('; ')
      );
    }
    return element;
  }

  validatePersisted(value: unknown, options: { allowMissingPlugin: boolean }): CanvasElement {
    if (!value || typeof value !== 'object' || Array.isArray(value))
      validation('validation_error', 'stored element must be an object');
    const input = value as Record<string, unknown>;
    const type = elementType(input.type);
    if (!this.registry.getElementType(type) && options.allowMissingPlugin) {
      for (const key of Object.keys(input)) {
        if (!ENVELOPE_KEYS.has(key)) validation('validation_error', `unexpected stored element field: ${key}`);
      }
      if (typeof input.id !== 'string' || !SAFE_ID.test(input.id))
        validation('validation_error', 'stored element.id is invalid');
      if (!Number.isSafeInteger(input.schemaVersion) || (input.schemaVersion as number) < 1)
        validation('validation_error', 'stored element.schemaVersion is invalid');
      if (typeof input.x !== 'number' || !Number.isFinite(input.x))
        validation('validation_error', 'stored element.x is invalid');
      if (typeof input.y !== 'number' || !Number.isFinite(input.y))
        validation('validation_error', 'stored element.y is invalid');
      if (!isJsonObject(input.data)) validation('validation_error', 'stored element.data must be a JSON object');
      if (input.style !== undefined && input.style !== null && !isJsonObject(input.style))
        validation('validation_error', 'stored element.style is invalid');
      if (input.metadata !== undefined && !isJsonObject(input.metadata))
        validation('validation_error', 'stored element.metadata is invalid');
      for (const key of ['width', 'height', 'zIndex', 'rotation', 'opacity'] as const)
        optionalFinite(input[key], `stored element.${key}`);
      if (input.locked !== undefined && input.locked !== null && typeof input.locked !== 'boolean')
        validation('validation_error', 'stored element.locked is invalid');
      return structuredClone(value) as CanvasElement;
    }
    return this.normalizeForWrite(value);
  }

  normalizeFramePatch(value: unknown): CanvasElementFramePatch {
    if (!value || typeof value !== 'object' || Array.isArray(value))
      validation('validation_error', 'frame patch must be an object');
    const input = value as Record<string, unknown>;
    for (const key of Object.keys(input)) {
      if (!FRAME_KEYS.has(key)) validation('validation_error', `frame patch cannot change ${key}`);
    }
    const result: CanvasElementFramePatch = {};
    for (const key of ['x', 'y'] as const) {
      if (input[key] === undefined) continue;
      if (input[key] === null) validation('validation_error', `frame.${key} cannot be null`);
      result[key] = optionalFinite(input[key], `frame.${key}`) as number;
    }
    for (const key of ['width', 'height', 'zIndex', 'rotation', 'opacity'] as const) {
      const normalized = optionalFinite(input[key], `frame.${key}`);
      if (normalized !== undefined) result[key] = normalized;
    }
    if (input.locked !== undefined) {
      if (input.locked !== null && typeof input.locked !== 'boolean')
        validation('validation_error', 'frame.locked is invalid');
      result.locked = input.locked as boolean | null;
    }
    return result;
  }
}
