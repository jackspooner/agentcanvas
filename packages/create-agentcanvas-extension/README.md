# create-agentcanvas-extension

Scaffold a standalone AgentCanvas extension using
`@agentcanvas/extension-sdk` and `@agentcanvas/extension-testkit`.

Build this package, its compatibility scaffolder and the SDK/testkit packages
using the [public-source authoring instructions](https://github.com/jackspooner/agentcanvas/blob/main/docs/plugin-authoring/testing-and-distribution.md#build-the-authoring-packages-from-public-source).
The guide then runs the built CLI and installs all four local SDK/testkit
tarballs into the generated project before testing and packaging it.

Requires Node.js 24+, npm 11+, Git and Bash with `tar`. No npm account, private
GitHub access or running host is needed for that build. The packages are not
published to npm; `npx create-agentcanvas-extension` and a generated project's
plain `npm install` are not standalone setup paths.

The generated project keeps a typed extension descriptor as its authoring
source and writes a strict static `agentcanvas.plugin.json` for installation.
Production installations remain folder-based and require an AgentCanvas
restart.
