import type { JsonObject, PluginManifest } from '@agentcanvas/plugin-sdk';
import { isLocalContributionName, isPluginId } from '@agentcanvas/plugin-sdk';
import Ajv2020, { type ErrorObject, type ValidateFunction } from 'ajv/dist/2020.js';
import { PluginRuntimeError } from './errors.js';
import { isVersion, isVersionRange } from './semver.js';

const pathPattern = '^(?![A-Za-z]:)(?!/)(?!.*\\\\)(?!.*(?:^|/)\\.\\.?($|/))[^/]+(?:/[^/]+)*$';
const localNamePattern = '^[a-z][a-z0-9-]*$';

export const pluginManifestSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'object',
  additionalProperties: false,
  required: [
    'apiVersion',
    'id',
    'version',
    'displayName',
    'description',
    'license',
    'entrypoints',
    'requires',
    'provides',
    'permissions',
    'contributes'
  ],
  properties: {
    apiVersion: { const: 'agentcanvas.plugin/v1' },
    id: { type: 'string', pattern: '^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$' },
    version: { type: 'string', minLength: 1 },
    displayName: { type: 'string', minLength: 1, maxLength: 200 },
    description: { type: 'string', minLength: 1, maxLength: 2000 },
    license: { type: 'string', minLength: 1, maxLength: 100 },
    entrypoints: {
      type: 'object',
      additionalProperties: false,
      required: ['server'],
      properties: {
        server: { type: 'string', pattern: pathPattern },
        browser: { type: 'string', pattern: pathPattern }
      }
    },
    requires: {
      type: 'object',
      additionalProperties: false,
      required: ['hostApi', 'plugins', 'capabilities'],
      properties: {
        hostApi: { type: 'string', minLength: 1 },
        plugins: {
          type: 'object',
          propertyNames: { pattern: '^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$' },
          additionalProperties: { type: 'string', minLength: 1 }
        },
        capabilities: { type: 'object', additionalProperties: { type: 'string', minLength: 1 } }
      }
    },
    provides: {
      type: 'object',
      additionalProperties: false,
      required: ['capabilities'],
      properties: { capabilities: { type: 'object', additionalProperties: { type: 'string', minLength: 1 } } }
    },
    permissions: { type: 'array', uniqueItems: true, items: { type: 'string', minLength: 1 } },
    contributes: {
      type: 'object',
      additionalProperties: false,
      required: ['elements', 'tools', 'procedures', 'migrations'],
      properties: {
        elements: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['name', 'schemaVersion', 'browser', 'snapshot'],
            properties: {
              name: { type: 'string', pattern: localNamePattern },
              schemaVersion: { type: 'integer', minimum: 1 },
              browser: { type: 'boolean' },
              snapshot: { enum: ['supported', 'unsupported'] }
            }
          }
        },
        tools: { type: 'array', uniqueItems: true, items: { type: 'string', pattern: localNamePattern } },
        procedures: { type: 'array', uniqueItems: true, items: { type: 'string', pattern: localNamePattern } },
        migrations: { type: 'array', uniqueItems: true, items: { type: 'string', pattern: localNamePattern } }
      }
    },
    configuration: {
      type: 'object',
      additionalProperties: false,
      required: ['schema', 'file', 'environment'],
      properties: {
        schema: { type: 'string', pattern: pathPattern },
        file: { type: 'string', pattern: pathPattern },
        environment: { type: 'array', uniqueItems: true, items: { type: 'string', pattern: '^[A-Z][A-Z0-9_]*$' } }
      }
    }
  }
} as const;

const ajv = new Ajv2020({ strict: true, allErrors: true, useDefaults: false });
const validate = ajv.compile<PluginManifest>(pluginManifestSchema);

function renderErrors(errors: ErrorObject[] | null | undefined): string {
  return (errors ?? []).map((error) => `${error.instancePath || '/'} ${error.message}`).join('; ');
}

export function validatePluginManifest(value: unknown): PluginManifest {
  if (!validate(value)) {
    throw new PluginRuntimeError(
      'plugin_manifest_invalid',
      `Invalid plugin manifest: ${renderErrors(validate.errors)}`
    );
  }
  const manifest = value as PluginManifest;
  if (!isPluginId(manifest.id) || !isVersion(manifest.version) || !isVersionRange(manifest.requires.hostApi)) {
    throw new PluginRuntimeError(
      'plugin_manifest_invalid',
      `Invalid plugin identity or semantic version contract for ${manifest.id}`
    );
  }
  for (const [id, range] of Object.entries(manifest.requires.plugins)) {
    if (!isPluginId(id) || !isVersionRange(range))
      throw new PluginRuntimeError('plugin_manifest_invalid', `Invalid plugin dependency ${id}`);
  }
  for (const [name, range] of Object.entries(manifest.requires.capabilities)) {
    if (!name || !isVersionRange(range))
      throw new PluginRuntimeError('plugin_manifest_invalid', `Invalid capability requirement ${name}`);
  }
  for (const [name, version] of Object.entries(manifest.provides.capabilities)) {
    if (!name || !isVersion(version))
      throw new PluginRuntimeError('plugin_manifest_invalid', `Invalid provided capability ${name}`);
  }
  const localNames = [
    ...manifest.contributes.elements.map((item) => item.name),
    ...manifest.contributes.tools,
    ...manifest.contributes.procedures,
    ...manifest.contributes.migrations
  ];
  if (localNames.some((name) => !isLocalContributionName(name)))
    throw new PluginRuntimeError('plugin_manifest_invalid', 'Invalid local contribution name');
  if (new Set(manifest.contributes.elements.map((item) => item.name)).size !== manifest.contributes.elements.length) {
    throw new PluginRuntimeError('plugin_manifest_invalid', `Duplicate element contribution in ${manifest.id}`);
  }
  return manifest;
}

export function validatePluginConfig(schema: JsonObject, config: unknown, pluginId: string): JsonObject {
  const configAjv = new Ajv2020({ strict: true, allErrors: true, useDefaults: false });
  let validator: ValidateFunction;
  try {
    validator = configAjv.compile(schema);
  } catch (error) {
    throw new PluginRuntimeError(
      'plugin_manifest_invalid',
      `Invalid configuration schema for ${pluginId}: ${String(error)}`
    );
  }
  if (!validator(config))
    throw new PluginRuntimeError(
      'plugin_manifest_invalid',
      `Invalid configuration for ${pluginId}: ${renderErrors(validator.errors)}`
    );
  return config as JsonObject;
}
