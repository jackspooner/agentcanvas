import type { TestkitIssue, TestkitValidationResult } from './types.js';

const pluginIdPattern = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/;
const localNamePattern = /^[a-z][a-z0-9-]*$/;
const semanticVersionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const environmentNamePattern = /^[A-Z_][A-Z0-9_]*$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && !Array.isArray(value) && typeof value === 'object';
}

function ownKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  path: string,
  issues: TestkitIssue[]
): void {
  const allowedKeys = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) {
      issues.push({ path: `${path}/${key}`, code: 'unknown_property', message: `Unknown property ${key}.` });
    }
  }
}

function requireString(
  value: Record<string, unknown>,
  key: string,
  path: string,
  issues: TestkitIssue[],
  options: { maxLength?: number; pattern?: RegExp } = {}
): string | undefined {
  const candidate = value[key];
  if (typeof candidate !== 'string' || candidate.length === 0) {
    issues.push({ path: `${path}/${key}`, code: 'required_string', message: `${key} must be a non-empty string.` });
    return undefined;
  }
  if (options.maxLength !== undefined && candidate.length > options.maxLength) {
    issues.push({
      path: `${path}/${key}`,
      code: 'string_too_long',
      message: `${key} exceeds ${options.maxLength} characters.`
    });
  }
  if (options.pattern && !options.pattern.test(candidate)) {
    issues.push({ path: `${path}/${key}`, code: 'invalid_format', message: `${key} has an invalid format.` });
  }
  return candidate;
}

function validateRelativePath(value: unknown, path: string, issues: TestkitIssue[]): void {
  if (typeof value !== 'string' || value.length === 0) {
    issues.push({ path, code: 'required_path', message: 'Entrypoint path must be a non-empty string.' });
    return;
  }
  const parts = value.split('/');
  if (
    value.includes('\\') ||
    value.startsWith('/') ||
    /^[A-Za-z]:/.test(value) ||
    value.includes('\0') ||
    value.includes('?') ||
    value.includes('#') ||
    parts.some((part) => part === '' || part === '.' || part === '..')
  ) {
    issues.push({
      path,
      code: 'unsafe_relative_path',
      message: 'Path must be a normalized, relative, slash-separated path contained by the plugin directory.'
    });
  }
}

function validateStringMap(value: unknown, path: string, issues: TestkitIssue[]): void {
  if (!isRecord(value)) {
    issues.push({ path, code: 'required_object', message: 'Value must be an object.' });
    return;
  }
  for (const [key, range] of Object.entries(value)) {
    if (!pluginIdPattern.test(key) || key.length > 128) {
      issues.push({
        path: `${path}/${key}`,
        code: 'invalid_identifier',
        message: 'Map key is not a valid identifier.'
      });
    }
    if (typeof range !== 'string' || range.trim().length === 0) {
      issues.push({
        path: `${path}/${key}`,
        code: 'invalid_version_range',
        message: 'Version range must be non-empty.'
      });
    }
  }
}

function validateNameArray(value: unknown, path: string, issues: TestkitIssue[]): void {
  if (!Array.isArray(value)) {
    issues.push({ path, code: 'required_array', message: 'Value must be an array.' });
    return;
  }
  const seen = new Set<string>();
  value.forEach((entry, index) => {
    if (typeof entry !== 'string' || !localNamePattern.test(entry) || entry.length > 64) {
      issues.push({
        path: `${path}/${index}`,
        code: 'invalid_local_name',
        message: 'Invalid local contribution name.'
      });
      return;
    }
    if (seen.has(entry)) {
      issues.push({
        path: `${path}/${index}`,
        code: 'duplicate_contribution',
        message: `Duplicate contribution ${entry}.`
      });
    }
    seen.add(entry);
  });
}

export function validatePluginManifestStructure(input: unknown): TestkitValidationResult {
  const issues: TestkitIssue[] = [];
  if (!isRecord(input)) {
    return { ok: false, issues: [{ path: '/', code: 'required_object', message: 'Manifest must be an object.' }] };
  }
  ownKeys(
    input,
    [
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
      'contributes',
      'configuration'
    ],
    '',
    issues
  );
  if (input.apiVersion !== 'agentcanvas.plugin/v1') {
    issues.push({ path: '/apiVersion', code: 'unsupported_api_version', message: 'Expected agentcanvas.plugin/v1.' });
  }
  requireString(input, 'id', '', issues, { maxLength: 128, pattern: pluginIdPattern });
  requireString(input, 'version', '', issues, { pattern: semanticVersionPattern });
  requireString(input, 'displayName', '', issues, { maxLength: 120 });
  requireString(input, 'description', '', issues, { maxLength: 1000 });
  requireString(input, 'license', '', issues, { maxLength: 128 });

  if (!isRecord(input.entrypoints)) {
    issues.push({ path: '/entrypoints', code: 'required_object', message: 'entrypoints must be an object.' });
  } else {
    ownKeys(input.entrypoints, ['server', 'browser'], '/entrypoints', issues);
    validateRelativePath(input.entrypoints.server, '/entrypoints/server', issues);
    if (input.entrypoints.browser !== undefined) {
      validateRelativePath(input.entrypoints.browser, '/entrypoints/browser', issues);
    }
  }

  if (!isRecord(input.requires)) {
    issues.push({ path: '/requires', code: 'required_object', message: 'requires must be an object.' });
  } else {
    ownKeys(input.requires, ['hostApi', 'plugins', 'capabilities'], '/requires', issues);
    requireString(input.requires, 'hostApi', '/requires', issues);
    validateStringMap(input.requires.plugins, '/requires/plugins', issues);
    validateStringMap(input.requires.capabilities, '/requires/capabilities', issues);
  }

  if (!isRecord(input.provides)) {
    issues.push({ path: '/provides', code: 'required_object', message: 'provides must be an object.' });
  } else {
    ownKeys(input.provides, ['capabilities'], '/provides', issues);
    validateStringMap(input.provides.capabilities, '/provides/capabilities', issues);
  }

  if (!Array.isArray(input.permissions) || input.permissions.some((entry) => typeof entry !== 'string' || !entry)) {
    issues.push({
      path: '/permissions',
      code: 'invalid_permissions',
      message: 'permissions must contain non-empty strings.'
    });
  } else if (new Set(input.permissions).size !== input.permissions.length) {
    issues.push({ path: '/permissions', code: 'duplicate_permission', message: 'permissions must be unique.' });
  }

  if (!isRecord(input.contributes)) {
    issues.push({ path: '/contributes', code: 'required_object', message: 'contributes must be an object.' });
  } else {
    ownKeys(input.contributes, ['elements', 'tools', 'procedures', 'migrations'], '/contributes', issues);
    if (!Array.isArray(input.contributes.elements)) {
      issues.push({ path: '/contributes/elements', code: 'required_array', message: 'elements must be an array.' });
    } else {
      const seen = new Set<string>();
      input.contributes.elements.forEach((entry, index) => {
        const path = `/contributes/elements/${index}`;
        if (!isRecord(entry)) {
          issues.push({ path, code: 'required_object', message: 'Element contribution must be an object.' });
          return;
        }
        ownKeys(entry, ['name', 'schemaVersion', 'browser', 'snapshot'], path, issues);
        const name = requireString(entry, 'name', path, issues, { maxLength: 64, pattern: localNamePattern });
        if (name && seen.has(name)) {
          issues.push({ path: `${path}/name`, code: 'duplicate_contribution', message: `Duplicate element ${name}.` });
        }
        if (name) seen.add(name);
        if (!Number.isSafeInteger(entry.schemaVersion) || (entry.schemaVersion as number) < 1) {
          issues.push({
            path: `${path}/schemaVersion`,
            code: 'invalid_schema_version',
            message: 'schemaVersion must be a positive safe integer.'
          });
        }
        if (typeof entry.browser !== 'boolean') {
          issues.push({ path: `${path}/browser`, code: 'required_boolean', message: 'browser must be a boolean.' });
        }
        if (entry.snapshot !== 'supported' && entry.snapshot !== 'unsupported') {
          issues.push({
            path: `${path}/snapshot`,
            code: 'invalid_snapshot_support',
            message: 'Invalid snapshot support value.'
          });
        }
      });
    }
    validateNameArray(input.contributes.tools, '/contributes/tools', issues);
    validateNameArray(input.contributes.procedures, '/contributes/procedures', issues);
    validateNameArray(input.contributes.migrations, '/contributes/migrations', issues);
  }

  if (input.configuration !== undefined) {
    if (!isRecord(input.configuration)) {
      issues.push({ path: '/configuration', code: 'required_object', message: 'configuration must be an object.' });
    } else {
      ownKeys(input.configuration, ['schema', 'file', 'environment'], '/configuration', issues);
      validateRelativePath(input.configuration.schema, '/configuration/schema', issues);
      validateRelativePath(input.configuration.file, '/configuration/file', issues);
      if (
        !Array.isArray(input.configuration.environment) ||
        input.configuration.environment.some(
          (entry) => typeof entry !== 'string' || !environmentNamePattern.test(entry)
        )
      ) {
        issues.push({
          path: '/configuration/environment',
          code: 'invalid_environment_declarations',
          message: 'Environment declarations must be uppercase environment variable names.'
        });
      } else if (new Set(input.configuration.environment).size !== input.configuration.environment.length) {
        issues.push({
          path: '/configuration/environment',
          code: 'duplicate_environment_declaration',
          message: 'Environment declarations must be unique.'
        });
      }
    }
  }

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
