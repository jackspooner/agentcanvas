# AgentCanvas v0.2 plugin architecture refactor

Status: completed. This document is retained as implementation history; use the [documentation home](README.md) for current guidance.

## Outcome

AgentCanvas v0.2 replaces the closed element union with an automatically discovered plugin host. The kernel owns canvas documents, revisions, storage, shares, viewports, plugin discovery, security, browser frames, snapshot composition, HTTP/OpenAPI/MCP infrastructure, diagnostics, and opaque resource delivery. Element-specific schemas, tools, renderers, snapshots, procedures, and migrations belong to plugins.

The active plugin set is exactly the non-hidden immediate child directories under `plugins/`. There is no enabled-plugin list and no `agentcanvas.config.mjs`. Installing, disabling, or replacing a plugin is a filesystem operation followed by an AgentCanvas restart.

## Locked decisions

- Plugin API version: `agentcanvas.plugin/v1`, host API `1.0.0`.
- Product/API cut: AgentCanvas `0.2.0`, JSON API under `/api/v1`; no legacy HTTP projections or feature-tool aliases.
- Persisted element types: `<plugin-id>/<local-type>` with a positive `schemaVersion` and plugin-owned JSON `data`.
- Required standard plugins: `agentcanvas.primitives`, `agentcanvas.markdown`, `agentcanvas.table`, and `agentcanvas.assets2`.
- Assets-2 remains a required runtime dependency. The kernel requires `agentcanvas.assets@^1.0.0`; `agentcanvas.assets2` verifies exact `asset-service` identity plus `asset_crud` and `asset_refs` before listen.
- Optional catalog plugins: `agentcanvas.image-overlays`, `agentcanvas.video`, and `agentcanvas.glb-viewer`.
- `group` is removed. Migration preview identifies group records and apply refuses to continue if any exist.
- Plugins are trusted executable application dependencies. Manifest permissions and Shadow DOM constrain supported host integration but are not sandboxes.
- Runtime plugin modules are prebuilt, self-contained same-origin ESM. Startup never downloads or builds plugins.
- Runtime `/openapi.json` is authoritative for the active registry; a generated standard-distribution artifact is committed and freshness checked.
- v0.1 database migration is an explicit offline operation with a consistent backup, SHA-256 manifest, transaction, verification, and restore path.

## Filesystem and authoring model

```text
packages/plugin-sdk/       public plugin contracts
packages/plugin-testkit/   standalone conformance helpers
packages/create-agentcanvas-plugin/  starter generator
plugin-packages/           first-party plugin sources
dist/plugin-catalog/       built distributions
plugins/                   active materialized distributions only
```

The repository provides `plugins:build`, `plugins:list`, `plugins:materialize -- --defaults`, `plugins:install`, `plugins:disable`, and `plugins:verify`. Installation validates in a hidden staging directory and then renames atomically. Optional sources never live in the scanned runtime folder.

## Canonical element contract

```ts
interface CanvasElement<TData extends JsonObject = JsonObject> {
  id: string;
  type: `${string}/${string}`;
  schemaVersion: number;
  x: number;
  y: number;
  width?: number | null;
  height?: number | null;
  zIndex?: number | null;
  rotation?: number | null;
  opacity?: number | null;
  locked?: boolean | null;
  style?: JsonObject | null;
  metadata?: JsonObject;
  data: TData;
}
```

The kernel validates the envelope. The installed owner validates `data` and optional `style` with strict JSON Schema 2020-12 plus cross-field checks. Generic mutations are split into full upsert, frame patch, data/style replacement, metadata replacement, delete, and clear. Type and schema-version changes happen only through delete/upsert or a registered migration. Missing optional plugins preserve canonical envelopes and allow only kernel-owned frame/metadata/delete/clear operations.

Reads return persisted canvas data separately from `elementRuntime` and structured diagnostics. Provider URLs and resolution errors never enter persistence.

## Runtime registry

Startup discovers manifests deterministically, contain-checks all paths, validates semver requirements, orders dependencies, imports server entries, checks actual registrations against manifest declarations, freezes one registry, verifies database/plugin schema compatibility, checks required capabilities, then builds HTTP/OpenAPI/MCP/browser/snapshot projections before listening.

The frozen registry is the sole contract owner for element validation, read resolution, MCP tools, procedures, OpenAPI components, browser metadata, snapshot dispatch, capabilities, and migrations. Duplicate types, tool names, procedures, migrations, or singleton capability providers fail startup.

## Browser and snapshot model

The host fetches `/api/v1/plugins` and dynamically imports versioned, build-hashed same-origin browser modules. Each plugin registers a framework-neutral `mount/update/dispose` renderer. The host owns the outer geometry frame, selection, drag, lock, read-only enforcement, error boundary, and ShadowRoot. Interactive plugin UI uses `data-agentcanvas-interactive` and composed-path event checks.

Snapshot plugins return bounded typed scene nodes (`group`, `rect`, `ellipse`, `line`, `path`, `text`, `imageHandle`) rather than raw SVG/HTML/CSS. The kernel validates, escapes, resolves opaque handles, applies frame transforms, and serializes the final SVG. Missing or failed renderers produce explicit diagnostic cards. Snapshot API responses return a compact content URL and metadata, not agent-facing data URLs.

## Plugin extraction

- `agentcanvas.primitives`: text, true rectangle/ellipse/diamond shapes, lines/arrows, anchor resolution, labels, browser/snapshot renderers, tools, and legacy importers.
- `agentcanvas.markdown`: Markdown schema, GFM/sanitization policy, browser/snapshot rendering, tool, and importer.
- `agentcanvas.table`: table schema/limits, caption-consistent browser/snapshot rendering, tool, and importer.
- `agentcanvas.assets2`: required provider capability, asset element, resolver/details/resource integration, fit behavior, browser/snapshot rendering, tools, and importer.
- `agentcanvas.image-overlays`: bbox/path schemas, inline or asset-backed hydration, shared geometry, browser/snapshot rendering, PNG/mask ZIP exports, tools/procedures, and importers.
- `agentcanvas.video`: resource/poster schema, browser lifecycle, deterministic snapshot state, tool, and importer.
- `agentcanvas.glb-viewer`: GLB schema, model-viewer browser bundle, deterministic snapshot state, tool, and importer.

Specialist dependencies move into their plugin workspaces. The root host bundle must not contain Markdown, ZIP, model-viewer, video, GLB, or overlay implementation code.

## Database migration

The migration retains `elements_json` but adds explicit physical/document versions, migration ledgers, plugin migration ledgers, namespaced plugin KV, event document versions, and document-versioned canvas-scoped idempotency rows. Existing canvas revisions, timestamps, ordering, metadata, shares, viewports, bounds, configuration, and event JSON remain unchanged. Old idempotency responses are invalidated.

The migration captures a database-specific preflight baseline covering canvases, elements, shares, historical events, old idempotency rows, groups, and runtime-only fields. It maps every legacy type to its namespaced plugin type, strips only known response-only fields with audit counts, and blocks unknown fields/types or groups. Deployment-specific counts are retained in private operator evidence rather than public implementation history.

Commands:

```bash
npm run migrate -- inspect --database <path> [--json]
npm run migrate -- apply --database <path> [--backup-dir <path>]
npm run migrate -- verify --database <path> [--plugins <path>]
npm run migrate -- restore --database <path> --backup <path>
```

Normal startup creates a complete v0.2 schema only for an empty database. Older, newer, partial, or migration-pending databases fail with actionable errors; startup never auto-applies data migrations.

## Execution waves

1. Freeze SDK, manifest, envelope, diagnostics, capabilities, browser/snapshot contracts, plugin registry, and migration foundation.
2. Integrate registry-driven storage, `/api/v1`, OpenAPI, HTTP/stdio MCP parity, browser runtime, snapshot compositor, and resources.
3. Extract primitives, Markdown, table, Assets-2, and image overlays; remove legacy dispatch only after parity tests.
4. Extract video and GLB; add catalog/materialization tooling, testkit, scaffolder, starter, and external-plugin proof.
5. Run migration rehearsal, adversarial security tests, Playwright browser/visual tests, documentation/OpenAPI review, then the Servy-managed live cutover with rollback on any failed acceptance check.

The primary agent owns root dependencies/lockfile, shared contracts, central entrypoints, service configuration, documentation, and live cutover. Subagents receive disjoint new directories and report shared-file integration requirements to the primary agent.

## Completion gates

- No normal element type is hard-coded in kernel validation, browser dispatch, snapshot dispatch, MCP schemas, HTTP schemas, or OpenAPI.
- Folder presence is the only active-plugin state.
- A standalone external plugin installs and appears across browser, snapshot, HTTP procedure, MCP, and OpenAPI without rebuilding AgentCanvas.
- Missing optional plugins preserve data and reinstall restores behavior without document mutation.
- Required Assets-2 startup/health/whoami/Servy behavior remains synchronized.
- Migration and restore are rehearsed against a copy, then the target database passes its archived preflight-count, preservation-fingerprint, and integrity checks.
- Unit, integration, security, packaging, Playwright, build, lint, formatting, OpenAPI freshness, MCP, browser, and live smoke gates pass.
- README, `.env.example`, AGENTS, architecture, data contracts, migration guide, plugin author guide, OpenAPI, service template, and release notes agree with runtime behavior.
