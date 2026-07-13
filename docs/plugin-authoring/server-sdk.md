# Server SDK

Export a default `AgentCanvasServerPlugin` from the manifest's server entry. Activation receives a permission-scoped host, not Hono, SQLite, private React components, raw credentials, unrestricted filesystem access, or private fetch helpers.

```ts
import type { AgentCanvasServerPlugin } from '@agentcanvas/plugin-sdk';
import { cardDataSchema, toolInputSchema, toolOutputSchema } from './schemas.js';

const plugin: AgentCanvasServerPlugin = {
  activate(host) {
    host.registerElementType({
      name: 'signal-card',
      schemaVersion: 1,
      dataSchema: cardDataSchema,
      browser: true,
      snapshot: 'supported',
      summarize: (element) => ({ title: String(element.data.label) }),
      renderSnapshot: (element) => ({ space: 'frame', layer: 'content', nodes: [] })
    });
    host.registerTool({
      name: 'add-signal-card',
      title: 'Add Signal Card',
      description: 'Adds a complete current-version card.',
      inputSchema: toolInputSchema,
      outputSchema: toolOutputSchema,
      async invoke(input, context) {
        return { canvas: await context.canvas.upsertElement(String(input.canvasId), /* complete envelope */ input.element) };
      }
    });
  }
};

export default plugin;
```

Element descriptors own their current schema version, strict data/style schemas, cross-field validation, default frame, summary, optional runtime resolution, snapshot policy, contiguous forward-only migrations, and legacy importers. New writes must provide a complete current-version envelope. Plugins construct a full replacement rather than relying on shallow or deep merge semantics.

Tools and procedures declare strict input and output schemas. Tools are projected into MCP with host-derived names; procedures are exposed through the host-owned versioned procedure endpoint. Both run through host validation, timeout, error projection, and request-origin policy. AgentCanvas has no user-account authentication layer. Return opaque resource handles for binary output.

Use `host.kv` for namespaced JSON storage and `host.diagnostics.emit` for safe structured diagnostics. Capability access is semantic-versioned and singleton. Treat consumed handles as runtime dependencies and report readiness failures; do not persist resolved URLs or provider responses into element data.

Migration importers must be pure and deterministic. They receive a legacy record and return one canonical envelope plus explicitly stripped response-only fields. Unknown fields and unsupported legacy types should fail rather than be silently retained or discarded.

Continue with [Browser and snapshot ABI](browser-and-snapshot.md), [Versioning and migrations](versioning-and-migrations.md), and the concise [plugin API reference](../plugin-api-reference.md).
