# AgentCanvas video plugin

First-party video elements for AgentCanvas. This plugin is built with AgentCanvas but is optional and inactive in a default installation. It consumes the Assets capability for video and poster resources.

The installable distribution is built into `dist/plugin-catalog/agentcanvas.video` by `npm run plugins:build`. Plugin activation is determined solely by the distribution folder being present under the host's `plugins/` directory and requires a service restart.

See the [AgentCanvas plugin guide](https://github.com/jackspooner/AgentCanvas/blob/main/docs/plugins.md) for installation and lifecycle details.
