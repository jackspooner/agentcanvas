import type { JsonObject, PluginManifest } from '@agentcanvas/plugin-sdk';
import { PLUGIN_MANIFEST_SCHEMA, duplicateManifestElementNames, isPluginId } from '@agentcanvas/plugin-sdk';
export { PLUGIN_MANIFEST_SCHEMA as pluginManifestSchema } from '@agentcanvas/plugin-sdk';
import Ajv2020, { type ErrorObject, type ValidateFunction } from 'ajv/dist/2020.js';
import { PluginRuntimeError } from './errors.js';
import { isVersion, isVersionRange } from './semver.js';

const ajv = new Ajv2020({ strict: true, allErrors: true, useDefaults: false });
const validate = ajv.compile<PluginManifest>(PLUGIN_MANIFEST_SCHEMA);

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
  if (duplicateManifestElementNames(manifest).length) {
    throw new PluginRuntimeError('plugin_manifest_invalid', 'Duplicate element contribution in ' + manifest.id);
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
