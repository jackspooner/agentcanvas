# AgentCanvas documentation

## Current v0.3 work

The [v0.3 specification set](specs/README.md) defines the polished editor,
public extension SDK, delivery waves, and required acceptance evidence. The
current main branch contains the editor foundation, shared command/history
layer, command contributions, extension authoring facade, testkit, and
extension-named scaffolder.

AgentCanvas is a local-first visual workspace whose element behavior is
supplied by automatically discovered, trusted extensions. The installed
distribution format remains `agentcanvas.plugin/v1` for compatibility.

The public distribution is the GitHub source repository. The root package remains marked private to prevent accidental npm publication. The SDK, testkit, and scaffolder are separate publication-ready packages, but their npm commands must not be treated as available until those packages are explicitly released. Media sources are optional extensions; start with [Getting started](getting-started.md) for the standalone setup and image-source choices.

## Choose your path

| I want to… | Start here |
|---|---|
| Install or run AgentCanvas | [Getting started](getting-started.md) |
| Upgrade an existing installation | [Upgrading](upgrading.md) |
| Operate the service or manage extensions | [Operations](operations.md) |
| Use the HTTP API or MCP tools | [HTTP and MCP](http-and-mcp.md) |
| Understand the system | [Architecture](architecture.md) |
| Understand how extensions load | [How extensions load](plugins.md) |
| Understand persisted data | [Data contracts](data-contracts.md) |
| Create or apply a canvas theme | [Canvas themes](canvas-themes.md) |
| Create an extension | [Extension authoring](plugin-authoring/README.md) |
| Follow a complete extension example | [Build your first extension](plugin-authoring/tutorial.md) |
| Diagnose a failure | [Troubleshooting](troubleshooting.md) |
| Migrate a v0.1 database | [v0.1 to v0.2 migration](v0.1-to-v0.2-migration.md) |

## Extension documentation

Use the authoring guides in this order:

1. [How extensions load](plugins.md)
2. [Extension authoring overview](plugin-authoring/README.md)
3. [Build your first extension](plugin-authoring/tutorial.md)
4. [Manifest v1](plugin-authoring/manifest-v1.md)
5. [Server SDK](plugin-authoring/server-sdk.md)
6. [Browser and snapshot ABI](plugin-authoring/browser-and-snapshot.md)
7. [Configuration and secrets](plugin-authoring/configuration.md)
8. [Versioning and migrations](plugin-authoring/versioning-and-migrations.md)
9. [Testing and distribution](plugin-authoring/testing-and-distribution.md)

The concise reference pages retain plugin API v1 filenames for stable links:
[manifest reference](plugin-manifest-reference.md), [public API
reference](plugin-api-reference.md), [capabilities and
permissions](plugin-capabilities-and-permissions.md), [browser
runtime](plugin-browser-runtime.md), and [snapshot
runtime](plugin-snapshot-runtime.md).

## Operator and API documentation

- [Getting started](getting-started.md): prerequisites, installation, default plugins, first start, and verification.
- [Upgrading](upgrading.md): process-manager-neutral source updates, builds, extension replacement, migrations, restart, and verification.
- [Operations](operations.md): source/catalog/runtime layout, install/disable/replace procedures, service lifecycle, backups, and health checks.
- [HTTP and MCP](http-and-mcp.md): current routes, discovery, mutation operations, MCP transports, and contract ownership.
- [Troubleshooting](troubleshooting.md): startup, plugin, browser, Assets-2, database, and MCP failure guides.
- [Standard OpenAPI](openapi.standard.json): generated contract for the three default extensions.

Runtime `GET /openapi.json` is authoritative for the exact active plugin set. The committed standard OpenAPI is generated from the default distribution and checked with `npm run check:openapi`.

## Architecture and reference

- [Architecture](architecture.md)
- [Plugin architecture and migration](plugin-architecture-and-migration.md)
- [Data contracts](data-contracts.md)
- [Canvas themes](canvas-themes.md)
- [Functionality and first-party plugin inventory](plugin-functionality-inventory.md)
- [HTTP/MCP v0.1 to v0.2 mapping](http-mcp-v0.2-mapping.md)

## History

- [v0.2.0 release notes](release-notes-v0.2.0.md)
- [v0.3.0 alpha implementation notes](release-notes-v0.3.0-alpha.1.md)
- [Completed v0.2 refactor plan](plugin-refactor-implementation-plan.md)
- [Reference migration status](v0.1-to-v0.2-migration.md#reference-cutover-status)

Historical documents explain why the current design exists. They are not the primary operating or authoring instructions.

## Documentation contract

The documentation follows these sources of truth:

| Subject | Canonical owner |
|---|---|
| Active plugins | Immediate non-hidden folders under `plugins/` |
| Manifest structure | `packages/plugin-sdk/src/manifest.ts` and `src/plugin-runtime/manifest.ts` |
| Public plugin API | `packages/plugin-sdk/src/` |
| Public extension facade | `packages/extension-sdk/src/` |
| Polished editor adapter | `packages/editor/src/` |
| Element validation | Active registry plus `src/plugin-runtime/elements.ts` |
| HTTP | Runtime registry and `src/api-v2/` |
| MCP | `src/mcp-v2/` plus active plugin tool descriptors |
| Standard API artifact | `docs/openapi.standard.json` |
| Database and migration | `src/store/` and `src/migrations/` |

When behavior changes, update the owning runtime contract, generated OpenAPI, relevant guide/reference page, examples, README, and tests together. Run `npm run check:docs` and `npm run check:openapi` before handing off a documentation or contract change.
