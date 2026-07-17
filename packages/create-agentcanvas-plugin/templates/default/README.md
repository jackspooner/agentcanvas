# __DISPLAY_NAME__ AgentCanvas extension

This standalone example contributes `__PLUGIN_ID__/hello-card`, a browser renderer, a browser command, a safe snapshot renderer, the `add-hello-card` tool, the `describe-card` procedure, and a pure legacy importer.

`src/extension.mts` is the typed authoring source. `npm run
generate:manifest` writes the strict static `agentcanvas.plugin.json` consumed
by AgentCanvas during installation.

The JSON Schema objects in `src/schemas.ts` are the canonical tool, procedure, and element contracts. AgentCanvas consumes them for runtime validation, MCP, and the installed-plugin OpenAPI document.

## Development

```sh
npm install
npm test
npm run check
npm run pack:extension
npm run agentcanvas:verify
```

`pack:extension` creates `plugin-dist/__PLUGIN_ID__`. Install that directory with the AgentCanvas host command, then restart the service. Extension presence under the host's `plugins/` directory is the only activation state.

`plugin.config.json` is required because it is declared in the manifest. Its accent and message-limit values are validated before activation and consumed by the element implementation. Never put tokens or credentials in plugin configuration; declare required secret environment variable names in the manifest instead.

Extensions are trusted same-process and same-origin application dependencies. The permission list describes supported host access; it is not a security sandbox.
