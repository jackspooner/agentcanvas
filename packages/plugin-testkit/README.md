# AgentCanvas Plugin Testkit

`@agentcanvas/plugin-testkit` uses Ajv and the SDK-owned manifest schema for structural checks for plugin manifests and activation registrations.
It is intentionally structural: the SDK owns structural rules; the AgentCanvas host additionally owns semver, dependency availability, and filesystem containment checks.

Use `validatePluginManifestStructure` or `assertPluginManifestStructure` before packaging. After activating a
plugin in a test host, pass its recorded local contribution names to `validateContributionRegistrations` to
catch missing, undeclared, or duplicate registrations.

The testkit does not start AgentCanvas, access a database, or import private host code.

Use the full [testing and distribution guide](https://github.com/jackspooner/agentcanvas/blob/main/docs/plugin-authoring/testing-and-distribution.md) for browser lifecycle, snapshot safety, migration determinism, packed-public-package, and host conformance coverage.
