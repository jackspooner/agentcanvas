# `@agentcanvas/extension-sdk`

The public v0.3 authoring facade for AgentCanvas extensions.

It re-exports the compatible plugin API v1 runtime contracts and adds typed
descriptor helpers that generate the static installed manifest from one
author-maintained contribution declaration.

Existing `@agentcanvas/plugin-sdk` consumers remain supported.

```ts
import { defineCommand, defineElement, defineExtension } from '@agentcanvas/extension-sdk';

export default defineExtension({
  manifest: {
    id: 'acme.cards',
    version: '1.0.0',
    displayName: 'Cards',
    description: 'Interactive canvas cards.',
    license: 'MIT',
    entrypoints: {
      server: 'dist/server.mjs',
      browser: 'dist/browser/entry.mjs'
    },
    requires: { hostApi: '^1.0.0', plugins: {}, capabilities: {} },
    provides: { capabilities: {} },
    permissions: ['canvas.read', 'canvas.mutate-own']
  },
  contributes: {
    elements: [
      defineElement({
        name: 'card',
        schemaVersion: 1,
        browser: true,
        snapshot: 'supported'
      })
    ],
    commands: [defineCommand({ name: 'reset-card', title: 'Reset card' })]
  }
});
```

Use `serializeExtensionManifest(definition)` during the build to write the
strict static `agentcanvas.plugin.json`. Runtime discovery reads that JSON; it
does not execute the authoring descriptor.
