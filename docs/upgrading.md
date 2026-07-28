# Upgrading AgentCanvas

This guide updates a source-checkout installation without assuming any process
manager. Commands run from the AgentCanvas repository root. If a supervisor is
used, substitute its normal stop and start operations where this guide says to
stop or start the process.

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
npm ci
```

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
