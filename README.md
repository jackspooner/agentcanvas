# AgentCanvas

AgentCanvas v0.3.0-alpha.1 is a local-first visual workspace and MCP server for
canvases built by people and agents. This alpha includes the v0.3 editor
foundation: polished pan, zoom, selection, marquee, multi-move, resize,
clipboard, undo/redo, grid snapping, and a shared command service.

Canvas documents, revisions, SQLite persistence, sharing, viewports, resource
security, HTTP/MCP infrastructure, and snapshot composition remain owned by
the AgentCanvas kernel. Extensions contribute element schemas, renderers,
commands, tools, procedures, migrations, and snapshots without importing the
editor implementation.

AgentCanvas binds to loopback by default and has no user-account or
authentication layer. Extensions are trusted executable application
dependencies; they are not sandboxed.

> **Local-only by default:** keep AgentCanvas on loopback unless it is placed
> behind an authenticated, TLS-terminating reverse proxy. Binding it to a
> network address does not add authentication. See [Security](SECURITY.md)
> before exposing it beyond the local machine.

## Documentation

Start at the [documentation home](docs/README.md). It provides separate paths for installation, upgrades, operations, HTTP/MCP use, architecture, troubleshooting, database migration, and extension creation.

The [v0.3 specification set](docs/specs/README.md) records the product,
interaction, architecture, extension SDK, delivery, and acceptance contracts
for this work. Runtime distribution remains compatible with plugin API v1.

For extensions, start with the [extension authoring
overview](docs/plugin-authoring/README.md) and [complete
tutorial](docs/plugin-authoring/tutorial.md). [How the runtime loads
extensions](docs/plugins.md) explains the compatibility format and operational
model.

## Requirements

- Node.js 24 or newer and npm 11 or newer.
- An empty database, which AgentCanvas initializes at physical schema 3 / document schema 2, or an older database upgraded with the offline CLI before startup.

No media service is required. Local files and [Assets-2](https://github.com/jackspooner/Assets-2) are independently installable image-source extensions.
No process manager is required. AgentCanvas can run directly from the checkout
and does not depend on Servy, systemd, Docker, or any other supervisor.

## Quick start

```bash
npm ci
npm run plugins:build
npm run plugins:materialize -- --defaults
npm run build
npm run dev
```

The commands in [Verification](#verification) are optional checks for a
checkout; they are not required before the first local launch.

Open `http://127.0.0.1:23003/`. Verify the service with:

```bash
curl http://127.0.0.1:23003/health
curl http://127.0.0.1:23003/whoami
curl http://127.0.0.1:23003/openapi.json
```

`/health` reports AgentCanvas core readiness. When the optional Assets-2 extension is installed, its current readiness is reported under `dependencies.assets` without making the core host unavailable.

For a long-running installation, run the already-built application from the
repository root under any supervisor that can set the working directory,
environment, restart policy, and log destinations:

```bash
node --import tsx src/server.ts
```

AgentCanvas does not require or select the supervisor. Optional deployment
configuration remains deployment-owned and is not part of the public source
distribution. See [Getting started](docs/getting-started.md),
[Operations](docs/operations.md), and [Upgrading](docs/upgrading.md).

## Extensions

See [How extensions are loaded](docs/plugins.md) for the full discovery,
activation, registry, trust, missing-extension, and capability model. The
installation format and directory retain their plugin API v1 names for
compatibility.

The runtime source of truth is folder presence:

```text
plugins/
  agentcanvas.primitives/
    agentcanvas.plugin.json
    dist/server.mjs
    dist/browser/...
```

Every non-hidden immediate child directory of `plugins/` is active. Discovery
is non-recursive and deterministic. There is no enabled-extension list,
remote loader, marketplace, or browser upload. Add, remove, or replace a
production extension while AgentCanvas is stopped, then restart.

Source and distribution layout:

```text
plugin-packages/       first-party source workspaces
dist/plugin-catalog/   all built first-party distributions
plugins/               active materialized distributions
```

Commands:

```bash
npm run plugins:build
npm run plugins:list
npm run plugins:materialize -- --defaults
npm run plugins:install -- <distribution-path>
npm run plugins:disable -- <plugin-id>
npm run plugins:verify
```

Default materialization activates:

- `agentcanvas.primitives`
- `agentcanvas.markdown`
- `agentcanvas.table`

The catalog also builds these optional plugins without activating them by default:

- `agentcanvas.filesystem-images`
- `agentcanvas.assets2`
- `agentcanvas.gallery`
- `agentcanvas.image-overlays`
- `agentcanvas.video`
- `agentcanvas.glb-viewer`

Removing an optional plugin preserves canonical stored envelopes. Reads show an explicit diagnostic; frame and metadata edits, deletion, and clear remain available. Reinstalling a compatible plugin restores validation and rendering without rewriting the document.

## Canvas themes

Agents can assign one validated semantic theme to a canvas instead of repeating colors, fonts, borders, and
radii on every element. Theme-aware extensions inherit canvas surfaces, text, highlights, accents, and shape
tokens while explicit element styles remain authoritative. Use `canvas_set_theme` and `canvas_clear_theme`, or
`PATCH /api/v1/canvases/{canvasId}/theme`. Browser and snapshot output share the same theme. See
[Canvas themes](docs/canvas-themes.md).

### Media galleries

`agentcanvas.gallery` presents from 1 through 50 images in one accessible carousel node. Install it with either image-source extension:

```bash
npm run plugins:install -- dist/plugin-catalog/agentcanvas.gallery
```

Gallery items use a stable provider envelope. For example, an allowlisted filesystem item stores:

```json
{
  "provider": "agentcanvas.filesystem-images",
  "reference": { "rootId": "pictures", "path": "products/mug.png" }
}
```

Assets-2 items use `provider: "agentcanvas.assets2"` with the normal durable asset reference under `reference`. Agent tools are exposed as `agentcanvas_gallery__create`, `agentcanvas_gallery__append_items`, `agentcanvas_gallery__remove_item`, `agentcanvas_gallery__reorder_items`, `agentcanvas_gallery__set_cover`, and `agentcanvas_gallery__update_settings`. Slide navigation is browser-local; the persisted `initialIndex` controls the initial slide and deterministic snapshot cover.

## Extension authoring

New third-party extensions import only the public packages:

- `@agentcanvas/extension-sdk`
- `@agentcanvas/extension-testkit`
- `create-agentcanvas-extension`

The v0.2 package names remain compatibility entrypoints:

- `@agentcanvas/plugin-sdk`
- `@agentcanvas/plugin-testkit`
- `create-agentcanvas-plugin`

The packages are publication-ready but are not yet published from this
checkout. To scaffold with the public terminology:

```bash
npm run build --workspace create-agentcanvas-extension
npm exec --workspace create-agentcanvas-extension -- create-agentcanvas-extension my-extension
cd my-extension
npm install
npm test
npm run pack:extension
npm run agentcanvas:verify
```

After npm publication, the public entrypoint will be
`npx create-agentcanvas-extension my-extension`.

The generated `src/extension.mts` descriptor is the authoring source for the
static installation manifest. Browser extensions use a framework-neutral
Shadow DOM renderer lifecycle and may register commands against the shared
editor command service. Commands receive selection, viewport, reveal,
transaction, overlay, diagnostic, and cancellation services; they never
receive a React Flow instance.

Copy the resulting distribution into AgentCanvas with `npm run
plugins:install -- <distribution-path>` and restart. Permissions constrain
supported host services such as `canvas.read` and `canvas.mutate-own`, but they
are not a code-execution sandbox.

See the [author quick start](docs/plugin-authoring/README.md), [complete tutorial](docs/plugin-authoring/tutorial.md), [manifest reference](docs/plugin-manifest-reference.md), [public API reference](docs/plugin-api-reference.md), and [testing/distribution guide](docs/plugin-authoring/testing-and-distribution.md).

## Database migration

AgentCanvas does not upgrade a live database during startup. Stop AgentCanvas and use:

```bash
npm run migrate -- inspect --database <path> --json
npm run migrate -- apply --database <path> --backup-dir <path> --plugins <plugins-path>
npm run migrate -- verify --database <path> --plugins <plugins-path>
npm run migrate -- restore --database <path> --backup <backup-path>
```

After `npm ci`, the equivalent local-bin form is `npm exec -- agentcanvas migrate <command> ...`. The repository wrapper above is the canonical clone-and-run form and does not require a globally installed executable.

`apply` uses the SQLite backup API, writes and verifies a SHA-256 sidecar manifest, transforms documents transactionally through plugin-owned importers, preserves historical events, and commits only after target validation, integrity, and foreign-key checks. It upgrades v0.1 databases directly to physical/document version 3/2, upgrades physical/document 2/2 databases to 3/2 for first-class theme storage, and applies pending installed-extension element-schema migrations. Migration refuses databases containing the removed `group` type or unknown legacy fields/types. `restore` accepts the verified backup produced by either host migration.

See [Upgrading](docs/upgrading.md) and [v0.1 to v0.2 migration](docs/v0.1-to-v0.2-migration.md).

## HTTP, OpenAPI, and MCP

JSON document APIs are under `/api/v1`. Human canvas routes, `/health`, `/whoami`, `/openapi.json`, and `/mcp` remain unversioned.

Important routes:

- `GET/POST /api/v1/canvases`
- `GET/PATCH /api/v1/canvases/:canvasId`
- `POST /api/v1/canvases/:canvasId/elements:batch`
- `POST /api/v1/canvases/:canvasId/snapshot`
- `GET /api/v1/plugins` and `GET /api/v1/plugins/:pluginId`
- `POST /api/v1/plugins/:pluginId/procedures/:procedureName`
- `GET /api/v1/resources/:handle/details`
- `GET /api/v1/resources/:handle/content`
- share-link, configuration, and viewport routes documented by `/openapi.json`

The installed frozen plugin registry generates runtime OpenAPI and both MCP transports. The committed [standard OpenAPI document](docs/openapi.standard.json) represents the three-extension default distribution; verify freshness with `npm run check:openapi`.

Resident MCP is `POST http://127.0.0.1:23003/mcp`. The stdio command is a transport bridge to that resident endpoint and does not rediscover plugins:

```bash
npm run mcp --silent
```

```json
{
  "mcpServers": {
    "agent-canvas": {
      "command": "node",
      "args": [
        "/absolute/path/to/AgentCanvas/node_modules/tsx/dist/cli.mjs",
        "/absolute/path/to/AgentCanvas/src/mcp-v2/stdio.ts"
      ]
    }
  }
}
```

Core element tools use explicit operations such as `canvas_upsert_element`, `canvas_patch_element_frame`, and `canvas_replace_element_data`. Plugin tools are derived as `<normalized-plugin-id>__<local-name>`, for example `agentcanvas_image_overlays__add_bbox`. See the [HTTP/MCP v0.2 mapping](docs/http-mcp-v0.2-mapping.md).

When upgrading an existing MCP client from v0.1, restart or reload that client's MCP server configuration after AgentCanvas restarts, then request a fresh `tools/list`. V0.1 feature aliases are removed; a cached tool catalog can continue showing names that the v0.2 server rejects.

Snapshots and plugin exports return compact opaque resource handles and metadata. Agent-facing JSON never contains full base64 strings or data URLs.

## Environment

Copy `.env.example` to `.env`. The host owns:

```text
AGENT_CANVAS_HOST=127.0.0.1
AGENT_CANVAS_PORT=23003
AGENT_CANVAS_PUBLIC_BASE_URL=http://127.0.0.1:23003
AGENT_CANVAS_ALLOW_REMOTE=false
AGENT_CANVAS_DB=./data/agent-canvas.sqlite
AGENT_CANVAS_DEFAULT_SIZE=unlimited
```

The stdio MCP bridge uses `AGENT_CANVAS_BASE_URL` when set and otherwise connects to `AGENT_CANVAS_PUBLIC_BASE_URL`:

```text
AGENT_CANVAS_BASE_URL=http://127.0.0.1:23003
```

The optional Assets-2 extension owns these settings when installed:

```text
ASSETS_BASE_URL=http://127.0.0.1:23000
AGENT_CANVAS_ASSET_FETCH_TIMEOUT_MS=10000
AGENT_CANVAS_ASSET_METADATA_MAX_BYTES=1048576
AGENT_CANVAS_ASSET_PREVIEW_MAX_BYTES=8388608
AGENT_CANVAS_ASSET_PROXY_MAX_BYTES=268435456
```

Plugin secrets belong only in environment variables declared by that plugin manifest. `plugin.config.json` is validated strictly and may not contain secrets or implicit defaults.

AgentCanvas refuses a non-loopback bind unless `AGENT_CANVAS_ALLOW_REMOTE=true`. This is only for an intentional trusted network and does not add authentication. Host and Origin allowlists are configured with `AGENT_CANVAS_ALLOWED_HOSTS` and `AGENT_CANVAS_ALLOWED_ORIGINS`.

The optional filesystem-images extension is configured in its installed `plugin.config.json`; it deliberately does not accept arbitrary absolute paths from canvas documents or MCP calls.

For a long-running deployment, run AgentCanvas under a dedicated least-privilege operating-system account that can read the installation/extension directories and write only the configured database, data, and log locations. Do not run it as an administrator, root, or `LocalSystem`. Because extensions execute trusted Node.js and same-origin browser code, the runtime account's filesystem and network permissions are the effective security boundary. Optional supervisor examples are not prerequisites or part of the AgentCanvas runtime contract.

## Repository layout

```text
packages/                    public core, editor, SDK, testkit, and scaffolders
plugin-packages/             first-party plugin sources
dist/plugin-catalog/         built plugin distributions
plugins/                     active generated runtime plugins
src/plugin-runtime/          discovery, validation, activation, capabilities
src/store/                   current SQLite store and version checks
src/migrations/              offline migration and restore
src/snapshot-runtime/        safe scene validation and SVG composition
src/mcp-v2/                  registry-derived HTTP and stdio MCP
src/web/                     browser host and canonical mutation reconciliation
test/                        unit, integration, migration, security, and E2E fixtures
docs/                        architecture, contracts, migration, and author guides
```

`@agentcanvas/core` contains generic canvas/document kernel contracts.
`@agentcanvas/editor` owns the React Flow adapter and interaction primitives.
React Flow types do not cross into document, HTTP, MCP, or extension
contracts. Normal element and media behavior lives in the public SDK or owning
extension; the kernel has no closed element union or renderer switch.

## Verification

```bash
npm ci
npm run format:check
npm run lint
npm test
npm run test:e2e
npm run build
npm run plugins:verify
npm run check:openapi
npm run check:docs
git diff --check
```

Architecture and behavioral ownership are detailed in [plugin architecture and migration](docs/plugin-architecture-and-migration.md), [architecture](docs/architecture.md), and [data contracts](docs/data-contracts.md).
