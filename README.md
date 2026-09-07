# AgentCanvas

AgentCanvas v0.3.0-alpha.2 is a local-first visual workspace and MCP server for
canvases built by people and agents. This alpha includes the v0.3 editor
foundation: polished pan, zoom, selection, marquee, multi-move, resize,
clipboard, undo/redo, grid snapping, and a shared command service.

Core HTTP mutations validate the published schemas and return Problem Details
for invalid requests. Browser media resources refresh independently of document
revisions. See the [release notes](docs/release-notes-v0.3.0-alpha.2.md) and
[upgrade guidance](docs/upgrading.md#030-alpha2) for the reliability fixes and
client compatibility notes.

Canvas lists accept an integer `limit` from 1 through 200 (default 50); invalid
HTTP values return `400 validation_error`. MCP preserves stored elements from
missing extensions in read and mutation responses while keeping upserts restricted
to installed types. See [HTTP and MCP](docs/http-and-mcp.md).

Canvas documents, revisions, SQLite persistence, sharing, viewports, resource
security, HTTP/MCP infrastructure, and snapshot composition remain owned by
the AgentCanvas kernel. Extensions contribute element schemas, renderers,
commands, tools, procedures, migrations, and snapshots without importing the
editor implementation.

Trusted host applications can embed one explicitly bounded set of canvases
through a short-lived, origin-scoped iframe session. The iframe is the human
surface; LLMs continue to use the canonical HTTP or MCP contracts. Ordinary
AgentCanvas pages remain non-frameable. See [Embedding
AgentCanvas](docs/embedding.md).

Browser renderers can optionally hook into the editor-owned node Details
affordance. The extension supplies the safe metadata workflow and overlay;
AgentCanvas supplies the consistent button and interaction behavior.

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

- Node.js 24 or newer, npm 11 or newer, and Git with HTTPS access to GitHub.
- A new database, which AgentCanvas initializes at physical schema 4 / document schema 2, or an existing supported database upgraded with the offline CLI before startup.

No media service is required. Local files and [Assets-2](https://github.com/jackspooner/assets2) are independently installable image-source extensions.
Markdown documents render HTTP(S) and same-origin relative image URLs by default;
set `allowImages: false` on an individual Markdown document to keep only its
alt text. Use the filesystem-images extension for administrator-controlled
local files.
No process manager is required. AgentCanvas can run directly from the checkout
and does not depend on Servy, systemd, Docker, or any other supervisor.
For optional packaged service setups, see [Docker Compose and Windows service
deployment](docs/deployment.md).

## Quick start

```bash
npm run setup
npm run plugins:build
npm run plugins:materialize -- --defaults
npm run build
npm run dev
```

`npm run setup` fetches the pinned Workspace2 dependency materializer, builds the
internal packages listed in `.cutlery/internal-deps.toml`, then runs `npm ci` and
verifies the installed package can load. Run it after cloning or updating pins.
`npm ci` alone requires `.cutlery/deps/` to have already been prepared.
See [dependency setup](docs/getting-started.md#install-dependencies) for details.

On Windows, start the already-prepared checkout in the background with:

```powershell
npm run start:background
```

Check or stop it with `.\scripts\agentcanvas-background.ps1 -Action Status` and
`.\scripts\agentcanvas-background.ps1 -Action Stop`. The launcher keeps its
PID and logs under the ignored `tmp/` directory and waits for `/health` before
reporting success. It is a lightweight user-session launcher, not a replacement
for the built-in Windows Service deployment.

The commands in [Verification](#verification) are optional checks for a
checkout; they are not required before the first local launch.

Open `http://127.0.0.1:23003/`. Verify the service with:

```bash
curl http://127.0.0.1:23003/health
curl http://127.0.0.1:23003/whoami
curl http://127.0.0.1:23003/openapi.json
```

`/health` reports AgentCanvas core readiness. When the optional Assets-2 extension is installed, its current readiness is reported under `dependencies.assets` without making the core host unavailable.

For a long-running installation, run AgentCanvas from the repository root under
any supervisor that can set the working directory,
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

Host API `1.1.0` adds a renderer-lifetime signal, activity/reduced-motion
state, and one shared visibility-gated frame scheduler for dynamic visual
nodes. Existing `^1.0.0` extensions remain compatible; extensions using the
new lifecycle or frame fields require `^1.1.0`.

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

`apply` uses the SQLite backup API, writes and verifies a SHA-256 sidecar manifest, transforms documents transactionally through plugin-owned importers, preserves historical events, and commits only after target validation, preservation fingerprints, integrity, and foreign-key checks. It upgrades v0.1 databases directly to physical/document version 4/2, upgrades physical/document 2/2 databases to 4/2 for first-class theme and macro storage, upgrades physical/document 3/2 databases to 4/2 for macro storage, and applies pending installed-extension element-schema migrations. Migration refuses databases containing the removed `group` type or unknown legacy fields/types. `restore` accepts the verified backup produced by any supported host migration.

See [Upgrading](docs/upgrading.md), [physical schema 4 migration](docs/physical-schema-4-migration.md), and [v0.1 to v0.2 migration](docs/v0.1-to-v0.2-migration.md).

## HTTP, OpenAPI, and MCP

JSON document APIs are under `/api/v1`. Human canvas routes, `/health`, `/whoami`, `/openapi.json`, and `/mcp` remain unversioned.

Important routes:

- `GET/POST /api/v1/canvases`
- `POST /api/v1/embed-sessions` and `GET/DELETE /api/v1/embed-sessions/:token`
- `GET/PATCH /api/v1/canvases/:canvasId`
- `POST /api/v1/canvases/:canvasId/elements:batch`
- `POST /api/v1/canvases/:canvasId/snapshot`
- `GET /api/v1/plugins` and `GET /api/v1/plugins/:pluginId`
- `POST /api/v1/plugins/:pluginId/procedures/:procedureName`
- `GET/POST /api/v1/macros`
- `GET /api/v1/macros/:macroId/versions/:macroVersion`
- `POST /api/v1/macros/:macroId/versions` (path-owned macro ID; body has no `macroId`)
- `PATCH /api/v1/macros/:macroId` with `{ "archived": true|false }`
- `POST /api/v1/canvases/:canvasId/macros/:macroId:plan` with `{ macroVersion, anchor, input, label? }`
- `POST /api/v1/canvases/:canvasId/macros:execute`
- `GET /api/v1/resources/:handle/details`
- `GET /api/v1/resources/:handle/content`
- share-link, configuration, and viewport routes documented by `/openapi.json`

Canvas creation returns a direct browser `url`, derived from
`AGENT_CANVAS_PUBLIC_BASE_URL`. MCP's `canvas_create` returns the same URL and
`canvas_get_url` recovers it for an existing canvas. This is not a share link:
it respects the service's normal network and access controls.

The installed frozen plugin registry generates runtime OpenAPI and both MCP transports. The committed [standard OpenAPI document](docs/openapi.standard.json) and [standard MCP catalog](docs/mcp-tools.standard.json) represent the three-extension default distribution. `npm run check:contracts` validates both artifacts, their examples, compatibility, generated [error-code registry](docs/error-codes.json), and freshness.

HTTP application failures use RFC 9457 `application/problem+json` with stable machine-readable `code`, `category`, `retryable`, and `requestId` fields. This replaces the pre-alpha.2 `{ok:false, code, message, ...}` body without a legacy fallback. MCP protocol errors remain JSON-RPC-native; application failures from a known tool set `isError: true` and return the same object at `structuredContent.problem`.

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

Core element tools use explicit operations such as `canvas_upsert_element`, `canvas_patch_element_frame`, and `canvas_replace_element_data`. Plugin tools are derived as `<normalized-plugin-id>__<local-name>`, for example `agentcanvas_image_overlays__add_bbox`. Macro tools are generic: `macro_list`, `macro_get`, `macro_create`, `macro_create_version`, `macro_archive`, `macro_plan`, and `canvas_run_macro`. See the [HTTP/MCP v0.2 mapping](docs/http-mcp-v0.2-mapping.md).

When upgrading an existing MCP client from v0.1, restart or reload that client's MCP server configuration after AgentCanvas restarts, then request a fresh `tools/list`. V0.1 feature aliases are removed; a cached tool catalog can continue showing names that the v0.2 server rejects.

Snapshots and plugin exports return compact opaque resource handles and metadata. Agent-facing JSON never contains full base64 strings or data URLs.

Provider-backed resource handles may outlive a replacement of the bytes behind a
stable source identity. Such registrations explicitly opt into mutable metadata:
the broker refreshes byte length, SHA-256, and dimensions after each load while
continuing to enforce the registered MIME type, byte limit, and content response
checks. Fixed registrations retain strict registration-time size and checksum
validation.

### Macros

A macro is a host-owned, declarative creation definition: typed input plus an
explicit anchor expands to canonical canvas elements. Definitions have immutable
integer versions. V1 supports creation only; it does not provide selection
authoring, linked instances, expressions, loops, conditionals, external calls,
or extension planners. Create definitions through `POST /api/v1/macros` or
`macro_create`; add an immutable version through the versions route or
`macro_create_version`, and archive through the PATCH route or `macro_archive`.
Installation definitions are available across canvases; canvas-scoped
definitions resolve only with their owning `canvasId`. Archived definitions
remain readable but cannot be planned or run.

The plan-first flow uses the exact macro version and returns preview elements,
an effect summary, named output keys, revision and input/plan digests, and a
short-lived plan ID. Planning is pure: it does not persist preview elements,
advance the canvas revision, call external services, or store raw inputs. A
plan is executed with the expected canvas revision and an idempotency key. The
host validates the plan again and commits its operations atomically as one
revision and one undo/redo history unit. Direct `canvas_run_macro` mode performs
the same internal planning and validation before committing; it does not bypass
those guarantees. A retry of one logical execution must reuse the same bounded
idempotency key; a new plan/execution gets a new key. Never generate a fresh
key for a retry. `/whoami` reports host and active capability status; it does
not report saved macros as dynamic tools.

Macro definitions are limited to 256 KiB and 100 generated elements; a canvas
may contain at most 2,000 elements after a run. The installed table element
contract additionally limits comparison-table data to 50 columns, 500 rows, and
2,000 characters per cell. Provenance contains exact version and digests plus
an explicitly safe summary where applicable, never raw invocation inputs.

The [standard comparison-table JSON example](docs/examples/standard-comparison-table.macro.json)
keeps headers, frame, style, and the `agentcanvas.table/table@1` dependency
fixed while binding only `rows` through a typed `$macroRef`. It is documentation
and proof input only; it is not seeded into the macro catalog or any new
installation.

The browser runner consumes the same exact-version plan used by HTTP and MCP. It
shows the effect summary and translucent ghost preview before a mutating
confirmation, then refreshes the canvas and supports the resulting undo/redo
history. Each successful browser run is one history unit and one canvas
revision. Use
`canvas_get` and `canvas_inspect` after the run when an agent needs persisted
state and diagnostics rather than relying on the rendered preview.

### Agent guidance

The repository bundles an operational skill at
[`skills/agentcanvas/SKILL.md`](skills/agentcanvas/SKILL.md). It is optional for
the runtime but recommended for agents: it covers runtime discovery, layout,
frame sizing, diagrams, images, and evidence-based reporting. See [Agent
readiness](docs/agent-readiness.md) for Hermes installation, eight broad
acceptance objectives, and the verification rubric.

For a first-time-user product tour, use the bundled
[`skills/agentcanvas-demonstration/SKILL.md`](skills/agentcanvas-demonstration/SKILL.md)
skill. It creates a guided showcase using the capabilities active in the
default installation and can include user-supplied or web-found images.

For Hermes, connect the resident MCP endpoint and install the published skill:

```bash
hermes mcp add agentcanvas --url http://127.0.0.1:23003/mcp
hermes mcp test agentcanvas
hermes skills install https://raw.githubusercontent.com/jackspooner/agentcanvas/main/skills/agentcanvas/SKILL.md --category software-development --yes
```

Start a new agent session after installing or updating the skill. Restart or
reconnect the MCP client after AgentCanvas tool schemas or active extensions
change so it does not continue using a cached catalog.

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

Set `AGENT_CANVAS_PLUGINS_ROOT` when multiple AgentCanvas runtimes share one
code installation but require separate active extensions and
`plugin.config.json` files. If omitted, AgentCanvas continues to use the
installation's `plugins/` directory.

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
npm run setup
npm run format:check
npm run lint
npm test
npm run test:e2e
npm run build
npm run plugins:verify
npm run check:openapi
npm run check:mcp-contract
npm run check:contracts
npm run check:docs
git diff --check
```

Architecture and behavioral ownership are detailed in [plugin architecture and migration](docs/plugin-architecture-and-migration.md), [architecture](docs/architecture.md), and [data contracts](docs/data-contracts.md).
