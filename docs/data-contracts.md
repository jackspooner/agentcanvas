# AgentCanvas v0.2 data contracts

## Sources of truth

- Generic JSON, element, server, browser, snapshot, and capability contracts: `packages/plugin-sdk/src/`.
- Manifest validation: `src/plugin-runtime/manifest.ts`.
- Envelope and plugin schema validation: `src/plugin-runtime/elements.ts`.
- Store operations and persistence: `src/store/v2.ts` and `src/store/v2-schema.ts`.
- MCP contracts: `src/mcp-v2/server.ts` plus active plugin tool descriptors.
- Runtime OpenAPI: `src/api-v2/` and `GET /openapi.json`.

Runtime `/openapi.json` is authoritative for the active registry. The checked-in standard document is generated from the three default extensions and enforced by `npm run check:openapi`.

## Canonical element envelope

Every current element has `id`, namespaced `type`, positive integer `schemaVersion`, finite `x`/`y`, and JSON-object `data`. Optional frame fields are width, height, z-index, rotation, opacity, and lock state. Optional `style` and `metadata` are JSON objects.

JSON rejects `undefined`, functions, symbols, `BigInt`, non-finite numbers, unsafe integers, arrays where objects are required, and objects with non-plain prototypes.

## Mutation operations

| Operation | Owner required | Mutable fields |
|---|---:|---|
| `upsertElement` | yes | complete current-version envelope |
| `patchElementFrame` | no | `x`, `y`, `width`, `height`, `zIndex`, `rotation`, `opacity`, `locked` |
| `replaceElementData` | yes | complete `data` and optional `style` replacement |
| `replaceElementMetadata` | no | complete `metadata` replacement |
| `deleteElement` | no | deletion only |
| `clear` | no | whole document contents |

`id`, `type`, and `schemaVersion` are immutable in normal patches. There is no shallow or deep merge for plugin data.

## Read projection

Canvas reads return persisted `canvas` separately from runtime-only `elementRuntime` and `diagnostics`. Provider URLs, resource handles, resolved connector geometry, and resolution failures do not enter `elements_json`.

Missing-plugin reads preserve the envelope and add `plugin_unavailable`. A future stored schema version is never normalized downward.

## Diagnostics

```ts
interface PluginDiagnostic {
  code: string;
  severity: "info" | "warning" | "error";
  message: string;
  retryable: boolean;
  pluginId?: string;
  elementId?: string;
}
```

## Resources

The broker returns a flat opaque handle containing `handle`, `url`, `mimeType`, and optional byte length, dimensions, and SHA-256. Detail responses also include creation and optional expiry timestamps. Content bytes are returned only from the content route, never embedded in agent-facing JSON.

## Database versions

- Empty database: initialized transactionally at physical/document version 2.
- v0.1 database: startup fails with `database_migration_required`.
- exact v0.2: opens normally.
- newer or contradictory version metadata: startup fails explicitly.

See [v0.1 to v0.2 migration](v0.1-to-v0.2-migration.md).
