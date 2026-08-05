# AgentCanvas Agent Guide

## Assets-2 usage

- `agentcanvas.assets2` is an optional image-source extension. AgentCanvas stores the durable reference envelope; Assets-2 owns media identity and bytes.
- Preserve canonical refs as `{type: "asset", project, assetId}`. Do not copy Assets-2 bytes into AgentCanvas or add provider-specific fallbacks to core.
- Use the native Assets-2 surface or the shared client for asset operations, and never return local paths, signed URLs, or inline binary data to agents.

## Plugin architecture

- The public product term is extension. Keep `plugin`, `plugins/`, and
  `agentcanvas.plugin/v1` where they are compatibility/runtime identifiers;
  new public authoring surfaces should use extension terminology.
- `@agentcanvas/editor` is the only package allowed to import React Flow.
  Document, HTTP, MCP, root web, and extension APIs must stay on canonical
  AgentCanvas contracts.
- Core toolbar, keyboard, menu, and extension actions must use the shared
  editor command service.
- Runtime activation is determined only by non-hidden immediate child folders under `plugins/`. Do not add `agentcanvas.config.mjs`, an enabled-plugin list, recursive discovery, remote loading, or hot reload.
- First-party source belongs in `plugin-packages/`; built distributions belong in `dist/plugin-catalog/`; `plugins/` is generated active runtime state.
- Normal element behavior must use `@agentcanvas/plugin-sdk`. Do not add element type switches to kernel validation, HTTP, MCP, browser, or snapshot code.
- HTTP, OpenAPI, browser delivery, snapshots, and resident MCP must consume one frozen registry. Stdio MCP remains a bridge to the resident `/mcp` endpoint.
- Plugins are trusted executable dependencies. Manifest permissions gate supported host services but are not a security sandbox.
- Missing optional plugins must preserve canonical envelopes. They may not silently normalize, delete, or downgrade stored data.
- Plugin activation changes require a restart. Invalid visible plugin folders fail startup explicitly.

## Optional media capabilities

AgentCanvas core has no required media extension or process-manager dependency.
The optional public Docker Compose and Windows Service Control Manager helpers
live under `compose.yaml` and `deploy/`; they are deployment conveniences, not
kernel contracts.

- The host owns `agentcanvas.image-sources@1.0.0`, a registry for provider-neutral image references and opaque image resources.
- `agentcanvas.assets2` and `agentcanvas.filesystem-images` register independent providers in that registry.
- `agentcanvas.gallery` consumes the registry and must not import or encode either provider's private implementation.
- AgentCanvas SQLite owns documents, layout, revisions, viewports, share links, and stable provider reference envelopes. Source extensions own media identity and bytes.
- Missing optional media extensions preserve canonical elements and return explicit diagnostics. Do not add implicit provider fallbacks to the kernel.

## Contracts and migrations

- Keep manifest, SDK, HTTP, MCP, OpenAPI, browser, snapshot, and migration docs synchronized with public behavior.
- `/openapi.json` is authoritative for the active registry. `docs/openapi.standard.json` is the generated four-default-plugin contract and must pass `npm run check:openapi`.
- v0.1 databases are migrated only by the offline CLI with a verified SQLite backup. Startup must not mutate old schemas opportunistically.
- The removed `group` type is a migration blocker. Never silently delete or preserve it as an undocumented placeholder.
- Installed-plugin element schema changes require contiguous forward-only pure migrations, a readiness failure while pending, and a migration ledger entry when applied.
- Never return agent-facing base64/data URLs; use opaque resource handles.
