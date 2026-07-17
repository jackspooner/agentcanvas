# Manifest v1

Every distribution root contains `agentcanvas.plugin.json`. The host bounds and parses this file, validates it with strict JSON Schema 2020-12 rules, resolves declared paths with real-path containment, then checks dependencies and contribution registrations before listening.

```json
{
  "apiVersion": "agentcanvas.plugin/v1",
  "id": "acme.signal-card",
  "version": "1.0.0",
  "displayName": "Signal Card",
  "description": "Status cards for operational canvases.",
  "license": "MIT",
  "entrypoints": {
    "server": "dist/server.mjs",
    "browser": "dist/browser/entry.mjs"
  },
  "requires": {
    "hostApi": "^1.0.0",
    "plugins": {},
    "capabilities": {}
  },
  "provides": { "capabilities": {} },
  "permissions": ["canvas.read", "canvas.mutate-own", "diagnostics.emit"],
  "contributes": {
    "elements": [{ "name": "signal-card", "schemaVersion": 1, "browser": true, "snapshot": "supported" }],
    "commands": ["reset-signal-card"],
    "tools": ["add-signal-card"],
    "procedures": ["summarize-signal"],
    "migrations": ["legacy-signal-card-v1"]
  },
  "configuration": {
    "schema": "schemas/config.schema.json",
    "file": "plugin.config.json",
    "environment": []
  }
}
```

Plugin IDs match `^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$`; local contribution names match `^[a-z][a-z0-9-]*$`. The host derives the persisted element type as `<plugin-id>/<local-name>` and the MCP tool name by normalizing the plugin ID and appending `__<local-name>`.

The server entry is required; the browser entry and configuration declaration
are optional. Declared commands require a browser entry. All paths are
relative, slash-separated, prebuilt files. Absolute paths, traversal,
reparse-point roots, symlink escape, and undeclared files are rejected.
Browser bundles must contain their runtime dependencies and use relative
chunks/assets.

Manifest declarations are exact, not advisory. Missing, undeclared, duplicate, or colliding registrations fail startup. Plugin and capability requirements use semantic-version ranges; element schema versions are independent positive integers.

New scaffolds maintain a typed `src/extension.mts` definition and generate this
JSON file with `serializeExtensionManifest`. The static JSON remains the
installed source read by discovery.

Continue with [Server SDK](server-sdk.md), [Configuration and secrets](configuration.md), and the concise [manifest reference](../plugin-manifest-reference.md).
