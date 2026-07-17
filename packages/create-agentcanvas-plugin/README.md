# create-agentcanvas-plugin

Compatibility scaffolder for standalone AgentCanvas extensions. New projects
use `@agentcanvas/extension-sdk`, `@agentcanvas/extension-testkit`, and a typed
descriptor that generates the static installation manifest.

New authors should prefer `create-agentcanvas-extension`. This package remains
available so existing automation and documentation do not break.

This package is publication-ready but is not published by the AgentCanvas v0.2 repository refactor. From the AgentCanvas checkout:

```sh
npm run build --workspace create-agentcanvas-plugin
npm exec --workspace create-agentcanvas-plugin -- create-agentcanvas-plugin my-plugin
cd my-plugin
npm install
npm test
npm run pack:extension
npm run agentcanvas:verify
```

After publication, use `npx create-agentcanvas-plugin my-plugin`.

The generated `plugin-dist/<plugin-id>` folder is the installable distribution. Copy it into the AgentCanvas `plugins/` directory with the host's `plugins:install` command, then restart AgentCanvas.

Read the [complete plugin-authoring guide](https://github.com/jackspooner/AgentCanvas/blob/main/docs/plugin-authoring/README.md) and the [end-to-end tutorial](https://github.com/jackspooner/AgentCanvas/blob/main/docs/plugin-authoring/tutorial.md).
