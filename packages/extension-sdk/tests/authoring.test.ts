import { describe, expect, it } from 'vitest';
import { defineCommand, defineElement, defineExtension, serializeExtensionManifest } from '../src/index.js';

describe('extension authoring descriptor', () => {
  it('derives the installed manifest contribution list from one typed descriptor', () => {
    const definition = defineExtension({
      manifest: {
        id: 'example.cards',
        version: '1.0.0',
        displayName: 'Cards',
        description: 'Example cards.',
        license: 'MIT',
        entrypoints: { server: 'dist/server.mjs', browser: 'dist/browser/entry.mjs' },
        requires: { hostApi: '^1.0.0', plugins: {}, capabilities: {} },
        provides: { capabilities: {} },
        permissions: []
      },
      contributes: {
        elements: [defineElement({ name: 'card', schemaVersion: 1, browser: true, snapshot: 'supported' })],
        commands: [defineCommand({ name: 'reset-card', title: 'Reset card' })]
      }
    });
    expect(definition.manifest.contributes).toMatchObject({
      elements: [{ name: 'card' }],
      commands: ['reset-card'],
      tools: [],
      procedures: [],
      migrations: []
    });
    expect(JSON.parse(serializeExtensionManifest(definition))).toEqual(definition.manifest);
    expect(Object.isFrozen(definition)).toBe(true);
  });
});
