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

Omit `height` when adding a document to use conservative style-aware sizing.
Automatic sizing is capped at 1200px; content that still needs more space
returns a clipping warning so the caller can split or expand it. Set
`allowScroll: true` only when an internal scrollbar is intentional.

Version 0.3.0 adds the `agentcanvas.markdown/carousel` element. Select 2–50
unlocked Markdown documents and run **Combine as Markdown carousel** from the
editor's Extensions menu. The inverse **Unpack Markdown carousel** command
restores their source IDs and relative layout at the deck's current position.
Navigation is local to the browser; snapshots use the persisted initial card.
There is no autoplay or mixed-element nesting.

Version 0.3.0 requires host API 1.3.0. An explicitly undersized frame without
`allowScroll: true` returns a 400 validation problem with the required height,
rather than a generic server error. Existing sizing and scrolling behavior is
unchanged.

See the [AgentCanvas plugin guide](https://github.com/jackspooner/agentcanvas/blob/main/docs/plugins.md) for installation and lifecycle details.
