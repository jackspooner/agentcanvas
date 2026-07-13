# Getting started

This guide installs a development or local operator copy of AgentCanvas v0.2 with its four default plugins.

## Prerequisites

- Node.js 24 or newer.
- npm 11 or newer.
- [Assets-2](https://github.com/jackspooner/Assets-2) reachable from the AgentCanvas machine.
- Assets-2 `GET /whoami` must identify exactly as `asset-service` and advertise `asset_crud` and `asset_refs`.

AgentCanvas has no user-account layer. It binds to loopback by default. Plugins are trusted executable dependencies.

## Install and start Assets-2

Assets-2 is a separate public service and must run at the same time as AgentCanvas. It is not installed by `npm ci` in the AgentCanvas checkout.

```bash
git clone https://github.com/jackspooner/Assets-2.git
cd Assets-2
npm install
cp .env.example .env
npm start
```

On Windows PowerShell:

```powershell
git clone https://github.com/jackspooner/Assets-2.git
Set-Location Assets-2
npm install
Copy-Item .env.example .env
npm start
```

The default Assets-2 URL is `http://127.0.0.1:23000`. In another terminal, verify it before starting AgentCanvas:

```bash
curl http://127.0.0.1:23000/health
curl http://127.0.0.1:23000/whoami
```

`/whoami` must report identity `asset-service` and capabilities `asset_crud` and `asset_refs`. Leave the Assets-2 process running. For a different host or port, set AgentCanvas `ASSETS_BASE_URL` to the reachable Assets-2 base URL. Assets-2 storage and deployment options are documented in the [Assets-2 repository](https://github.com/jackspooner/Assets-2).

## Install dependencies

In a second terminal, clone or enter the AgentCanvas repository and install its dependencies:

```bash
npm ci
```

Copy `.env.example` to `.env` and check at least these values:

```dotenv
AGENT_CANVAS_HOST=127.0.0.1
AGENT_CANVAS_PORT=23003
AGENT_CANVAS_PUBLIC_BASE_URL=http://127.0.0.1:23003
AGENT_CANVAS_DB=./data/agent-canvas.sqlite
ASSETS_BASE_URL=http://127.0.0.1:23000
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
- `agentcanvas.assets2`

`agentcanvas.assets2` is required. Image overlays, video, and GLB viewing are built into `dist/plugin-catalog/` but are not activated by `--defaults`.

Folder presence is the only activation state. There is no `agentcanvas.config.mjs` and no enabled-plugin list.

## Build and start

```bash
npm run build
npm run dev
```

Open [http://127.0.0.1:23003/](http://127.0.0.1:23003/).

The service starts only after plugin discovery, activation, registry freezing, exact database-version checks, required capability readiness, and contract generation all succeed.

## Verify the service

```bash
curl http://127.0.0.1:23003/health
curl http://127.0.0.1:23003/whoami
curl http://127.0.0.1:23003/api/v1/plugins
curl http://127.0.0.1:23003/openapi.json
```

Expected signals:

- `/health` returns HTTP 200 and `dependencies.assets.ok: true`.
- `/whoami` reports `version: "0.2.0"`, `pluginApi: "1.0.0"`, and the active plugin IDs.
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

## Existing databases

- An empty database is initialized transactionally at v0.2.
- An exact v0.2 database opens normally.
- A v0.1 database does not migrate during startup; use the [offline migration guide](v0.1-to-v0.2-migration.md).
- A newer or contradictory database fails explicitly.

## Production service

The repository includes a Windows service-manager template under `service/`. Adapt its paths and service names to your installation, keep an explicit dependency on the separately running Assets-2 service, and use the built browser output. Run AgentCanvas as a dedicated least-privilege account rather than an administrator or `LocalSystem`, and replace plugins only while the service is stopped. See [Operations](operations.md).
