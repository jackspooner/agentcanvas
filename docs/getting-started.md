# Getting started

This guide installs a development or local operator copy of AgentCanvas
v0.3.0-alpha.1 with its three default extensions.

## Prerequisites

- Node.js 24 or newer.
- npm 11 or newer.

AgentCanvas has no user-account layer. It binds to loopback by default.
Extensions are trusted executable dependencies.

## Install dependencies

Clone or enter the AgentCanvas repository and install its dependencies:

```bash
npm ci
```

Copy `.env.example` to `.env` and check at least these values:

```dotenv
AGENT_CANVAS_HOST=127.0.0.1
AGENT_CANVAS_PORT=23003
AGENT_CANVAS_PUBLIC_BASE_URL=http://127.0.0.1:23003
AGENT_CANVAS_DB=./data/agent-canvas.sqlite
```

Do not put plugin secrets in `plugin.config.json`. A plugin declares the names of required environment variables in its manifest, while deployment owns their values.

## Build and activate the default plugins

```bash
npm run plugins:build
npm run plugins:materialize -- --defaults
npm run plugins:verify
```

The default runtime set is:

- `agentcanvas.primitives`
- `agentcanvas.markdown`
- `agentcanvas.table`

Filesystem images, Assets-2, image overlays, video, and GLB viewing are built into `dist/plugin-catalog/` but are not activated by `--defaults`.

Folder presence is the only activation state. There is no `agentcanvas.config.mjs` and no enabled-plugin list.

## Build and start

```bash
npm run build
npm run dev
```

Open [http://127.0.0.1:23003/](http://127.0.0.1:23003/).

The service starts only after plugin discovery, activation, registry freezing, exact database-version checks, and contract generation all succeed.

## Verify the service

```bash
curl http://127.0.0.1:23003/health
curl http://127.0.0.1:23003/whoami
curl http://127.0.0.1:23003/api/v1/plugins
curl http://127.0.0.1:23003/openapi.json
```

Expected signals:

- `/health` returns HTTP 200. Optional provider status appears under `dependencies` only when that provider is installed.
- `/whoami` reports `version: "0.3.0-alpha.1"`, `pluginApi: "1.0.0"`, and the active extension IDs.
- `/api/v1/plugins` contains sanitized plugin status without config values, environment values, secrets, or local paths.
- `/` serves the built browser bundle from `/assets/...`.

## Create a first canvas

```bash
curl -X POST http://127.0.0.1:23003/api/v1/canvases \
  -H "Content-Type: application/json" \
  -d '{"title":"My first canvas"}'
```

Use the returned canvas ID at `http://127.0.0.1:23003/canvases/<canvas-id>`.

For API mutations and MCP usage, continue to [HTTP and MCP](http-and-mcp.md). To add a third-party element type, continue to [Plugin authoring](plugin-authoring/README.md).

## Choose an image source

No image provider is required. With AgentCanvas stopped, install one or both first-party sources from the built catalog.

For local files:

```bash
npm run plugins:install -- dist/plugin-catalog/agentcanvas.filesystem-images
```

Edit `plugins/agentcanvas.filesystem-images/plugin.config.json` and add one or more absolute, administrator-controlled roots. Canvas nodes and MCP calls use only a root ID plus a slash-separated relative path. The service account needs read access to each root.

For durable Assets-2 references:

```bash
npm run plugins:install -- dist/plugin-catalog/agentcanvas.assets2
```

Start a compatible [Assets-2](https://github.com/jackspooner/Assets-2) service, set `ASSETS_BASE_URL` when it is not at `http://127.0.0.1:23000`, then restart AgentCanvas. The provider must identify as `asset-service` and advertise `asset_crud` and `asset_refs`.

## Existing databases

- An empty database is initialized transactionally at v0.2.
- An exact v0.2 database opens normally.
- A v0.1 database does not migrate during startup; use the [offline migration guide](v0.1-to-v0.2-migration.md).
- A newer or contradictory database fails explicitly.

## Production service

The repository includes a Windows service-manager template under `service/`. Adapt its paths and service names to your installation and use the built browser output. Run AgentCanvas as a dedicated least-privilege account rather than an administrator or `LocalSystem`, grant filesystem extensions only the roots they need, and replace extensions only while the service is stopped. See [Operations](operations.md).
