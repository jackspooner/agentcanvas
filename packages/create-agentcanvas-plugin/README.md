# create-agentcanvas-plugin

Scaffold a standalone AgentCanvas plugin that imports only `@agentcanvas/plugin-sdk` and uses `@agentcanvas/plugin-testkit` for conformance checks.

This package is publication-ready but is not published by the AgentCanvas v0.2 repository refactor. From the AgentCanvas checkout:

```sh
npm run build --workspace create-agentcanvas-plugin
npm exec --workspace create-agentcanvas-plugin -- create-agentcanvas-plugin my-plugin
cd my-plugin
npm install
npm test
npm run pack:plugin
npm run agentcanvas:verify
```

After publication, use `npx create-agentcanvas-plugin my-plugin`.

The generated `plugin-dist/<plugin-id>` folder is the installable distribution. Copy it into the AgentCanvas `plugins/` directory with the host's `plugins:install` command, then restart AgentCanvas.

Read the [complete plugin-authoring guide](https://github.com/jackspooner/AgentCanvas/blob/main/docs/plugin-authoring/README.md) and the [end-to-end tutorial](https://github.com/jackspooner/AgentCanvas/blob/main/docs/plugin-authoring/tutorial.md).
