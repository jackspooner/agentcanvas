import { Ajv2020, type ErrorObject } from 'ajv/dist/2020.js';
import { PLUGIN_MANIFEST_SCHEMA, duplicateManifestElementNames, type PluginManifest } from '@agentcanvas/plugin-sdk';
import type { TestkitIssue, TestkitValidationResult } from './types.js';

const validator = new Ajv2020({ strict: true, allErrors: true, useDefaults: false }).compile<PluginManifest>(
  PLUGIN_MANIFEST_SCHEMA
);

function manifestIssue(error: ErrorObject): TestkitIssue {
  const property =
    error.keyword === 'required'
      ? error.params.missingProperty
      : error.keyword === 'additionalProperties'
        ? error.params.additionalProperty
        : undefined;
  const path =
    error.instancePath + (property ? '/' + String(property).replaceAll('~', '~0').replaceAll('/', '~1') : '');
  let code = 'invalid_format';
  if (error.keyword === 'additionalProperties') code = 'unknown_property';
  else if (error.keyword === 'maxLength') code = 'string_too_long';
  else if (error.keyword === 'type' || error.keyword === 'required' || error.keyword === 'minLength') {
    code =
      error.params.type === 'array'
        ? 'required_array'
        : error.params.type === 'boolean'
          ? 'required_boolean'
          : error.params.type === 'object'
            ? 'required_object'
            : 'required_string';
  }
  if (path === '/apiVersion') code = 'unsupported_api_version';
  else if (path === '/entrypoints/browser' && error.schemaPath.includes('/allOf/')) code = 'browser_entry_required';
  else if (/^\/(entrypoints\/(server|browser)|configuration\/(schema|file))$/.test(path)) code = 'unsafe_relative_path';
  else if (path.endsWith('/schemaVersion')) code = 'invalid_schema_version';
  else if (path.startsWith('/permissions'))
    code = error.keyword === 'uniqueItems' ? 'duplicate_permission' : 'invalid_permissions';
  else if (path.startsWith('/configuration/environment'))
    code = error.keyword === 'uniqueItems' ? 'duplicate_environment_declaration' : 'invalid_environment_declarations';
  else if (error.keyword === 'uniqueItems') code = 'duplicate_contribution';
  else if (path.startsWith('/contributes/') && error.keyword === 'pattern') code = 'invalid_local_name';
  else if (error.keyword === 'propertyNames') code = 'invalid_identifier';
  return { path: path || '/', code, message: error.message ?? 'Invalid manifest value.' };
}

/** Structural checks only: host semver, dependency availability and filesystem checks remain required. */
export function validatePluginManifestStructure(input: unknown): TestkitValidationResult {
  if (!validator(input)) {
    return { ok: false, issues: (validator.errors ?? []).filter((error) => error.keyword !== 'if').map(manifestIssue) };
  }
  const issues = duplicateManifestElementNames(input).map((name) => ({
    path: '/contributes/elements',
    code: 'duplicate_contribution',
    message: 'Duplicate element ' + name + '.'
  }));
  return { ok: issues.length === 0, issues };
}

export function assertPluginManifestStructure(input: unknown): void {
  const result = validatePluginManifestStructure(input);
  if (!result.ok) {
    const detail = result.issues.map((issue) => `${issue.path || '/'} [${issue.code}] ${issue.message}`).join('\n');
    throw new Error(`Invalid AgentCanvas plugin manifest:\n${detail}`);
  }
}

export function getManifestReferencedPaths(input: unknown): readonly string[] {
  assertPluginManifestStructure(input);
  const manifest = input as {
    entrypoints: { server: string; browser?: string };
    configuration?: { schema: string; file: string };
  };
  return [
    manifest.entrypoints.server,
    ...(manifest.entrypoints.browser ? [manifest.entrypoints.browser] : []),
    ...(manifest.configuration ? [manifest.configuration.schema, manifest.configuration.file] : [])
  ];
}
