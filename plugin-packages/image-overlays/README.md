# AgentCanvas image overlays plugin

First-party bounding-box and path-overlay elements and exports for AgentCanvas. This plugin is built with AgentCanvas but is optional and inactive in a default installation.

The installable distribution is built into `dist/plugin-catalog/agentcanvas.image-overlays` by `npm run plugins:build`. Plugin activation is determined solely by the distribution folder being present under the host's `plugins/` directory and requires a service restart. Asset-backed overlays consume the Assets capability; inline overlays do not require an asset reference.

See the [advanced image overlays guide](https://github.com/jackspooner/agentcanvas/blob/main/docs/plugin-authoring/image-overlays-reference.md) for its public contracts and export behavior.
