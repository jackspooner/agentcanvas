# AgentCanvas v0.2.0 release notes

Status: implementation and reference-deployment verification completed on 2026-07-13. The public release target is the GitHub source repository; the private root package is not published to npm. `@agentcanvas/plugin-sdk`, `@agentcanvas/plugin-testkit`, and `create-agentcanvas-plugin` are prepared as separate public packages but are not available from npm until an explicit package release occurs.

## Breaking changes

- Element types are namespaced plugin types with independent positive schema versions.
- The unversioned JSON API moved to `/api/v1`; old projections are not duplicated.
- Generic element patching was replaced by explicit frame, data/style, metadata, delete, and clear operations.
- Feature MCP aliases were replaced by host-derived plugin tool names.
- Snapshots and generated binary exports return opaque resource handles rather than inline data URLs.
- `group` is removed. Migration refuses any database containing group records.
- V0.1 databases do not open automatically and require the offline migration CLI.

## Plugin platform

- Immediate child folders under `plugins/` are auto-discovered; there is no activation config list.
- Startup validates strict manifests/config, file containment, semver dependencies, singleton capabilities, activation parity, and contribution collisions before listening.
- The public SDK defines server, browser, snapshot, diagnostics, resource, capability, KV, and migration contracts.
- Plugin status, procedures, MCP tools, browser modules, element validation, and snapshots consume one frozen registry.
- Plugins are trusted executable dependencies. Permissions and Shadow DOM are not a sandbox.

## First-party distribution

Default source plugins are primitives, Markdown, tables, and required Assets-2. Image overlays, video, and GLB viewer are optional catalog packages. Before migrating, operators use `npm run migrate -- inspect ...` to identify which optional plugin importers their own database requires.

## Migration and storage

- Physical/document schema version 2, installation metadata, host/plugin migration ledgers, namespaced plugin KV, versioned events, and canvas-scoped idempotency.
- Native SQLite backup with SHA-256 sidecar manifest.
- Deterministic plugin legacy importers and full target validation inside one exclusive transaction.
- Historical event JSON, revisions, timestamps, shares, viewports, canvas metadata, and element order are preserved.
- Runtime-only legacy fields and old idempotency responses are removed and counted.
- Manifest-verified atomic restore preserves the failed v0.2 database.

## Browser and snapshots

- Framework-neutral Shadow DOM renderers with host frames, geometry, read-only enforcement, overlays, abort/dispose lifecycle, and diagnostic isolation.
- Same-origin build-hash module delivery with containment and immutable caching.
- Typed safe snapshot scene with bounded validation, per-renderer deadlines, safe serialization, opaque image handles, and diagnostic fallback cards.
- Connector anchors/labels, distinct primitive shapes, table captions, asset fit semantics, Markdown safety, video cleanup, GLB placeholder policy, and overlay exports are implemented in plugins.

## Operational status

- `dist/plugin-catalog/` contains all seven first-party distributions; a fresh default materialization installs only the four standard plugins.
- Reference migration verification preserved the deployment-specific preflight counts and fingerprints, stripped only audited runtime fields, invalidated obsolete v0.1 responses, and completed with clean integrity and foreign keys.
- Deployment-specific migration IDs, database counts, backup filenames, hashes, and retention records remain in the private operator change record rather than the public release notes.
- `docs/openapi.standard.json` is generated and freshness-checked from the default registry.
- Runtime OpenAPI includes implemented v0.2 JSON routes and registry-owned procedure/resource contracts.
- Supported canvas host services enforce `canvas.read` and namespace-scoped `canvas.mutate-own`.
- Pending installed-plugin element migrations fail readiness and are applied offline with backup and ledger records.
- Core MCP element schemas derive from the registry; removed v0.1 aliases are intentionally not retained.
- The stdio bridge honors `AGENT_CANVAS_BASE_URL` as its resident-service override and otherwise uses `AGENT_CANVAS_PUBLIC_BASE_URL`.
- Server overlay PNG export does not composite referenced raster backgrounds and emits a warning.
- Reference acceptance passed health/whoami, plugin status and representative reads, opaque snapshots/resources, production browser rendering, and HTTP/stdio MCP catalog parity.

See [Functionality inventory](plugin-functionality-inventory.md), [Architecture](plugin-architecture-and-migration.md), [Migration guide](v0.1-to-v0.2-migration.md), and [HTTP/MCP mapping](http-mcp-v0.2-mapping.md).
