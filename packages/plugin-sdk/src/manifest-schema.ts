import { PLUGIN_ID_PATTERN, LOCAL_CONTRIBUTION_NAME_PATTERN } from './identifiers.js';
import type { PluginManifest } from './manifest.js';

/** Canonical structural manifest contract. Hosts additionally validate semver and filesystem containment. */
const containedPathPattern = '^(?![A-Za-z]:)(?!/)(?!.*\\\\)(?!.*(?:^|/)\\.\\.?($|/))[^/]+(?:/[^/]+)*$';
const localNamePattern = LOCAL_CONTRIBUTION_NAME_PATTERN.source;

const pathPattern = '^(?!.*[\\u0000?#])' + containedPathPattern.slice(1);

export const PLUGIN_MANIFEST_SCHEMA = {
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
  allOf: [
    {
      if: {
        properties: {
          contributes: {
            type: 'object',
            required: ['commands'],
            properties: { commands: { type: 'array', minItems: 1 } }
          }
        }
      },
      then: {
        properties: {
          entrypoints: { type: 'object', required: ['browser'], properties: { browser: { type: 'string' } } }
        }
      }
    }
  ],
  properties: {
    apiVersion: { const: 'agentcanvas.plugin/v1' },
    id: { type: 'string', pattern: PLUGIN_ID_PATTERN.source, maxLength: 128 },
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
          propertyNames: { pattern: PLUGIN_ID_PATTERN.source, maxLength: 128 },
          additionalProperties: { type: 'string', minLength: 1 }
        },
        capabilities: {
          type: 'object',
          propertyNames: { minLength: 1 },
          additionalProperties: { type: 'string', minLength: 1 }
        }
      }
    },
    provides: {
      type: 'object',
      additionalProperties: false,
      required: ['capabilities'],
      properties: {
        capabilities: {
          type: 'object',
          propertyNames: { minLength: 1 },
          additionalProperties: { type: 'string', minLength: 1 }
        }
      }
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
              name: { type: 'string', pattern: localNamePattern, maxLength: 64 },
              schemaVersion: { type: 'integer', minimum: 1, maximum: Number.MAX_SAFE_INTEGER },
              browser: { type: 'boolean' },
              snapshot: { enum: ['supported', 'unsupported'] }
            }
          }
        },
        commands: {
          type: 'array',
          uniqueItems: true,
          items: { type: 'string', pattern: localNamePattern, maxLength: 64 }
        },
        tools: {
          type: 'array',
          uniqueItems: true,
          items: { type: 'string', pattern: localNamePattern, maxLength: 64 }
        },
        procedures: {
          type: 'array',
          uniqueItems: true,
          items: { type: 'string', pattern: localNamePattern, maxLength: 64 }
        },
        migrations: {
          type: 'array',
          uniqueItems: true,
          items: { type: 'string', pattern: localNamePattern, maxLength: 64 }
        }
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

/** Call only after structural validation; schema uniqueness cannot compare just element names. */
export function duplicateManifestElementNames(manifest: PluginManifest): readonly string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const element of manifest.contributes.elements) {
    if (seen.has(element.name)) duplicates.add(element.name);
    seen.add(element.name);
  }
  return [...duplicates];
}
