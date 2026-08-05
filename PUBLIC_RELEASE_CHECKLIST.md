# AgentCanvas Public Release Checklist

AgentCanvas should be public as an agent-operable browser canvas and MCP surface for durable asset refs, text, Markdown, connectors, tables, overlays, and GLB viewers.

## Must fix before public release

- [x] Add a root `.env.example` covering server, public URL, database, and Assets-2 settings.
- [x] Add dotenv loading to the server/MCP entrypoints or document process-manager-only environment injection.
- [x] Move internal AgentCanvas packages into npm workspaces so a fresh clone does not require external workspace package paths.
- [x] Keep this as a public GitHub clone-and-run app, not an npm package; retain `"private": true` and document that policy.
- [x] Add root `LICENSE`.
- [x] Replace `"latest"` dependency ranges with pinned semver ranges.
- [x] Generate `docs/openapi.standard.json` and enforce freshness with `npm run check:openapi`.
- [x] Ensure `data/`, sqlite files, logs, screenshots, browser artifacts, and generated exports are ignored and not tracked.
- [x] Confirm share links, screenshots, asset refs, and Markdown rendering do not expose raw private data or unsafe HTML.
- [x] Publish as a GitHub clone-and-run source application; keep the root package private and describe the SDK, testkit, and scaffolder as unavailable from npm until their separate release.
- [x] Keep deployment-specific migration IDs, database counts, backup names, hashes, and retention records out of public operator and release documentation.
- [x] Keep Workspace2/Servy deployment templates and lifecycle scripts out of the public source tree; the release check rejects tracked `service/` artifacts.

## Environment contract

- [x] Core: `AGENT_CANVAS_HOST`, `AGENT_CANVAS_PORT`, `AGENT_CANVAS_PUBLIC_BASE_URL`.
- [x] MCP client: `AGENT_CANVAS_BASE_URL`.
- [x] Persistence: `AGENT_CANVAS_DB`.
- [x] Optional Assets-2 image source: `ASSETS_BASE_URL` and bounded fetch settings are owned by `agentcanvas.assets2` when installed.
- [x] AgentCanvas core starts without a media provider; optional provider failure is reported without making core unhealthy.
- [x] Document Assets-2 and allowlisted filesystem images as independent optional image-source extensions.

## Documentation gates

- [x] README has install, build, run, health/whoami, canvas chooser, share links, and MCP registration examples.
- [x] README explains provider-neutral image references, the optional Assets-2 provider, and allowlisted filesystem references; image-source references still reject arbitrary absolute paths, file URLs, arbitrary HTTP URLs, and inline binary, while sanitized Markdown may render HTTP(S) image URLs by explicit per-document policy.
- [x] Browser docs explain root route, canvas route, share route, read-only share links, viewport behavior, and polling.
- [x] Markdown docs explain the safe rendering policy.
- [x] GLB viewer docs explain model-viewer dependency, asset-ref resolution, and browser support expectations.
- [x] API docs cover HTTP routes and MCP tools with stable operation/tool names.
- [x] Plugin author docs cover trust, folder discovery, manifest/SDK ABI, packaging, and restart behavior.
- [x] Operator docs require a dedicated least-privilege service account and explain that OS permissions are the effective boundary for trusted plugin code.
- [x] Public deployment helpers cover Docker Compose and a built-in Windows Service Control Manager host without private Workspace2/Servy artifacts.
- [x] Migration examples use repository-local `npm run migrate -- ...` or `npm exec -- agentcanvas ...` commands that work after `npm ci` without a global install.
- [x] MCP upgrade docs require client/stdio restart or reload plus a fresh `tools/list` after v0.1 aliases are removed.
- [x] Documentation has an audience-based home, getting-started, operations, troubleshooting, current HTTP/MCP, and complete plugin tutorial/testing/versioning/configuration paths.
- [x] `npm run check:docs` validates required pages, internal links/anchors, package README links, and stale live-cutover status text.
- [x] Current database docs consistently identify physical schema 4 / document schema 2 and the offline migrations from 2/2 and 3/2.
- [x] Manifest-verified restore covers both v0.1 backups and physical/document 2/2 theme-migration backups.

## Verification

- [x] `npm ci`
- [x] `npm test`
- [x] `npm run build`
- [x] `npm run plugins:verify`
- [x] `npm run check:openapi`
- [x] `npm run check:docs`
- [x] `npm run check:extension-packages`
- [x] `git diff --check`
- [x] Smoke `GET /health`, `GET /whoami`, `/openapi.json`, canvas create/list/get, share link render, MCP tool list, and a browser visual check.
- [x] Verify AgentCanvas starts without Assets-2 and reports an installed provider's readiness without coupling it to core health.
- [x] CI dry-runs and independently installs the extension-named SDK, testkit, and scaffolder tarballs before exercising a generated extension.
