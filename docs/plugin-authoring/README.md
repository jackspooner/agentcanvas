# AgentCanvas plugin authoring

AgentCanvas v0.2 is a plugin host. A plugin is a trusted, prebuilt distribution that contributes element validation, tools, procedures, migrations, browser renderers, snapshot renderers, or capabilities through the public `@agentcanvas/plugin-sdk` package.

## The shortest path

The scaffolder package is publication-ready but is not published by this repository refactor. From this checkout, build and invoke it with:

```sh
npm run build --workspace create-agentcanvas-plugin
npm exec --workspace create-agentcanvas-plugin -- create-agentcanvas-plugin my-plugin
cd my-plugin
npm install
npm test
npm run pack:plugin
npm run agentcanvas:verify
```

After the package is published to npm, the equivalent public command is:

```sh
npx create-agentcanvas-plugin my-plugin
```

Do not describe the `npx` form as currently available until publication has actually occurred.

The generated Hello Card plugin includes:

- a strict manifest and required config schema;
- one current-version element data/style contract;
- server registration, summary, and snapshot renderer;
- a framework-neutral Shadow DOM browser renderer;
- one namespaced MCP tool and one typed HTTP procedure;
- a pure legacy importer;
- unit, browser-lifecycle, snapshot, migration, and distribution checks;
- a packaging command producing `plugin-dist/<plugin-id>`.

Follow [Build your first plugin](tutorial.md) for the complete workflow.

## How activation works

Install a built distribution while AgentCanvas is stopped:

```sh
npm run plugins:install -- <distribution-path>
npm run plugins:verify
```

Restart AgentCanvas. Every non-hidden immediate child directory under the installation's `plugins/` directory is active. There is no enabled-plugin list and no `agentcanvas.config.mjs`; folder presence is the only activation state.

Adding, removing, or replacing a plugin requires a restart. Invalid visible folders fail startup rather than being silently skipped.

## Operational and trust model

- Plugins are trusted executable dependencies. Server entries can execute Node.js code and browser entries run same-origin JavaScript. Permissions describe supported host API access; they are not a sandbox.
- Plugin installation is an intentional filesystem operation. Remote loading, browser upload, hot reload, and network installation are outside plugin API v1.
- A declared `plugin.config.json` is required and strictly validated. It receives no implicit defaults. Keep secrets in manifest-declared environment variables, never in config files.
- Removing an optional plugin preserves its canonical element envelopes. Generic frame and metadata operations remain available, while data changes and rendering return explicit missing-plugin diagnostics.
- The standard host still requires the Assets-2 capability, supplied by the `agentcanvas.assets2` plugin.

## Contract ownership

Element data/style, tool input/output, procedure input/output, and configuration schemas are runtime-readable JSON Schema 2020-12 objects. Register those same schema objects through the SDK. The frozen host registry then uses them for validation, OpenAPI, HTTP, and MCP; do not maintain a separate OpenAPI or Zod contract in a plugin.

The installed registry owns the authoritative runtime `/openapi.json`. Host maintainers generate the standard-distribution artifact with `npm run generate:openapi` and validate freshness with `npm run check:openapi`.

## Authoring path

1. [Build your first plugin](tutorial.md)
2. [Manifest v1](manifest-v1.md)
3. [Server SDK](server-sdk.md)
4. [Browser and snapshot ABI](browser-and-snapshot.md)
5. [Configuration and secrets](configuration.md)
6. [Versioning and migrations](versioning-and-migrations.md)
7. [Testing and distribution](testing-and-distribution.md)
8. [External plugin proof](external-plugin-proof.md)

Reference pages:

- [Manifest reference](../plugin-manifest-reference.md)
- [Plugin API reference](../plugin-api-reference.md)
- [Capabilities and permissions](../plugin-capabilities-and-permissions.md)
- [Browser runtime](../plugin-browser-runtime.md)
- [Snapshot runtime](../plugin-snapshot-runtime.md)
