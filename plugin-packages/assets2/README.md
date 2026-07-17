# AgentCanvas Assets-2 plugin

Optional first-party Assets-2 capability provider and asset element for AgentCanvas. Install it when canvases need durable Assets-2 references; AgentCanvas core and other independent image sources do not require it.

The installable distribution is built into `dist/plugin-catalog/agentcanvas.assets2` by `npm run plugins:build`. Plugin activation is determined solely by the distribution folder being present under the host's `plugins/` directory and requires a service restart.

See the [AgentCanvas plugin guide](https://github.com/jackspooner/AgentCanvas/blob/main/docs/plugins.md) for installation and lifecycle details.
