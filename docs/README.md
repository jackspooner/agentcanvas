# AgentCanvas documentation

This is the documentation home for AgentCanvas v0.2. AgentCanvas is a local-first canvas service whose element behavior is supplied by automatically discovered, trusted plugins.

The public distribution is the GitHub source repository. The root application remains private to prevent accidental npm publication. The SDK, testkit, and scaffolder are separate publication-ready packages, but their npm commands must not be treated as available until those packages are explicitly released. AgentCanvas also requires the separately cloned and simultaneously running [Assets-2 service](https://github.com/jackspooner/Assets-2); start with [Getting started](getting-started.md) for the complete two-service setup.

## Choose your path

| I want to… | Start here |
|---|---|
| Install or run AgentCanvas | [Getting started](getting-started.md) |
| Operate the service or manage plugins | [Operations](operations.md) |
| Use the HTTP API or MCP tools | [HTTP and MCP](http-and-mcp.md) |
| Understand the system | [Architecture](architecture.md) |
| Understand how plugins work | [How plugins work](plugins.md) |
| Understand persisted data | [Data contracts](data-contracts.md) |
| Create a plugin | [Plugin authoring](plugin-authoring/README.md) |
| Follow a complete plugin example | [Build your first plugin](plugin-authoring/tutorial.md) |
| Diagnose a failure | [Troubleshooting](troubleshooting.md) |
| Migrate a v0.1 database | [v0.1 to v0.2 migration](v0.1-to-v0.2-migration.md) |

## Plugin documentation

Use the authoring guides in this order:

1. [How plugins work](plugins.md)
2. [Plugin authoring overview](plugin-authoring/README.md)
3. [Build your first plugin](plugin-authoring/tutorial.md)
4. [Manifest v1](plugin-authoring/manifest-v1.md)
5. [Server SDK](plugin-authoring/server-sdk.md)
6. [Browser and snapshot ABI](plugin-authoring/browser-and-snapshot.md)
7. [Configuration and secrets](plugin-authoring/configuration.md)
8. [Versioning and migrations](plugin-authoring/versioning-and-migrations.md)
9. [Testing and distribution](plugin-authoring/testing-and-distribution.md)

The concise reference pages are [manifest reference](plugin-manifest-reference.md), [plugin API reference](plugin-api-reference.md), [capabilities and permissions](plugin-capabilities-and-permissions.md), [browser runtime](plugin-browser-runtime.md), and [snapshot runtime](plugin-snapshot-runtime.md).

## Operator and API documentation

- [Getting started](getting-started.md): prerequisites, installation, default plugins, first start, and verification.
- [Operations](operations.md): source/catalog/runtime layout, install/disable/replace procedures, service lifecycle, backups, and health checks.
- [HTTP and MCP](http-and-mcp.md): current routes, discovery, mutation operations, MCP transports, and contract ownership.
- [Troubleshooting](troubleshooting.md): startup, plugin, browser, Assets-2, database, and MCP failure guides.
- [Standard OpenAPI](openapi.standard.json): generated contract for the four default plugins.

Runtime `GET /openapi.json` is authoritative for the exact active plugin set. The committed standard OpenAPI is generated from the default distribution and checked with `npm run check:openapi`.

## Architecture and reference

- [Architecture](architecture.md)
- [Plugin architecture and migration](plugin-architecture-and-migration.md)
- [Data contracts](data-contracts.md)
- [Functionality and first-party plugin inventory](plugin-functionality-inventory.md)
- [HTTP/MCP v0.1 to v0.2 mapping](http-mcp-v0.2-mapping.md)

## History

- [v0.2.0 release notes](release-notes-v0.2.0.md)
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
| Element validation | Active registry plus `src/plugin-runtime/elements.ts` |
| HTTP | Runtime registry and `src/api-v2/` |
| MCP | `src/mcp-v2/` plus active plugin tool descriptors |
| Standard API artifact | `docs/openapi.standard.json` |
| Database and migration | `src/store/` and `src/migrations/` |

When behavior changes, update the owning runtime contract, generated OpenAPI, relevant guide/reference page, examples, README, and tests together. Run `npm run check:docs` and `npm run check:openapi` before handing off a documentation or contract change.
