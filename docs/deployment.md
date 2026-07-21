# Deployment helpers

AgentCanvas can run directly from a checkout. These optional helpers provide
repeatable long-running service setups without requiring a particular private
process manager.

## Linux with Docker Compose

Prerequisites:

- Docker Engine with the Compose plugin (`docker compose`).

From the repository root:

```bash
docker compose up -d --build
docker compose ps
curl http://127.0.0.1:23003/health
```

The supplied `compose.yaml` builds the application, materializes the three
default extensions, runs as the unprivileged `node` user, and stores the SQLite
database in the named `agentcanvas-data` volume. Follow logs with:

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

The Windows helper uses the built-in Service Control Manager and compiles a
small local service host from `deploy/windows/AgentCanvasServiceHost.cs`; it
does not require Servy, NSSM, or another downloaded service wrapper.

Prerequisites:

- Windows PowerShell running as Administrator.
- Node.js 24 or newer on `PATH`.
- A built checkout with dependencies, plugins, and browser assets prepared:

```powershell
npm ci
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
