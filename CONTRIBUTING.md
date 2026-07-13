# Contributing to AgentCanvas

AgentCanvas accepts focused fixes, documentation improvements, and plugin-host or first-party-plugin contributions. Security reports belong in the private process described in [SECURITY.md](SECURITY.md), not in public issues.

## Development setup

Use Node.js 24 and npm 11.

```text
npm ci
npm run build
```

Install Chromium before running browser tests:

```text
npx playwright install chromium
```

Do not commit runtime data, active `plugins/` contents, generated exports, local `.env` files, SQLite databases, logs, or browser artifacts.

## Architecture boundaries

- The kernel owns canvases, revisions, persistence, sharing, viewport state, security, plugin discovery, the frozen registry, HTTP/MCP infrastructure, browser framing, and snapshot composition.
- Normal element behavior belongs in plugins and uses only `@agentcanvas/plugin-sdk`; do not add element-type switches to kernel surfaces.
- Runtime activation is determined solely by immediate non-hidden folders under `plugins/`. Do not add an enabled-plugin configuration list, recursive discovery, remote loading, or hot reload.
- HTTP, MCP, OpenAPI, browser delivery, and snapshots must consume the same frozen registry.
- Plugins are trusted code. Do not describe manifest permissions or Shadow DOM as a sandbox.
- Missing optional plugins must preserve canonical stored envelopes and produce explicit diagnostics.

Public API changes must update the route-adjacent schemas and registry metadata that generate OpenAPI. Include stable operation IDs, response and error schemas, and useful `x-agent-notes`. Regenerate `docs/openapi.standard.json`; do not edit the generated artifact as a separate contract.

## Plugin contributions

First-party plugin source belongs in `plugin-packages/`. Built catalog artifacts and active plugin folders are generated state. A plugin contribution must include strict schemas, browser and snapshot behavior where declared, lifecycle cleanup, migration fixtures for persisted schema changes, distribution verification, and documentation for any public contract.

Third-party authors should use the public SDK, testkit, and scaffolder. A plugin must not import private AgentCanvas source modules. See [the plugin author guide](docs/plugin-authoring/README.md) and [plugin testing guide](docs/plugin-authoring/testing-and-distribution.md).

## Required checks

Before opening a pull request, run:

```text
npm run format:check
npm run lint
npm test
npm run test:e2e
npm run build
npm run plugins:build
npm run plugins:materialize -- --defaults
npm run plugins:verify
npm run check:openapi
npm run check:docs
npm audit --omit=dev --audit-level=moderate
git diff --check
```

Explain the user-visible effect, contract or migration impact, tests added, and documentation updated in the pull request. Keep unrelated cleanup out of the same change.

## Dependencies and generated contracts

Prefer existing dependencies and public SDK helpers. New runtime dependencies need a concrete justification, compatible license review, and lockfile update. Never commit credentials or environment-specific sensitive values.

When changing routes, procedures, tools, plugin contributions, schemas, capabilities, or environment variables, update every affected runtime contract, test, README/documentation surface, example, and generated artifact together.
