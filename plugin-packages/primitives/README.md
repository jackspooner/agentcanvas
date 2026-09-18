# AgentCanvas primitives plugin

First-party text, shape, line, and arrow elements for AgentCanvas. This plugin is part of the default installation.

Version 0.2.1 requires host API 1.3.0. Text and shape add tools increase height to
fit their content estimate while preserving width and position. Explicit heights
are minimums; omitted/null heights start at 100px for text and 160px for shapes.
Larger frames never shrink. Set `allowClipping: true` to preserve a deliberately
small frame. Read the persisted element for its actual dimensions and repair any
overlap warnings after growth. This estimate is not proof of rendered fit.

Existing elements, generic element writes, frame patches, lines, and arrows keep
their dimensions. Literal text containing HTML entities returns a corrective
validation error rather than a server error.

The installable distribution is built into `dist/plugin-catalog/agentcanvas.primitives` by `npm run plugins:build`. Plugin activation is determined solely by the distribution folder being present under the host's `plugins/` directory and requires a service restart.

See the [AgentCanvas plugin guide](https://github.com/jackspooner/agentcanvas/blob/main/docs/plugins.md) for installation and lifecycle details.
