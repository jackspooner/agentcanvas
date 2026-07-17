import { defineCommand, defineElement, defineExtension } from '@agentcanvas/extension-sdk';

export default defineExtension({
  manifest: {
    id: '__PLUGIN_ID__',
    version: '0.1.0',
    displayName: '__DISPLAY_NAME__',
    description: 'A framework-neutral Hello Card element example.',
    license: 'MIT',
    entrypoints: {
      server: 'dist/server.mjs',
      browser: 'dist/browser/entry.mjs'
    },
    requires: {
      hostApi: '^1.0.0',
      plugins: {},
      capabilities: {}
    },
    provides: {
      capabilities: {}
    },
    permissions: ['canvas.read', 'canvas.mutate-own', 'diagnostics.emit'],
    configuration: {
      schema: 'schemas/config.schema.json',
      file: 'plugin.config.json',
      environment: []
    }
  },
  contributes: {
    elements: [
      defineElement({
        name: 'hello-card',
        schemaVersion: 1,
        browser: true,
        snapshot: 'supported'
      })
    ],
    commands: [
      defineCommand({
        name: 'show-selection-count',
        title: 'Show selection count',
        category: '__DISPLAY_NAME__'
      })
    ],
    tools: ['add-hello-card'],
    procedures: ['describe-card'],
    migrations: ['legacy-hello-card-v1']
  }
});
