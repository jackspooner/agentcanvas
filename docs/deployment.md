# Deployment helpers

AgentCanvas can run directly from a checkout. These optional helpers provide
repeatable long-running service setups without requiring a particular private
process manager.

## Existing Linux systemd deployment

Inspect `systemctl --user cat agentcanvas.service` for the canonical checkout,
Node executable and private environment file. Prepare the tested, published
commit using that Node version and existing Git credentials. Before stopping
the service, check active MediaTools bindings and connected authoring clients;
wait for active work to finish. Preserve the SQLite database, active extension
configuration and private environment file. With writers stopped, use SQLite's
backup operation and verify the backup with `PRAGMA integrity_check`.

From the service-defined checkout, after those checks and backups:

```sh
systemctl --user stop agentcanvas.service
git merge --ff-only TESTED_COMMIT
npm run setup:worktree
npm run plugins:build
npm run build
```

Stop on a failed setup or build. For each changed active extension, preserve its
`plugin.config.json`, then replace its distribution through the offline CLI:

```sh
npm run plugins:disable -- agentcanvas.mediatools
npm run plugins:install -- dist/plugin-catalog/agentcanvas.mediatools
```

The disable command returns the preserved directory under `plugins-disabled/`.
Restore its deployment-specific configuration into the new active directory,
then verify the active extensions with `npm run plugins:verify`.
`plugins:materialize -- --defaults` does not refresh an installed extension at
the same version. Keep unrelated active extensions and their configuration.

```sh
systemctl --user start agentcanvas.service
curl --fail http://127.0.0.1:23003/health
curl --fail http://127.0.0.1:23003/whoami
```

Verify the active extension catalog and retained canvases after startup. Record
the deployed commit and any protected local modifications. Recovery uses the
previous tested source and preserved extension distributions with the service
stopped; retain current durable state rather than restoring an older database
over subsequent user work.

## Linux with Docker Compose

Prerequisites:

- Docker Engine with the Compose plugin (`docker compose`).
- Build-time network access to GitHub, npm, and Debian package repositories.
- `GITHUB_TOKEN` in the invoking environment, with read access to the pinned private package repositories. Compose passes it only as a BuildKit build secret; it is not copied into the image or runtime environment. Do not put it in a committed file.

From the repository root:

```bash
docker compose up -d --build
docker compose ps
curl http://127.0.0.1:23003/health
```

The supplied `compose.yaml` builds the application, materializes the three
default extensions, runs as the unprivileged `node` user, and stores the SQLite
database in the named `agentcanvas-data` volume. The build prepares pinned
Git dependencies with `npm run setup`; the runtime image retains the installed
`node_modules` packages. Git is installed only in
the build stage. Follow logs with:

```bash
docker compose logs -f agentcanvas
```

Stop the service without removing its data:

```bash
docker compose down
```

Do not use `docker compose down --volumes` unless deleting the AgentCanvas
database is intentional. The default port binding is loopback-only. If you
change it to a network-facing binding, also configure an authenticated,
TLS-terminating reverse proxy and update the allowed host/origin environment
variables; AgentCanvas has no user-account authentication.

Set `AGENT_CANVAS_PORT` in a `.env` file next to `compose.yaml` to use a
different host and container port. Set `AGENT_CANVAS_PUBLIC_BASE_URL`,
`AGENT_CANVAS_ALLOWED_HOSTS`, and `AGENT_CANVAS_ALLOWED_ORIGINS` explicitly
when the service is reached through a different hostname or proxy.

The image contains the built optional plugin catalog, but only the three
default extensions are active. Treat optional plugin installation and any host
filesystem mounts as deployment-specific changes. A host directory is not
available inside the container unless it is explicitly mounted, and a
filesystem-image root must use the container path plus read permission for the
container service account.

## Windows service

### Simple background launcher

For an agent or a local user who wants AgentCanvas running in the background
without installing a Windows service, prepare the checkout once:

```powershell
npm run setup
npm run plugins:build
npm run plugins:materialize -- --defaults
npm run build
```

Then start it from the repository root:

```powershell
npm run start:background
```

The bundled `scripts\agentcanvas-background.ps1` also supports `Status`,
`Stop`, and `Restart`. It records the PID and redirects stdout/stderr to the
ignored `tmp\` directory, verifies the process command line before stopping a
PID, and waits for `/health` after startup. Pass `-HealthUrl` when the service
uses a non-default public base URL. This launcher is tied to the current user
session; use the Windows service helper below for machine-start and
least-privilege service behavior.

The Windows helper uses the built-in Service Control Manager and compiles a
small local service host from `deploy/windows/AgentCanvasServiceHost.cs`; it
does not require Servy, NSSM, or another downloaded service wrapper.

Prerequisites:

- Windows PowerShell running as Administrator.
- Node.js 24 or newer on `PATH`.
- A built checkout with dependencies, plugins, and browser assets prepared:

```powershell
npm run setup
npm run plugins:build
npm run plugins:materialize -- --defaults
npm run build
```

Install and start the service from the repository root:

```powershell
.\deploy\windows\manage-service.ps1 -Action Install
```

The service runs under the least-privilege `LocalService` account, listens on
the normal loopback defaults, writes the database and logs under
`C:\ProgramData\AgentCanvas`, and loads the repository `.env` from the
checkout working directory. The account must be able to read the checkout,
active plugin folders, and any configured filesystem-image roots. Prefer a
machine-wide installation directory such as `C:\Program Files\AgentCanvas`
or grant the `LocalService` account read access explicitly.

Manage the service with the same helper:

```powershell
.\deploy\windows\manage-service.ps1 -Action Status
.\deploy\windows\manage-service.ps1 -Action Stop
.\deploy\windows\manage-service.ps1 -Action Start
.\deploy\windows\manage-service.ps1 -Action Restart
.\deploy\windows\manage-service.ps1 -Action Uninstall
```

Uninstalling removes the service and generated host executable but preserves
the database and logs. Stop the service before replacing plugins, rebuilding,
or applying an offline migration, then start it again and verify `/health`,
`/whoami`, the active plugin catalog, and MCP tools.

## Source updates

Both helpers are supervisor-neutral deployment conveniences, not part of the
AgentCanvas API. For an update, stop the running deployment, pull or copy the
new source, run the documented dependency/build/plugin steps, and restart the
deployment. Do not expose a direct network binding without authentication and
TLS.
