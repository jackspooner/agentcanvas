# AgentCanvas Public Release Checklist

AgentCanvas should be public as an agent-operable browser canvas and MCP surface for durable asset refs, text, Markdown, connectors, tables, overlays, and GLB viewers.

## Must fix before public release

- [x] Add a root `.env.example` covering server, public URL, database, and Assets-2 settings.
- [x] Add dotenv loading to the server/MCP entrypoints or document process-manager-only environment injection.
- [x] Move internal AgentCanvas packages into npm workspaces so a fresh clone does not require local Workspace2 package paths.
- [x] Keep this as a public GitHub clone-and-run app, not an npm package; retain `"private": true` and document that policy.
- [x] Add root `LICENSE`.
- [x] Replace `"latest"` dependency ranges with pinned semver ranges.
- [x] Add static OpenAPI generation/checking, or document that `/openapi.json` is runtime-only.
- [x] Ensure `data/`, sqlite files, logs, screenshots, browser artifacts, and generated exports are ignored and not tracked.
- [x] Confirm share links, screenshots, asset refs, and Markdown rendering do not expose raw private data or unsafe HTML.

## Environment contract

- [x] Core: `AGENT_CANVAS_HOST`, `AGENT_CANVAS_PORT`, `AGENT_CANVAS_PUBLIC_BASE_URL`.
- [x] MCP client: `AGENT_CANVAS_BASE_URL`.
- [x] Persistence: `AGENT_CANVAS_DB`.
- [x] Durable assets: `ASSETS_BASE_URL`.

## Documentation gates

- [x] README has install, build, run, health/whoami, canvas chooser, share links, and MCP registration examples.
- [x] README explains that canvas assets are `Assets-2` refs, not local paths, file URLs, arbitrary HTTP URLs, or inline binary.
- [x] Browser docs explain root route, canvas route, share route, read-only share links, viewport behavior, and polling.
- [x] Markdown docs explain the safe rendering policy.
- [x] GLB viewer docs explain model-viewer dependency, asset-ref resolution, and browser support expectations.
- [x] API docs cover HTTP routes and MCP tools with stable operation/tool names.

## Verification

- [x] `npm ci`
- [x] `npm test`
- [x] `npm run build`
- [x] `git diff --check`
- [x] Smoke `GET /health`, `GET /whoami`, `/openapi.json`, canvas create/list/get, share link render, MCP tool list, and a browser visual check.
