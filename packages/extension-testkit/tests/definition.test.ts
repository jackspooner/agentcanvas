import { defineCommand, defineExtension } from '@agentcanvas/extension-sdk';
import { describe, expect, it } from 'vitest';
import { assertExtensionDefinition } from '../src/index.js';

describe('extension definition conformance', () => {
  it('accepts generated manifests whose descriptors cannot drift', () => {
    const definition = defineExtension({
      manifest: {
        id: 'example.commands',
        version: '1.0.0',
        displayName: 'Commands',
        description: 'Command example.',
        license: 'MIT',
        entrypoints: { server: 'dist/server.mjs', browser: 'dist/browser/entry.mjs' },
        requires: { hostApi: '^1.0.0', plugins: {}, capabilities: {} },
        provides: { capabilities: {} },
        permissions: []
      },
      contributes: { commands: [defineCommand({ name: 'run', title: 'Run' })] }
    });
    expect(() => assertExtensionDefinition(definition)).not.toThrow();
  });
});
