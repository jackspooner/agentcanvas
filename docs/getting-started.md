# Getting started

This guide installs a development or local operator copy of AgentCanvas
v0.3.0-alpha.2 with its three default extensions.

## Prerequisites

- Node.js 24 or newer.
- npm 11 or newer.

AgentCanvas has no user-account layer. It binds to loopback by default.
Extensions are trusted executable dependencies.

Default Markdown documents render HTTP(S) and same-origin relative image URLs.
Pass `allowImages: false` to the Markdown tool, or store that field as `false`
in Markdown element data, when an individual document must not load embedded
images. Arbitrary filesystem paths and `file://` URLs are not Markdown sources;
use the optional filesystem-images extension for administrator-controlled local
files. Remote image loads can disclose a viewer's network request to the image
host; set `allowImages: false` for untrusted Markdown when that matters.

An empty database is initialized at physical schema 4 / document schema 2. Existing v0.1 or physical/document 2/2 or 3/2 databases require the offline migration described in [Upgrading](upgrading.md) before the current host starts.

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

Filesystem images, Assets-2, Gallery, image overlays, video, and GLB viewing are built into `dist/plugin-catalog/` but are not activated by `--defaults`. AgentCanvas core requires no media provider.

Folder presence is the only activation state. There is no `agentcanvas.config.mjs` and no enabled-plugin list.

## Build and start

```bash
npm run build
npm run dev
```

Open [http://127.0.0.1:23003/](http://127.0.0.1:23003/).

`npm run dev` is the simplest foreground launcher and is sufficient for a
local installation. AgentCanvas requires no process manager.

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
- `/whoami` reports `version: "0.3.0-alpha.2"`, `pluginApi: "1.1.0"`, and the active extension IDs.
- `/api/v1/plugins` contains sanitized plugin status without config values, environment values, secrets, or local paths.
- `/` serves the built browser bundle from `/assets/...`.

## Create a first canvas

```bash
curl -X POST http://127.0.0.1:23003/api/v1/canvases \
  -H "Content-Type: application/json" \
  -d '{"title":"My first canvas"}'
```

The response includes a direct `url` for the new canvas. Give that URL to the
user when appropriate. It is built from `AGENT_CANVAS_PUBLIC_BASE_URL`; with the
default local configuration it works on the same machine and does not create a
public share link.

For API mutations and MCP usage, continue to [HTTP and MCP](http-and-mcp.md). To add a third-party element type, continue to [Plugin authoring](plugin-authoring/README.md).

If the MCP client supports agent skills, also load the bundled
[`skills/agentcanvas/SKILL.md`](../skills/agentcanvas/SKILL.md). This guidance is
not required by the server, but it teaches an agent to compose readable layouts
and avoid claiming that persisted data proves rendered appearance. Hermes
installation and the eight agent acceptance objectives are documented in
[Agent readiness](agent-readiness.md).

## Choose an image source

No image provider is required. With AgentCanvas stopped, install one or both first-party sources from the built catalog.

For local files:

```bash
npm run plugins:install -- dist/plugin-catalog/agentcanvas.filesystem-images
```

Edit `plugins/agentcanvas.filesystem-images/plugin.config.json` and add one or more absolute, administrator-controlled roots. Canvas nodes and MCP calls use only a root ID plus a slash-separated relative path. The service account needs read access to each root.

To combine several images into one carousel node, also install the provider-neutral Gallery extension:

```bash
npm run plugins:install -- dist/plugin-catalog/agentcanvas.gallery
```

Gallery is optional and works with filesystem images, Assets-2, or both. Its stored items identify the provider and keep the provider-owned durable reference nested under `reference`.

For durable Assets-2 references:

```bash
npm run plugins:install -- dist/plugin-catalog/agentcanvas.assets2
```

Start a compatible [Assets-2](https://github.com/jackspooner/assets2) service, set `ASSETS_BASE_URL` when it is not at `http://127.0.0.1:23000`, then restart AgentCanvas. The provider must identify as `asset-service` and advertise `asset_crud` and `asset_refs`.

## Existing databases

- An empty database is initialized transactionally at physical/document version 4/2.
- An exact physical/document 4/2 database opens normally.
- A physical/document 2/2 or 3/2 database requires the offline physical schema 4 migration.
- A v0.1 database does not migrate during startup; use the [offline migration guide](v0.1-to-v0.2-migration.md).
- A newer or contradictory database fails explicitly.

## Long-running operation

For ready-to-use optional service setups, see [Deployment helpers](deployment.md)
for Docker Compose and Windows Service Control Manager instructions.

After `npm run build`, a supervisor-neutral runtime command is:

```bash
node --import tsx src/server.ts
```

Run it from the repository root with the environment documented in
`.env.example`. Any process supervisor is optional and deployment-owned. If one
is used, configure it to:

- keep the repository root as the working directory;
- pass the required environment without exposing secrets in command arguments;
- run under a dedicated least-privilege account;
- preserve the configured database and logs across code updates;
- stop AgentCanvas before extension replacement or offline migration; and
- restart the process after a new build or extension-set change.

AgentCanvas does not require Servy, systemd, Docker, or any other specific
supervisor. Process-manager configuration remains deployment-owned and is not
part of the public source distribution. See [Operations](operations.md) for
lifecycle requirements and [Upgrading](upgrading.md) before updating an
existing installation.
