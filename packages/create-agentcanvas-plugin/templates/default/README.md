# __DISPLAY_NAME__ AgentCanvas plugin

This standalone example contributes `__PLUGIN_ID__/hello-card`, a browser renderer, a safe snapshot renderer, the `add-hello-card` tool, the `describe-card` procedure, and a pure legacy importer.

The JSON Schema objects in `src/schemas.ts` are the canonical tool, procedure, and element contracts. AgentCanvas consumes them for runtime validation, MCP, and the installed-plugin OpenAPI document.

## Development

```sh
npm install
npm test
npm run check
npm run pack:plugin
npm run agentcanvas:verify
```

`pack:plugin` creates `plugin-dist/__PLUGIN_ID__`. Install that directory with the AgentCanvas host command, then restart the service. Plugin presence under the host's `plugins/` directory is the only activation state.

`plugin.config.json` is required because it is declared in the manifest. Its accent and message-limit values are validated before activation and consumed by the element implementation. Never put tokens or credentials in plugin configuration; declare required secret environment variable names in the manifest instead.

Plugins are trusted same-process and same-origin application dependencies. The permission list describes supported host access; it is not a security sandbox.
