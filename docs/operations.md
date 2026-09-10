# Operations

This guide covers service and extension lifecycle for an installed AgentCanvas
host.

## Runtime layout

```text
plugin-packages/       first-party source workspaces
dist/plugin-catalog/   built, installable first-party distributions
plugins/               active runtime distributions
plugins-disabled/      timestamped disabled distributions retained for rollback
data/                   SQLite database, migration backups, and service logs
```

Only immediate non-hidden directories under `plugins/` are discovered. Discovery is non-recursive. `node_modules`, hidden staging directories, symlink roots, and directories elsewhere are not active plugins.

## Process lifecycle

AgentCanvas has no required process manager. After dependencies and the browser
bundle are built, the process-manager-neutral runtime command is:

```bash
node --import tsx src/server.ts
```

For packaged long-running setups, see [Deployment helpers](deployment.md) for
the Docker Compose and Windows Service Control Manager paths.

Run it from the repository root. An optional supervisor owns process startup,
shutdown, environment injection, logging, and restart policy; those mechanisms
are not part of the AgentCanvas runtime contract. Whatever launches the
process must preserve the configured database and extension directories and
must support a clean stop before extension replacement, disable, restore, or
offline migration.

Use [Upgrading](upgrading.md) for the complete source-update sequence. Do not
treat a source pull by itself as a deployed update: dependencies, built browser
assets, extension distributions, migration state, and the running process must
also be reconciled.

## Build and inspect the catalog

```bash
npm run plugins:build
npm run plugins:list
npm run plugins:verify
```

- `plugins:build` builds every workspace plugin and reconstructs `dist/plugin-catalog/`.
- `plugins:list` lists active runtime plugins.
- `plugins:verify` validates and dependency-orders both the active runtime and catalog sets.

## Materialize a fresh default runtime

```bash
npm run plugins:materialize -- --defaults
```

This installs missing default plugins without replacing an existing version. If an active version differs from the catalog version, disable it first.

## Install a plugin

1. Review the distribution as trusted executable code.
2. Stop AgentCanvas.
3. Verify that the distribution root contains `agentcanvas.plugin.json` and its declared prebuilt entrypoints.
4. Install it:

```bash
npm run plugins:install -- C:/path/to/plugin-distribution
```

5. Run `npm run plugins:verify`.
6. Start AgentCanvas.
7. Check `/health`, `/whoami`, `/api/v1/plugins/<plugin-id>`, `/openapi.json`, MCP tools, and a representative browser/snapshot render.

Installation validates the source, copies it into a hidden staging directory, validates the staged copy, and atomically renames it into `plugins/<plugin-id>`. Installation refuses to replace an existing folder.

## Disable a plugin

Stop AgentCanvas, then run:

```bash
npm run plugins:disable -- <plugin-id>
```

The command moves the runtime folder to a timestamped directory under `plugins-disabled/`. It probes `/whoami` and refuses when the configured AgentCanvas service is running.

Removing an optional plugin does not delete its stored elements. Reads preserve canonical envelopes and add diagnostics. Generic frame and metadata changes, deletion, and clear remain available; data/style replacement and new writes for that type fail with `plugin_unavailable`.

`agentcanvas.assets2` and `agentcanvas.filesystem-images` are independent optional image sources registered with the host image-source registry. `agentcanvas.gallery` can use either provider. Disable extensions only while AgentCanvas is stopped; stored image and gallery nodes remain intact and show missing-provider or missing-extension diagnostics until their owner is reinstalled.

## Least-privilege deployment

Plugins are trusted executable dependencies: server entries execute in the AgentCanvas Node.js process and browser entries execute as same-origin JavaScript. Manifest permissions and Shadow DOM define supported integration points; they are not a security sandbox.

- Run AgentCanvas as a dedicated non-administrator operating-system account, never as `root`, an administrator, or `LocalSystem`.
- Grant read access to the application, active plugin, and built asset directories.
- Grant write access only to the configured database/data directory and the deployment's explicit log directory.
- Limit outbound network access to provider endpoints explicitly required by installed extensions, such as an optional configured Assets-2 service.
- Review source, manifest permissions, packaged files, and dependency licenses before installing a plugin.
- Stop the service for plugin installation, replacement, or disable, and restart it so the frozen registry is rebuilt.

The service account's filesystem, process, and network permissions are the effective containment boundary for trusted plugin code.

## Replace or roll back a plugin

There is no in-place replacement command.

1. Stop AgentCanvas.
2. Disable the current plugin.
3. Install the new distribution.
4. Verify plugins.
5. Run offline plugin schema migrations if startup reports them as pending.
6. Start and smoke-test.

To roll back code, stop the service, disable the replacement, and install the retained compatible distribution from `plugins-disabled/`. Do not downgrade element data. If stored elements are newer than the old plugin schema, the old plugin will fail readiness rather than normalize them downward.

## Restart requirement

Plugin discovery and activation happen once, before the registry is frozen. Adding, removing, or changing a plugin requires a service restart. Hot reload and browser upload are not supported.

## Health and identity

Check:

```bash
curl http://127.0.0.1:23003/health
curl http://127.0.0.1:23003/whoami
curl http://127.0.0.1:23003/api/v1/plugins
```

`/health` reports core host readiness. `/whoami` safely reports host version, plugin API version, active IDs, the lean `/mcp` endpoint, the `/mcp/full` endpoint, and the default profile. When the optional Assets-2 extension is active, both routes include its provider status under `dependencies.assets`; provider failure is visible but does not make core unhealthy.

## Database operations

AgentCanvas never opportunistically changes an older production schema during startup. Use the offline CLI for host or installed-plugin migrations:

```bash
npm run migrate -- inspect --database <path> --json
npm run migrate -- apply --database <path> --backup-dir <path> --plugins <plugins-path>
npm run migrate -- repair-created-by --database <path> --backup-dir <path>
npm run migrate -- verify --database <path> --plugins <plugins-path>
npm run migrate -- restore --database <path> --backup <backup-path>
```

These commands run from the repository checkout. After `npm ci`, `npm exec -- agentcanvas migrate <command> ...` is equivalent. The service must be stopped for apply and restore. Empty databases initialize at physical/document version 4/2. v0.1, physical/document 2/2, and physical/document 3/2 databases require an offline migration; all supported paths preserve document version 2 and target physical schema 4. Restore verifies and accepts the manifest-backed backup from any supported path. Keep the backup and sidecar manifest until an explicit retention decision. See [Upgrading](upgrading.md), [physical schema 4 migration](physical-schema-4-migration.md), and [v0.1 to v0.2 migration](v0.1-to-v0.2-migration.md).

## Operational acceptance

After a host or plugin change, verify:

- The process or service manager reports AgentCanvas running under the intended least-privilege account.
- `/health`, `/whoami`, and runtime OpenAPI succeed.
- The active plugin list is exact.
- HTTP and stdio MCP expose identical names and schemas.
- The root and canvas routes serve the built `/assets/...` bundle.
- Representative plugin elements render in the production browser.
- Snapshots return opaque resource metadata and the content route serves the declared MIME type.
- Service stderr and application logs contain no startup or runtime errors.

Use [Troubleshooting](troubleshooting.md) for failure-specific guidance.
