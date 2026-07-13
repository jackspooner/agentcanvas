# AgentCanvas Agent Guide

## Plugin architecture

- Runtime activation is determined only by non-hidden immediate child folders under `plugins/`. Do not add `agentcanvas.config.mjs`, an enabled-plugin list, recursive discovery, remote loading, or hot reload.
- First-party source belongs in `plugin-packages/`; built distributions belong in `dist/plugin-catalog/`; `plugins/` is generated active runtime state.
- Normal element behavior must use `@agentcanvas/plugin-sdk`. Do not add element type switches to kernel validation, HTTP, MCP, browser, or snapshot code.
- HTTP, OpenAPI, browser delivery, snapshots, and resident MCP must consume one frozen registry. Stdio MCP remains a bridge to the resident `/mcp` endpoint.
- Plugins are trusted executable dependencies. Manifest permissions gate supported host services but are not a security sandbox.
- Missing optional plugins must preserve canonical envelopes. They may not silently normalize, delete, or downgrade stored data.
- Plugin activation changes require a restart. Invalid visible plugin folders fail startup explicitly.

## Required Assets-2 capability

Assets-2 remains required, but its integration is supplied by the required `agentcanvas.assets2` plugin through `agentcanvas.assets@^1.0.0`.

- AgentCanvas SQLite owns documents, layout, revisions, viewports, and share links.
- Assets-2 owns durable media identity, metadata, and bytes.
- The plugin verifies `/health`, exact `asset-service` identity, and `asset_crud` plus `asset_refs` before AgentCanvas listens.
- Runtime `/health` returns 503 when Assets-2 is unavailable, and `/whoami` safely reports provider identity/capabilities.
- Keep the Servy dependency on `Workspace2Assets2`.
- Do not add media storage or a media-disabled fallback to the kernel.

## Contracts and migrations

- Keep manifest, SDK, HTTP, MCP, OpenAPI, browser, snapshot, and migration docs synchronized with public behavior.
- `/openapi.json` is authoritative for the active registry. `docs/openapi.standard.json` is the generated four-default-plugin contract and must pass `npm run check:openapi`.
- v0.1 databases are migrated only by the offline CLI with a verified SQLite backup. Startup must not mutate old schemas opportunistically.
- The removed `group` type is a migration blocker. Never silently delete or preserve it as an undocumented placeholder.
- Installed-plugin element schema changes require contiguous forward-only pure migrations, a readiness failure while pending, and a migration ledger entry when applied.
- Never return agent-facing base64/data URLs; use opaque resource handles.
