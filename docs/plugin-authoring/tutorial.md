# Build your first extension

This tutorial creates, customizes, packages, installs, and verifies an
AgentCanvas extension without importing private host modules or React Flow.

## 1. Scaffold the project

From the AgentCanvas checkout:

```bash
npm run build --workspace create-agentcanvas-extension
npm exec --workspace create-agentcanvas-extension -- create-agentcanvas-extension signal-card
cd signal-card
npm install
```

The scaffold name accepts lowercase letters, numbers, and hyphens. It creates a standalone package; it does not need to live under AgentCanvas.

Once `create-agentcanvas-extension` is published, use
`npx create-agentcanvas-extension signal-card` instead.

## 2. Understand the generated layout

```text
signal-card/
  agentcanvas.plugin.json
  plugin.config.json
  schemas/config.schema.json
  src/extension.mts
  src/schemas.ts
  src/server.mts
  src/browser/entry.mts
  scripts/pack-plugin.mjs
  scripts/verify-distribution.mjs
  tests/
  package.json
  README.md
```

`src/extension.mts` is the authoring source for identity and contribution
declarations. `npm run generate:manifest` writes the static
`agentcanvas.plugin.json` distribution contract. Source files and the host
repository are not runtime dependencies.

## 3. Choose identity and contribution names

The scaffold derives a plugin ID from the name (`signal-card`). Use a globally distinctive namespace such as `acme.signal-card` before public distribution. If you change it, replace the manifest ID and every canonical type literal in source/tests together.

```json
{
  "id": "acme.signal-card",
  "version": "0.1.0",
  "entrypoints": {
    "server": "dist/server.mjs",
    "browser": "dist/browser/entry.mjs"
  }
}
```

Local element names use lowercase letters, numbers, and hyphens. If the local name is `card`, the persisted type is `acme.signal-card/card`. A tool named `add-card` becomes `acme_signal_card__add_card` in MCP.

The folder name does not control identity; the manifest ID does. The installer materializes it as `plugins/acme.signal-card`.

The scaffold initially contributes local element `hello-card`. The remaining examples rename that local contribution to `card`; update `contributes.elements`, server registration, browser registration, tool construction, and tests together. Contribution declarations and registrations must remain exact.

## 4. Define strict schemas once

Edit `src/schemas.ts` and use the same JSON Schema objects for runtime registration and tests:

```ts
import type { JsonSchema } from '@agentcanvas/extension-sdk';

export const cardDataSchema: JsonSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'object',
  required: ['title', 'status'],
  additionalProperties: false,
  properties: {
    title: { type: 'string', minLength: 1, maxLength: 120 },
    status: { enum: ['healthy', 'warning', 'failed'] }
  }
};
```

Use explicit required properties and `additionalProperties: false`. AgentCanvas does not insert JSON Schema defaults. Put defaults in the tool or authoring UI that constructs a complete element.

Keep frame properties such as `x`, `y`, `width`, `height`, `rotation`, `opacity`, and `locked` in the host envelope. Plugin `style` cannot override host layout.

## 5. Register the server contribution

In `src/server.mts`, register exactly what the manifest declares:

```ts
import type { AgentCanvasServerPlugin } from '@agentcanvas/extension-sdk';
import { cardDataSchema } from './schemas.js';

const plugin: AgentCanvasServerPlugin = {
  activate(host) {
    host.registerElementType({
      name: 'card',
      schemaVersion: 1,
      dataSchema: cardDataSchema,
      defaultFrame: { width: 320, height: 180 },
      browser: true,
      snapshot: 'supported',
      summarize: (element) => ({ title: String(element.data.title) }),
      renderSnapshot: (element) => ({
        space: 'frame',
        layer: 'content',
        nodes: [
          { kind: 'rect', x: 0, y: 0, width: element.width ?? 320, height: element.height ?? 180, fill: '#ffffff' },
          { kind: 'text', x: 16, y: 30, text: String(element.data.title), fill: '#111827' }
        ]
      })
    });
  }
};

export default plugin;
```

If the manifest declares a tool, procedure, migration, or provided capability, activation must register it. Undeclared or missing registration fails startup.

## 6. Add an ergonomic MCP tool

Generic host tools can upsert any active current-version element, but a plugin tool gives agents a domain-specific schema and constructs the full envelope safely.

```ts
host.registerTool({
  name: 'add-card',
  title: 'Add signal card',
  description: 'Places a status card on an AgentCanvas canvas.',
  inputSchema: addCardInputSchema,
  outputSchema: addCardOutputSchema,
  annotations: { idempotentHint: false, destructiveHint: false },
  async invoke(input, context) {
    const canvas = await context.canvas.upsertElement(String(input.canvasId), {
      id: String(input.id),
      type: 'acme.signal-card/card',
      schemaVersion: 1,
      x: Number(input.x),
      y: Number(input.y),
      width: 320,
      height: 180,
      data: { title: String(input.title), status: String(input.status) }
    });
    return { canvas };
  }
});
```

Declare `canvas.mutate-own` in the manifest. The scoped host allows this plugin to mutate only elements in the `acme.signal-card/*` namespace.

## 7. Implement the browser renderer

In `src/browser/entry.mts`, register the canonical type:

```ts
import type { AgentCanvasBrowserPlugin } from '@agentcanvas/extension-sdk';

const browserPlugin: AgentCanvasBrowserPlugin = {
  activate(host) {
    host.registerRenderer({
      type: 'acme.signal-card/card',
      schemaVersions: [1],
      placement: 'node',
      mount(root, initial) {
        const article = document.createElement('article');
        root.replaceChildren(article);

        const render = (context: typeof initial) => {
          article.textContent = `${context.element.data.title}: ${context.element.data.status}`;
        };

        render(initial);
        return {
          update: render,
          dispose() {
            root.replaceChildren();
          }
        };
      }
    });
  }
};

export default browserPlugin;
```

The host owns frame movement, transforms, selection, read-only behavior, and the drag handle. Render only plugin content. Use `context.signal` for async work, mark custom controls with `data-agentcanvas-interactive`, and release listeners, media, overlays, and object URLs during update/dispose.

Bundle all browser runtime dependencies. Browser imports and chunks must stay inside the declared browser subtree.

## 8. Configure without leaking secrets

If the manifest declares configuration, `plugin.config.json` is required and validated before activation. Use it for non-secret behavior such as a palette or limits.

For a token or credential, declare only the environment variable name:

```json
{
  "configuration": {
    "schema": "schemas/config.schema.json",
    "file": "plugin.config.json",
    "environment": ["ACME_SIGNAL_API_TOKEN"]
  }
}
```

Plugin code reads the deployment environment. Never put the value in the manifest, config, diagnostics, status output, examples, or tests. See [Configuration and secrets](configuration.md).

## 9. Add a browser command

Declare a local command in `src/extension.mts`, then register the same name
from the browser entry:

```ts
host.registerCommand?.({
  name: 'reset-card',
  title: 'Reset card',
  isEnabled: (context) => !context.readOnly && context.selection.length > 0,
  async execute(context) {
    const card = context.selection.find((element) => element.type === 'acme.signal-card/card');
    if (!card) return;
    await context.transact('Reset card', [
      {
        op: 'replaceElementData',
        elementId: card.id,
        data: { title: card.data.title, status: 'healthy' }
      }
    ]);
  }
});
```

Commands use the same service as toolbar and keyboard actions. They may mutate
only their extension's elements and never receive a React Flow instance.

## 10. Test and package

```bash
npm run check
npm test
npm run pack:extension
npm run agentcanvas:verify
```

The installable directory is `plugin-dist/acme.signal-card`. It should contain the manifest, config/schema files when declared, prebuilt server and browser modules, and documentation/license—never source-tree or private AgentCanvas imports.

## 11. Install and verify in AgentCanvas

Stop AgentCanvas, then from the host repository:

```bash
npm run plugins:install -- C:/path/to/signal-card/plugin-dist/acme.signal-card
npm run plugins:verify
```

Restart and check:

1. `GET /api/v1/plugins/acme.signal-card` lists the element, tool, procedure, and browser entry.
2. Runtime `/openapi.json` contains its element and procedure schemas.
3. MCP `tools/list` contains `acme_signal_card__add_card`.
4. The tool creates an element that renders in the browser and snapshot.
5. Browser console and plugin diagnostics are clean.

## 12. Prove missing-extension behavior

Create a test canvas element, stop AgentCanvas, and disable the plugin:

```bash
npm run plugins:disable -- acme.signal-card
```

After restart, the envelope must remain unchanged with an explicit missing-plugin diagnostic. Reinstall the compatible distribution and restart; rendering must return without changing the canvas revision solely because of reinstallation.

Continue with [Versioning and migrations](versioning-and-migrations.md) before changing the element schema.
