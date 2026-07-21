# AgentCanvas Markdown plugin

First-party sanitized Markdown elements for AgentCanvas. This plugin is part of the default installation.

The installable distribution is built into `dist/plugin-catalog/agentcanvas.markdown` by `npm run plugins:build`. Plugin activation is determined solely by the distribution folder being present under the host's `plugins/` directory and requires a service restart.

Markdown image syntax renders HTTP(S) and same-origin relative image URLs by
default. Set `allowImages: false` in a document's data, or pass
`allowImages: false` to the `add-document` tool, to keep the alt text without
loading the image. `file://` URLs and arbitrary filesystem paths are rejected;
use `agentcanvas.filesystem-images` for administrator-controlled local files.
Remote image loads can disclose a viewer's network request to the image host,
so disable them for untrusted Markdown when that matters.

See the [AgentCanvas plugin guide](https://github.com/jackspooner/agentcanvas/blob/main/docs/plugins.md) for installation and lifecycle details.
