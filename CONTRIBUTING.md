# Contributing to AgentCanvas

AgentCanvas accepts focused fixes, documentation improvements, editor changes,
and extension-host or first-party-extension contributions. Security reports
belong in the private process described in [SECURITY.md](SECURITY.md), not in
public issues.

## Development setup

Use Node.js 24+, npm 11+, and Git with authenticated access to the pinned
private dependency repositories. See [Getting started](docs/getting-started.md)
for installation configuration and [Upgrading](docs/upgrading.md) for existing
databases.

```text
npm run setup
npm run plugins:build
npm run build
```

`npm run setup` and `npm run setup:worktree` install the committed npm lockfile
using native `npm ci`, including full-commit Git packages. Setup changes only
checkout-local dependencies; it does not start services or databases. Build
workspace packages before extensions and their catalog.

Install Chromium before running browser tests:

```text
npx playwright install chromium
```

Browser fixtures use temporary state and ports 23173–23175. They do not use the
production database. `npm run test:setup` separately proves fresh installation,
required package imports, and lockfile preservation on rerun; it needs network
access and Git credentials.

GitHub Actions requires the `WORKSPACE2_PACKAGES_TOKEN` repository secret with
read access to the pinned private package repositories. The workflow supplies it
to Git only for dependency installation and the fresh-setup test. Fork pull
requests without that secret cannot run these checks. Local setup uses the
operator's existing Git credentials; Docker uses a build secret as documented
in [Deployment](docs/deployment.md#linux-with-docker-compose).

Do not commit runtime data, active `plugins/` contents, generated exports, local `.env` files, SQLite databases, logs, or browser artifacts.

## Architecture boundaries

- The kernel owns canvases, revisions, persistence, sharing, viewport state, security, plugin discovery, the frozen registry, HTTP/MCP infrastructure, browser framing, and snapshot composition.
- `@agentcanvas/editor` owns the React Flow adapter. Root application and
  extension code must not import React Flow.
- Normal element behavior belongs in extensions and uses
  `@agentcanvas/extension-sdk`; do not add element-type switches to kernel
  surfaces.
- Toolbar, keyboard, menu, and extension actions must invoke the same editor
  command service rather than implementing parallel behavior.
- Runtime activation is determined solely by immediate non-hidden folders under `plugins/`. Do not add an enabled-plugin configuration list, recursive discovery, remote loading, or hot reload.
- HTTP, MCP, OpenAPI, browser delivery, and snapshots must consume the same frozen registry.
- Plugins are trusted code. Do not describe manifest permissions or Shadow DOM as a sandbox.
- Missing optional plugins must preserve canonical stored envelopes and produce explicit diagnostics.

Public API changes must update the route-adjacent schemas and registry metadata that generate OpenAPI. Include stable operation IDs, response and error schemas, and useful `x-agent-notes`. Regenerate `docs/openapi.standard.json`; do not edit the generated artifact as a separate contract.

## Extension contributions

First-party plugin source belongs in `plugin-packages/`. Built catalog artifacts and active plugin folders are generated state. A plugin contribution must include strict schemas, browser and snapshot behavior where declared, lifecycle cleanup, migration fixtures for persisted schema changes, distribution verification, and documentation for any public contract.

Third-party authors should use `@agentcanvas/extension-sdk`,
`@agentcanvas/extension-testkit`, and `create-agentcanvas-extension`. An
extension must not import private AgentCanvas source modules or React Flow.
The older plugin-named packages remain compatibility entrypoints.

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
npm run check:mcp-contract
npm run check:contracts
npm run check:docs
npm audit --omit=dev --audit-level=moderate
git diff --check
```

Release-specific checks are `npm run check:release` (source packaging and
extension licenses), `npm run check:extension-packages` (packed authoring
packages and a generated extension), and
`npm run test:chromium --workspace @agentcanvas/extension-diagrams` (Mermaid
rendering and conversion in Chromium). These use disposable fixtures.

Explain the user-visible effect, contract or migration impact, tests added, and documentation updated in the pull request. Keep unrelated cleanup out of the same change.

## Dependencies and generated contracts

The API-contracts npm override pins the same immutable package revision across
the dependency tree, including its complete MIT license for bundled extension
notices.

Prefer existing dependencies and public SDK helpers. New runtime dependencies need a concrete justification, compatible license review, and lockfile update. Never commit credentials or environment-specific sensitive values.

When changing routes, procedures, tools, plugin contributions, schemas, capabilities, or environment variables, update every affected runtime contract, test, README/documentation surface, example, and generated artifact together.
