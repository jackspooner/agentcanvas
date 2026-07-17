# create-agentcanvas-extension

Scaffold a standalone AgentCanvas extension using
`@agentcanvas/extension-sdk` and `@agentcanvas/extension-testkit`.

From an AgentCanvas checkout:

```sh
npm run build --workspace create-agentcanvas-extension
npm exec --workspace create-agentcanvas-extension -- create-agentcanvas-extension my-extension
```

After publication:

```sh
npx create-agentcanvas-extension my-extension
```

The generated project keeps a typed extension descriptor as its authoring
source and writes a strict static `agentcanvas.plugin.json` for installation.
Production installations remain folder-based and require an AgentCanvas
restart.
