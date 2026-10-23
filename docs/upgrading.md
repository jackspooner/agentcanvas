# Upgrading AgentCanvas

This guide updates a source-checkout installation without assuming any process
manager. Commands run from the AgentCanvas repository root. If a supervisor is
used, substitute its normal stop and start operations where this guide says to
stop or start the process.

## 0.3.0-alpha.6 — permanent canvas deletion (physical schema 5)

This release adds HTTP DELETE and MCP `canvas_delete`. Existing databases
require an offline physical 4→5 migration; document schema stays at version 2.
The migration changes only the macro-version deletion guard: versions remain
immutable while their owning definition exists, and canvas deletion removes
its definitions and versions in one transaction with deferred foreign-key
checks. Installation macros and external media are preserved.

Stop AgentCanvas through its existing supervisor before applying the upgrade.
Build the updated checkout and run:

```powershell
npm run migrate -- inspect --database <database-path>
npm run migrate -- apply --database <database-path>
npm run migrate -- verify --database <database-path>
```

Apply creates and verifies a SQLite backup plus manifest, checks preserved data
and foreign keys, and records the migration in the ledger. Physical 2/3 and
v0.1 databases first follow their existing migration to 4, then advance to 5;
the CLI reports preceding migration receipts and retains every backup. Startup
refuses schema 4 until the offline upgrade is complete.

Restart using the same database, environment and extensions; verify /health,
/whoami, /openapi.json and MCP tools/list before deleting existing canvases.
For rollback, stop the host, restore the appropriate retained backup using the
existing migrate restore command, and run the matching prior checkout. Restoring
a backup also restores canvases deleted since that backup was taken.

## 0.3.0-alpha.5 — optional MediaTools bindings

Rebuild the packages and catalog, replace Gallery and Filesystem Images with
0.1.1 while stopped, then explicitly install MediaTools 0.1.0 if needed. Configure
its MCP endpoint, existing output directory and filesystem root ID; provision
`AGENT_CANVAS_MEDIATOOLS_TOKEN` privately and restart when idle. The standard
defaults do not enable it. No database or Gallery schema migration is required.
See [release notes](release-notes-v0.3.0-alpha.5.md) and
[setup](../plugin-packages/mediatools/README.md).

## Unreleased live viewer viewports

The browser now reports measured viewport geometry for visible direct, shared,
and embedded tabs. The read-only `canvas_list_viewers` MCP tool returns anonymous
sessions that expire after 30 seconds; existing saved user/agent viewports and
canvas revisions are unchanged. Rebuild the browser, restart AgentCanvas, and
refresh the MCP client's tool catalog. No database migration or new dependency
is required.

## Unreleased Markdown 0.3.0

Markdown 0.3.0 adds the `agentcanvas.markdown/carousel` element and its browser
combine/unpack commands. Existing Markdown documents remain schema version 1;
there is no database migration or new dependency. Rebuild the extension catalog,
replace the active `agentcanvas.markdown` distribution while AgentCanvas is
stopped, restart the host, and refresh browser/MCP plugin discovery. Downgrading
preserves carousel envelopes but an older Markdown extension cannot render them.

## 0.3.0-alpha.4

Host API 1.3.0 adds `PluginValidationError` for caller-visible input validation.
Primitives and Markdown 0.2.1 require `^1.3.0`; older extensions remain compatible.
Text and shape add tools now grow height to fit estimated content, including when
height was supplied explicitly. Use `allowClipping: true` when a hard height is
intentional, then read the persisted frame and check overlap diagnostics.
Generic element writes, frame patches, and existing documents are unchanged.
Markdown sizing is unchanged; undersizing returns a corrective 400 problem.

Rebuild packages/catalogs, disable and reinstall only the affected runtime
extensions from the catalog, then restart the host and refresh the MCP catalog.
The default materialization command skips already-installed versions; it does
not replace runtime bytes. No SQLite migration or package publication is needed.
See [release notes](release-notes-v0.3.0-alpha.4.md).

## 0.3.0-alpha.3

Rebuild packages and the extension catalog. The optional [Diagrams extension](../plugin-packages/diagrams/README.md)
requires host API 1.2 and Chromium visible to the service account for Mermaid
server rendering. Install it explicitly, restart AgentCanvas, and reload MCP
clients. The three standard extensions and database schema remain unchanged.
See [release notes](release-notes-v0.3.0-alpha.3.md).

### Compact MCP mutation receipts

Refresh cached MCP tool catalogs after restart. MCP canvas mutations no longer
return the full canvas document. They return `canvasId`, `revision`, and
`inspectionSummary`; `canvas_create` also returns `url`. Macro creation/version
writes return `macroId`, `currentVersion`, and `archived`, while
`canvas_run_macro` returns its canvas receipt, provenance, named outputs, and
affected IDs without operation history.

If any inspection count is nonzero, call `canvas_inspect` for the diagnostics.
Call `canvas_get` only when the full persisted document is needed. Browser-facing
HTTP response shapes and existing SDK full-document canvas methods are unchanged.
No database migration, new error code, dependency, or package release is involved.

### Lean MCP catalog and bounded reads

The default `/mcp` and stdio catalog is lean. It keeps core tools and the common
filesystem-image, primitive, Markdown, and table tools. Use
`canvas_get_extension_tool` plus `canvas_read_extension_tool` or
`canvas_mutate_extension_tool` for other active extension tools. Clients that
require every named tool can connect to `/mcp/full` or set
`AGENT_CANVAS_MCP_PROFILE=full` for stdio. Refresh cached tool catalogs after
switching profiles.

MCP canvas lists, element lists, inspection, plugin lists, macro plans, and
successful text receipts are now bounded. Use `canvas_get_element`, paginated
`canvas_list_elements`, filtered/paginated `canvas_inspect`, or the explicit
full `canvas_get` according to the data required. HTTP response contracts are unchanged.

If verification reports noncanonical persisted `createdBy` values, stop
AgentCanvas and run:

```bash
npm run migrate -- repair-created-by --database <path> --backup-dir <path>
```

The command creates and verifies a native SQLite backup and manifest, preserves
the original value in `metadata.legacyCreatedBy`, maps the creator to `system`,
and records the repair without changing schema versions. It aborts on conflicting
legacy metadata; a completed second run is a no-op and creates no backup.

## 0.3.0-alpha.2

Canvas list limits now enforce the documented integer range of 1 through 200.
HTTP callers that previously relied on clamping must send a value within that range;
empty or invalid values return `400` with `code: "validation_error"`. Omit `limit`
to retain the default of 50. MCP already enforces the same range.

Refresh cached MCP tool catalogs: canvas responses now accept canonical persisted
elements from missing extensions. This fixes reads and successful kernel mutations
being reported as failures after extension removal. Writable element schemas remain
restricted to installed extensions. No database migration is required.

This pre-1.0 release intentionally replaces every flat HTTP error body with RFC 9457 Problem Details and the `application/problem+json` content type. Update clients to read `detail` instead of `message`, `requestId` instead of `correlationId`, and branch on the stable `code`; remove assumptions about `ok:false` and `stage`. There is no legacy response mode.

MCP clients should keep handling protocol/JSON-RPC errors normally. For application failures returned by a dispatched tool, read `structuredContent.problem` when `isError` is true. Refresh generated clients from `docs/openapi.standard.json`, refresh cached MCP tool catalogs, and use `docs/error-codes.json` to audit code-specific behavior.

Core HTTP mutations now enforce their published schemas before persistence. Send valid JSON objects with the documented fields and types; share-link creation requires `{}` when no options are supplied. Previously accepted malformed bodies or unsupported fields now receive `400` Problem Details. Successful response shapes, routes, and MCP tool names are unchanged. No database migration is needed for these reliability fixes.

Browser consumers should retain `elementRuntime` and `diagnostics` from batch responses, and refresh the canvas projection after macros or metadata-only mutations. Resource expiration is independent of document revisions. A failed refresh after a successful mutation must not cause that mutation to be retried.

Unexpected HTTP failures are logged once as JSON on stderr with the response request ID and source locations. Exception messages and request values are excluded; use the request ID to correlate a failure with its boundary log.

## Before changing the checkout

1. Read the release notes between the installed and target versions.
2. Confirm the worktree is clean or intentionally preserve local changes.
3. Record the active extension set with `npm run plugins:list`.
4. Back up the configured SQLite database, extension configuration, and any
   deployment-owned environment or secret references.
5. Stop AgentCanvas before replacing extensions or applying a migration.

Do not pull over unexplained local changes, and do not assume a code rollback
can safely downgrade already-migrated element data.

## Update source and dependencies

For an installation that tracks the current branch:

```bash
git pull --ff-only
npm run setup
```

`npm run setup` installs the npm lockfile and full-commit Git dependencies.
It requires authenticated Git access to the configured private repositories;
plain `npm ci` uses the same native dependency declarations.

`git pull` updates source only. It does not update installed dependencies,
built browser assets, active extension distributions, the database, or the
running process.

## Build the host and extension catalog

```bash
npm run plugins:build
npm run build
npm run plugins:verify
```

`plugins:build` reconstructs `dist/plugin-catalog/`; it does not replace an
active distribution under `plugins/`. `plugins:materialize -- --defaults`
installs missing default extensions but deliberately refuses to replace a
different active version.

When release notes require an active extension update, keep AgentCanvas
stopped and use the documented lifecycle:

1. `npm run plugins:disable -- <plugin-id>`
2. `npm run plugins:install -- dist/plugin-catalog/<plugin-id>`
3. `npm run plugins:verify`

Repeat only for extensions that the release actually updates. Preserve the
disabled distribution until the new installation and its data compatibility
have been verified.

## Inspect and apply migrations

AgentCanvas never mutates an older production schema opportunistically. Inspect
the configured database using the active extension set:

```bash
npm run migrate -- inspect --database <path> --json
```

If the inspection or release notes require a migration, keep AgentCanvas
stopped and use a dedicated backup directory:

```bash
npm run migrate -- apply --database <path> --backup-dir <path> --plugins <plugins-path>
npm run migrate -- verify --database <path> --plugins <plugins-path>
```

Physical/document version 2/2 installations require the offline physical schema
4 migration before this release can start. Physical/document version 3/2
installations require the additive macro-storage step. The same `migrate apply`
command creates and verifies a native SQLite backup and sidecar manifest,
records preservation counts/fingerprints, adds the required host tables, and
keeps document version 2 unchanged. A v0.1 database uses the legacy-import path
and also targets physical/document 4/2.

Retain the verified backup and sidecar manifest until an explicit retention
decision. `migrate restore` verifies and accepts the backup produced by any
supported host migration. Restoring a v0.1, physical 2/2, or physical 3/2
backup returns the database to that source state, so the current host may again
require migration before startup. See [physical schema 4 migration](physical-schema-4-migration.md)
for the detailed backup, verification, and restore contract, and [v0.1 to v0.2
migration](v0.1-to-v0.2-migration.md) for legacy import semantics.

## Start and verify

Without a supervisor, start the built application from the repository root:

```bash
node --import tsx src/server.ts
```

With an optional supervisor, use its normal start or restart operation with the
same working directory and environment. Then verify:

```bash
curl http://127.0.0.1:23003/health
curl http://127.0.0.1:23003/whoami
curl http://127.0.0.1:23003/api/v1/plugins
curl http://127.0.0.1:23003/openapi.json
```

Also open the index and a representative canvas, confirm the root references a
built `/assets/...` bundle, and inspect process and browser logs for errors.

If an MCP client uses the stdio bridge, restart or reconnect that bridge after
the AgentCanvas process restarts and request a fresh `tools/list`. Do not trust
a tool catalog cached from the previous host or extension set.

## Literal macro invocation input

Macro references are evaluated in saved template payloads. Values read from invocation input are inserted as literal JSON.
Callers that previously put reference expressions inside invocation input must move those expressions into the saved template. This change requires no database migration.
