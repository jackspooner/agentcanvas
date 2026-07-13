# AgentCanvas

AgentCanvas v0.2 is a local browser canvas and MCP server built around automatically discovered plugins. The kernel owns canvas documents, revisions, SQLite persistence, sharing, viewports, resource security, HTTP/MCP infrastructure, browser framing, and safe snapshot composition. Element schemas, renderers, tools, procedures, legacy importers, and snapshot contributions come from plugins.

AgentCanvas binds to loopback by default and has no user-account or authentication layer. Plugins are trusted executable application dependencies, not sandboxed extensions.

## Documentation

Start at the [documentation home](docs/README.md). It provides separate paths for installation, operations, HTTP/MCP use, architecture, troubleshooting, database migration, and plugin creation.

For plugins, start with [how plugins work](docs/plugins.md), then use the [plugin authoring overview](docs/plugin-authoring/README.md) and [complete first-plugin tutorial](docs/plugin-authoring/tutorial.md).

## Requirements

- Node.js 24 or newer and npm 11 or newer.
- [Assets-2](https://github.com/jackspooner/Assets-2) running at the configured `ASSETS_BASE_URL` with exact `/whoami` identity `asset-service` and capabilities `asset_crud` and `asset_refs`.
- An empty v0.2 database, or a v0.1 database migrated with the offline CLI before startup.

Assets-2 is a separate, simultaneously running service rather than an npm dependency embedded in AgentCanvas. Clone and start it before AgentCanvas:

```bash
git clone https://github.com/jackspooner/Assets-2.git
cd Assets-2
npm install
cp .env.example .env
npm start
```

On Windows PowerShell, replace the copy command with `Copy-Item .env.example .env`. The default public setup listens at `http://127.0.0.1:23000`; confirm `GET /health` and `GET /whoami` before starting AgentCanvas. Keep Assets-2 running whenever AgentCanvas is running. See [Getting started](docs/getting-started.md) for the two-service startup order and verification.

## Quick start

```bash
npm ci
npm run plugins:build
npm run plugins:materialize -- --defaults
npm test
npm run build
npm run dev
```

Open `http://127.0.0.1:23003/`. Verify the service with:

```bash
curl http://127.0.0.1:23003/health
curl http://127.0.0.1:23003/whoami
curl http://127.0.0.1:23003/openapi.json
```

AgentCanvas does not listen if the required Assets-2 plugin or provider is unavailable, has the wrong identity, or lacks required capabilities. `/health` becomes HTTP 503 if Assets-2 later becomes unhealthy.

## Plugins

See [How plugins work](docs/plugins.md) for the full discovery, activation, registry, trust, missing-plugin, and capability model.

The runtime source of truth is folder presence:

```text
plugins/
  agentcanvas.primitives/
    agentcanvas.plugin.json
    dist/server.mjs
    dist/browser/...
```

Every non-hidden immediate child directory of `plugins/` is active. Discovery is non-recursive and deterministic. There is no `agentcanvas.config.mjs`, enabled-plugin list, database flag, remote loader, marketplace, hot reload, or browser upload. Add, remove, or replace a plugin while AgentCanvas is stopped, then restart.

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
- `agentcanvas.assets2` (required)

The catalog also builds these optional plugins without activating them by default:

- `agentcanvas.image-overlays`
- `agentcanvas.video`
- `agentcanvas.glb-viewer`

Removing an optional plugin preserves canonical stored envelopes. Reads show an explicit diagnostic; frame and metadata edits, deletion, and clear remain available. Reinstalling a compatible plugin restores validation and rendering without rewriting the document.

## Plugin authoring

Third-party plugins import only the public packages:

- `@agentcanvas/plugin-sdk`
- `@agentcanvas/plugin-testkit`
- `create-agentcanvas-plugin`

The scaffolder is publication-ready but is not published by this repository refactor. From this checkout:

```bash
npm run build --workspace create-agentcanvas-plugin
npm exec --workspace create-agentcanvas-plugin -- create-agentcanvas-plugin my-plugin
cd my-plugin
npm install
npm test
npm run pack:plugin
npm run agentcanvas:verify
```

After npm publication, the public entrypoint will be `npx create-agentcanvas-plugin my-plugin`.

Copy the resulting distribution into AgentCanvas with `npm run plugins:install -- <distribution-path>` and restart. Browser plugins use a framework-neutral Shadow DOM lifecycle; server plugins register declared contributions against a frozen host registry. Permissions constrain supported host services such as `canvas.read` and `canvas.mutate-own`, but they are not a code-execution sandbox.

See the [author quick start](docs/plugin-authoring/README.md), [complete tutorial](docs/plugin-authoring/tutorial.md), [manifest reference](docs/plugin-manifest-reference.md), [public API reference](docs/plugin-api-reference.md), and [testing/distribution guide](docs/plugin-authoring/testing-and-distribution.md).

## Database migration

AgentCanvas v0.2 does not upgrade a live database during startup. Stop AgentCanvas and use:

```bash
npm run migrate -- inspect --database <path> --json
npm run migrate -- apply --database <path> --backup-dir <path> --plugins <plugins-path>
npm run migrate -- verify --database <path> --plugins <plugins-path>
npm run migrate -- restore --database <path> --backup <backup-path>
```

After `npm ci`, the equivalent local-bin form is `npm exec -- agentcanvas migrate <command> ...`. The repository wrapper above is the canonical clone-and-run form and does not require a globally installed executable.

`apply` uses the SQLite backup API, writes and verifies a SHA-256 sidecar manifest, transforms documents transactionally through plugin-owned importers, preserves historical events, and commits only after target validation, integrity, and foreign-key checks. It also applies pending installed-plugin element-schema migrations for an existing v0.2 database. Migration refuses databases containing the removed `group` type or unknown legacy fields/types.

See [v0.1 to v0.2 migration](docs/v0.1-to-v0.2-migration.md).

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

The installed frozen plugin registry generates runtime OpenAPI and both MCP transports. The committed [standard OpenAPI document](docs/openapi.standard.json) represents the four-plugin default distribution; verify freshness with `npm run check:openapi`.

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

The required Assets-2 plugin owns the existing asset settings:

```text
ASSETS_BASE_URL=http://127.0.0.1:23000
AGENT_CANVAS_ASSET_FETCH_TIMEOUT_MS=10000
AGENT_CANVAS_ASSET_METADATA_MAX_BYTES=1048576
AGENT_CANVAS_ASSET_PREVIEW_MAX_BYTES=8388608
AGENT_CANVAS_ASSET_PROXY_MAX_BYTES=268435456
```

Plugin secrets belong only in environment variables declared by that plugin manifest. `plugin.config.json` is validated strictly and may not contain secrets or implicit defaults.

AgentCanvas refuses a non-loopback bind unless `AGENT_CANVAS_ALLOW_REMOTE=true`. This is only for an intentional trusted network and does not add authentication. Host and Origin allowlists are configured with `AGENT_CANVAS_ALLOWED_HOSTS` and `AGENT_CANVAS_ALLOWED_ORIGINS`.

Run AgentCanvas under a dedicated least-privilege operating-system account that can read the installation/plugin directories and write only the configured database, data, and log locations. Do not run it as an administrator, root, or `LocalSystem`. Because plugins execute trusted Node.js and same-origin browser code, the service account's filesystem and network permissions are the effective security boundary.

## Repository layout

```text
packages/                    public core, SDK, testkit, and scaffolder packages
plugin-packages/             first-party plugin sources
dist/plugin-catalog/         built plugin distributions
plugins/                     active generated runtime plugins
src/plugin-runtime/          discovery, validation, activation, capabilities
src/store/                   v0.2 SQLite store and version checks
src/migrations/              offline migration and restore
src/snapshot-runtime/        safe scene validation and SVG composition
src/mcp-v2/                  registry-derived HTTP and stdio MCP
src/web/                     generic browser host
test/                        unit, integration, migration, security, and E2E fixtures
docs/                        architecture, contracts, migration, and author guides
```

`@agentcanvas/core` contains only generic canvas/document kernel contracts. Normal element and media contracts live in the public SDK or owning plugin; the kernel has no closed element union or element renderer switch.

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
