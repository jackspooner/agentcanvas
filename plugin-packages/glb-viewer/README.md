# AgentCanvas GLB viewer plugin

First-party interactive GLB model elements for AgentCanvas. This plugin is built with AgentCanvas but is optional and inactive in a default installation. It consumes the Assets capability and bundles `@google/model-viewer` and its browser dependencies.

The installable distribution is built into `dist/plugin-catalog/agentcanvas.glb-viewer` by `npm run plugins:build`. Plugin activation is determined solely by the distribution folder being present under the host's `plugins/` directory and requires a service restart.

The AgentCanvas source is MIT licensed. Bundled browser dependencies retain their original licenses in `THIRD_PARTY_NOTICES.md` alongside the distribution.

See the [AgentCanvas plugin guide](https://github.com/jackspooner/agentcanvas/blob/main/docs/plugins.md) for installation and lifecycle details.
