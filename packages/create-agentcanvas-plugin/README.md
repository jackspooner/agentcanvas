# create-agentcanvas-plugin

Compatibility scaffolder for standalone AgentCanvas extensions. New projects
use `@agentcanvas/extension-sdk`, `@agentcanvas/extension-testkit`, and a typed
descriptor that generates the static installation manifest.

New authors should prefer `create-agentcanvas-extension`. This package remains
available so existing automation and documentation do not break.

This package is not published to npm. The [public-source build](https://github.com/jackspooner/agentcanvas/blob/main/docs/plugin-authoring/testing-and-distribution.md#build-the-authoring-packages-from-public-source)
builds it alongside the extension scaffolder and all required SDK/testkit
packages, without private GitHub access or an npm account. Follow the linked
local-package example to generate and install an extension before testing it.
For compatibility automation, invoke this package's built `dist/cli.js` instead
of the extension scaffolder's CLI; both use the same extension template.

The generated `plugin-dist/<plugin-id>` folder is the installable distribution. Copy it into the AgentCanvas `plugins/` directory with the host's `plugins:install` command, then restart AgentCanvas.

Read the [complete plugin-authoring guide](https://github.com/jackspooner/agentcanvas/blob/main/docs/plugin-authoring/README.md) and the [end-to-end tutorial](https://github.com/jackspooner/agentcanvas/blob/main/docs/plugin-authoring/tutorial.md).
