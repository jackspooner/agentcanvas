# AgentCanvas v0.2 functionality inventory

Status: implemented and live-verified inventory, updated 2026-07-13.

This document distinguishes durable source code, generated catalog/runtime state, and the one explicit overlay-export limitation. The reference deployment completed its v0.2 cutover.

## Current product boundary

AgentCanvas v0.2 is a plugin host around a revisioned SQLite canvas kernel. The kernel owns document identity and layout, storage, revisions, idempotency, sharing, viewport state, plugin discovery and activation, HTTP and MCP transports, browser framing, snapshot composition, resource delivery, diagnostics, and security policy. Normal element behavior comes from plugins.

The process entrypoint is `src/server.ts`, which starts the v0.2 runtime in `src/server-v2.ts`. Core has no media-service dependency; image sources are optional extensions.

## Kernel inventory

| Area | Implemented behavior | Primary owner |
|---|---|---|
| Documents | Create, list, read, bounds/title updates, revisions, events, optimistic concurrency, canvas-scoped idempotency | `src/store/v2.ts` |
| Elements | Generic namespaced envelope; upsert, frame patch, data/style replacement, metadata replacement, delete, clear | `src/store/v2.ts`, `src/plugin-runtime/elements.ts` |
| Missing plugins | Preserve canonical envelopes; allow frame/metadata/delete/clear; reject plugin-owned writes | `src/plugin-runtime/elements.ts`, `src/store/v2.ts` |
| Plugin runtime | Immediate-child discovery, strict manifests/config, containment checks, semver ordering, activation checks, frozen registry | `src/plugin-runtime/` |
| Capabilities | Singleton semver providers; host resource broker; required Assets capability readiness | `src/plugin-runtime/`, `src/resources/` |
| Plugin KV | SQLite-backed, plugin-namespaced JSON values; 256 KiB per value; bounded listing | `src/plugin-runtime/services.ts` |
| Diagnostics | Safe structured plugin and element diagnostics | SDK and runtime services |
| Browser | Same-origin catalog/modules, Shadow DOM renderer host, host frames, movement, read-only mode, geometry, overlays | `src/web/` |
| Snapshots | Bounded scene IR, per-renderer deadline, safe validation/serialization, resource handles, diagnostic fallbacks | `src/snapshot-runtime/` |
| Sharing | Hashed read-only tokens, expiry, list/revoke, read-only browser/API projection | `src/store/v2.ts`, `src/server-v2.ts` |
| Viewports | User viewport recording and agent focus, separate from document revisions | `src/store/v2.ts`, browser |
| HTTP | Versioned JSON routes plus unversioned health, identity, OpenAPI, MCP, and browser routes | `src/server-v2.ts` |
| MCP | Resident stateless Streamable HTTP server; stdio bridge proxies the resident server | `src/mcp-v2/` |
| Migration | Read-only inspection, native SQLite backup, transactional v0.1→v0.2 apply, verification, manifest-checked restore | `src/migrations/`, `src/cli/` |

## First-party plugin inventory

The source packages exist under `plugin-packages/`. Building the catalog does not activate them; only a visible immediate child folder under `plugins/` is active.

| Plugin | Default | Elements | Tools | Procedures | Capabilities |
|---|---:|---|---|---|---|
| `agentcanvas.primitives` | yes | `text`, `shape`, `line`, `arrow` | `add-text`, `add-shape`, `add-line`, `add-arrow` | — | — |
| `agentcanvas.markdown` | yes | `document` | `add-document` | — | — |
| `agentcanvas.table` | yes | `table` | `add-table` | — | — |
| `agentcanvas.filesystem-images` | optional | `image` | `place`, `list-roots` | — | allowlisted local raster files through snapshot resources |
| `agentcanvas.assets2` | optional | `asset` | `place`, `get-details` | `details` | provides `agentcanvas.assets@1.0.0` |
| `agentcanvas.gallery` | optional | `gallery` | `create`, `append-items`, `remove-item`, `reorder-items`, `set-cover`, `update-settings` | — | provider-neutral images through `agentcanvas.image-sources@1.0.0` |
| `agentcanvas.image-overlays` | optional | `bbox`, `path` | `add-bbox`, `add-path`, `export-png`, `export-mask-zip` | `export-png`, `export-mask-zip` | requires Assets and snapshot resources |
| `agentcanvas.video` | optional | `video` | `place` | — | requires Assets |
| `agentcanvas.glb-viewer` | optional | `model` | `place` | — | requires Assets |

Persisted types are host-derived, for example `agentcanvas.markdown/document`. MCP tool names are host-derived, for example `agentcanvas_markdown__add_document`.

### Verified plugin behavior

- Primitives render distinct rectangle, ellipse, and diamond shapes. Connector renderers use host geometry for element anchors and render labels.
- Markdown escapes raw HTML, renders safe HTTP(S) and same-origin relative image URLs by default, supports per-document `allowImages: false`, rejects unsafe links and image schemes, and produces a deterministic semantic snapshot rather than DOM pixel parity.
- Tables render captions in both browser and snapshot output.
- Assets-2 validates durable refs, probes exact provider identity/capabilities, resolves metadata and bounded JSON content, creates same-origin resource handles, sanitizes details, and implements `contain`, `cover`, `stretch`, and `original` fit semantics.
- Image overlays support inline and asset-backed bbox layouts, path overlays, labels/legends, browser PNG/ZIP export, and server PNG/ZIP opaque-resource procedures. Server PNG output reports a warning when a referenced background image is not embedded.
- Video and GLB plugins resolve Assets-2 resources, manage browser object-URL cleanup, and render deterministic poster or placeholder snapshots.
- `group` has no v0.2 plugin or canonical type. Migration blocks if any legacy group is present.

## Source, catalog, and active state

```text
plugin-packages/       first-party source workspaces
dist/plugin-catalog/   generated self-contained distributions
plugins/               active runtime distributions
plugins-disabled/      timestamped disabled distributions
```

Implemented commands:

```text
npm run plugins:build
npm run plugins:list
npm run plugins:materialize -- --defaults
npm run plugins:install -- <distribution-path>
npm run plugins:disable -- <plugin-id>
npm run plugins:verify
```

`plugins:build` builds workspaces and rebuilds the catalog. Default materialization installs primitives, Markdown, and table. Install and materialize use a hidden staging folder followed by rename. Disable moves an active folder to `plugins-disabled/` and refuses while the configured AgentCanvas `/whoami` endpoint identifies a running service. Replacement remains an explicit disable-then-install operation while stopped.

## Verified distribution and migration behavior

At the time of this inventory:

- The complete first-party catalog contains seven plugins. A fresh `--defaults` materialization installs only four.
- `dist/plugin-catalog/` contains all seven first-party distributions.
- `docs/openapi.standard.json` is generated from the default registry.
- Migration verification compares each database against its own archived preflight counts and preservation fingerprints.

The reference migration preserved its canvases, elements, shares, and historical events; mapped every current element to a namespaced v0.2 type; stripped only audited runtime fields; invalidated obsolete v0.1 response rows; and passed integrity and foreign-key checks. Deployment-specific counts and backup identifiers are intentionally not part of this public inventory.

## Explicit overlay export limitation

Image-overlay server PNG export does not decode and composite arbitrary referenced raster backgrounds; it emits the explicit `image_background_not_embedded` diagnostic. This avoids adding an unapproved native image decoder. Browser export can composite its already resolved image.

Reference acceptance covered Assets-2 identity and health, the plugin catalog, representative migrated canvas reads, opaque snapshot resources, HTTP/stdio MCP parity, production bundle delivery, migrated overlay rendering, and migrated Assets-2 rendering.

See [Plugin architecture and migration](plugin-architecture-and-migration.md), [v0.1 to v0.2 migration](v0.1-to-v0.2-migration.md), and [v0.2 release notes](release-notes-v0.2.0.md).
