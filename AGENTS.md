# AgentCanvas Agent Guide

## Worktree setup

Run `npm run setup:worktree` in a fresh linked worktree with the installed shared
DevTasks CLI, Node.js 24+, npm 11+, Git and access to pinned repositories. The
[adapter](.cutlery/devtask.json) preserves the native no-argument setup: pinned
materialization/verification, locked workspace installation and dependency imports.
Preparation evidence is checkout-local under ignored `.cutlery/devtask/`; units
reuse only matching inputs/tool versions/prerequisites with readiness checks.
`npm run setup:worktree -- --legacy` invokes the original `npm run setup` rollback.
The committed `.npmrc` sets `install-links=true`: npm copies local pinned packages
instead of adding nested install state to InternalDeps snapshots. Lock normalization
preserves all original registry versions/integrities and internal commit pins.

Linux requires the installed InternalDeps compatibility mapping through
`WORKSPACE2_LINUX_ROOT`; `WORKSPACE2_INTERNAL_DEPS_CLI` can select its absolute CLI.
Keep `WORKSPACE2_LINUX_YTDLP_COMMIT` fixed when configured, consistently with the
DevTasks host owner. Compatible runtime version differences are checked by builds.
Setup starts no service/database and never advances pins.

Verification retains the README suite: format/lint, package/application/external
plugin tests, isolated Playwright fixtures, web and plugin builds, plugin validation,
OpenAPI/MCP/shared contracts, docs and dependency failure-handling checks. The docs
scope prepares builds needed by contracts; it defers indexing. Packages build before
plugins, then the distribution catalog; the external fixture resolves public workspace
packages and retains its check/test/pack/verification sequence. Browser tests need the
matching Playwright Chromium installation and ports 23173–23175; they use temporary
state, never production databases. Run `npm run test:setup` separately for the network
installation proof. Before graph use, ensure this exact checkout with
`embeddings:false` and read the repository-local GitNexus workflow skill.

## Plugin architecture

- The public product term is extension. Keep `plugin`, `plugins/`, and
  `agentcanvas.plugin/v1` where they are compatibility/runtime identifiers;
  new public authoring surfaces should use extension terminology.
- `@agentcanvas/editor` is the only package allowed to import React Flow.
  Document, HTTP, MCP, root web, and extension APIs must stay on canonical
  AgentCanvas contracts.
- Core toolbar, keyboard, menu, and extension actions must use the shared
  editor command service.
- Runtime activation is determined only by non-hidden immediate child folders under `plugins/`. Do not add `agentcanvas.config.mjs`, an enabled-plugin list, recursive discovery, remote loading, or hot reload.
- First-party source belongs in `plugin-packages/`; built distributions belong in `dist/plugin-catalog/`; `plugins/` is generated active runtime state.
- Normal element behavior must use `@agentcanvas/plugin-sdk`. Do not add element type switches to kernel validation, HTTP, MCP, browser, or snapshot code.
- HTTP, OpenAPI, browser delivery, snapshots, and resident MCP must consume one frozen registry. Stdio MCP remains a bridge to the resident `/mcp` endpoint.
- Plugins are trusted executable dependencies. Manifest permissions gate supported host services but are not a security sandbox.
- Missing optional plugins must preserve canonical envelopes. They may not silently normalize, delete, or downgrade stored data.
- Plugin activation changes require a restart. Invalid visible plugin folders fail startup explicitly.

## Optional media capabilities

AgentCanvas core has no required media extension or process-manager dependency.
The optional public Docker Compose and Windows Service Control Manager helpers
live under `compose.yaml` and `deploy/`; they are deployment conveniences, not
kernel contracts.

- The host owns `agentcanvas.image-sources@1.0.0`, a registry for provider-neutral image references and opaque image resources.
- Image-source extensions register independent providers in that registry.
- `agentcanvas.gallery` consumes the registry and must not import or encode either provider's private implementation.
- AgentCanvas SQLite owns documents, layout, revisions, viewports, share links, and stable provider reference envelopes. Source extensions own media identity and bytes.
- Missing optional media extensions preserve canonical elements and return explicit diagnostics. Do not add implicit provider fallbacks to the kernel.

## Contracts and migrations

- Keep manifest, SDK, HTTP, MCP, OpenAPI, browser, snapshot, and migration docs synchronized with public behavior.
- `/openapi.json` is authoritative for the active registry. `docs/openapi.standard.json` is the generated four-default-plugin contract and must pass `npm run check:openapi`.
- v0.1 databases are migrated only by the offline CLI with a verified SQLite backup. Startup must not mutate old schemas opportunistically.
- The removed `group` type is a migration blocker. Never silently delete or preserve it as an undocumented placeholder.
- Installed-plugin element schema changes require contiguous forward-only pure migrations, a readiness failure while pending, and a migration ledger entry when applied.
- Never return agent-facing base64/data URLs; use opaque resource handles.

## Repository-owned shared skills

Author service skills in root `skills/<name>/` with their scripts/references/assets. General/imported sources belong in the shared skills repository. Use `skills show <name>` to locate ownership and edit the source; `.agents/skills` and `.claude/skills` are generated per-machine discovery links. Do not commit absolute discovery links or edit plugin caches. Register stable folders through `skills register <folder>` (use `--repo <checkout>` for development-only packages), preserve existing exclusions/disabled archives, and run `skills doctor` plus this owner's skill checks. Integrate task-worktree edits into the stable source before expecting global refresh. Consult the global `shared-agent-skills` skill for setup, Hermes promotion, operations and rollback.
