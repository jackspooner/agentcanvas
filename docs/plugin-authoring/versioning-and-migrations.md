# Versioning and migrations

AgentCanvas plugins have three related but separate version domains.

## Version domains

| Version | Example | Purpose |
|---|---|---|
| Plugin package version | `0.4.0` | Distribution release and plugin dependency matching |
| Host API range | `^1.0.0` or `^1.1.0` | Compatibility with the AgentCanvas extension ABI |
| Element schema version | `3` | Persisted data shape for one element type |

Do not infer an element schema version from the plugin package version.

AgentCanvas host API `1.1.0` adds renderer lifetime, activity, reduced-motion,
and shared frame scheduling. Existing extensions declaring `^1.0.0` remain
compatible. An extension that uses `RendererContext.lifecycle` or
`RendererContext.frames` must declare `^1.1.0`.

## Plugin and capability dependencies

Declare plugin dependencies and capability requirements with semantic-version ranges:

```json
{
  "requires": {
    "hostApi": "^1.0.0",
    "plugins": {
      "acme.shared-geometry": "^2.0.0"
    },
    "capabilities": {
      "agentcanvas.assets": "^1.0.0"
    }
  }
}
```

The host validates ranges, builds a deterministic dependency graph, reports full cycles, and activates providers before consumers. Capabilities are singleton providers.

Only consume a capability and exact range declared by the manifest:

```ts
const assets = host.consumeCapability<AssetsCapabilityV1>('agentcanvas.assets', '^1.0.0');
```

## Changing element data

If a change invalidates or reinterprets stored `data` or `style`, increment that element's `schemaVersion` and supply contiguous forward-only pure migrations.

```ts
schemaVersion: 3,
schemaMigrations: [
  {
    fromVersion: 1,
    toVersion: 2,
    migrate(data, style) {
      return { data: { ...data, status: 'unknown' }, style };
    }
  },
  {
    fromVersion: 2,
    toVersion: 3,
    migrate(data, style) {
      const { oldLabel, ...rest } = data;
      return { data: { ...rest, title: oldLabel }, style };
    }
  }
]
```

Requirements:

- Every step advances exactly to the next declared version.
- Migrations are deterministic and side-effect free.
- They do not contact Assets-2, the network, the filesystem, or the database.
- They return complete data/style replacements.
- Resulting envelopes pass the current plugin schema and cross-field validation.
- They never normalize a future stored version downward.

Pending installed-plugin migrations fail readiness and point the operator to the offline migration CLI. Applying them creates a verified database backup and records `plugin_migration_runs` without inventing canvas revisions or user-visible content events.

## Legacy importers

Legacy importers convert pre-v0.2 element wire shapes to one canonical v0.2 envelope. They are declared under `contributes.migrations` and registered with `registerMigration`.

```ts
host.registerMigration({
  name: 'legacy-card-v1',
  legacyTypes: ['signalCard'],
  importLegacy(record, context) {
    return {
      element: {
        id: context.elementId,
        type: 'acme.signal-card/card',
        schemaVersion: 1,
        x: Number(record.x),
        y: Number(record.y),
        data: { title: String(record.title), status: String(record.status) }
      },
      strippedFields: ['resolvedUrl']
    };
  }
});
```

The host owns common envelope extraction/orchestration. Unknown fields, unknown types, malformed JSON, and unsupported legacy values should block migration. Do not blindly copy unknown properties into `data`.

## Compatible plugin removal and reinstall

Removing a plugin does not migrate its canonical envelopes. Reinstalling a plugin that accepts the stored schema version restores validation and rendering without document mutation.

If a newer plugin has already migrated data, reinstalling an older plugin may be incompatible. Code rollback and data rollback are separate operations; never downgrade stored schemas silently.

## Release checklist

For a plugin release:

1. Update plugin package and manifest versions together.
2. Review host, plugin, and capability ranges.
3. Increment only the element schema versions whose persisted contract changed.
4. Add contiguous migration fixtures and determinism tests.
5. Update configuration docs and migration/release notes.
6. Build and verify a self-contained distribution.
7. Rehearse install, migration, missing-plugin preservation, and compatible reinstall.

Extensions using command inputs, hidden commands, current-element command reads,
revision-checked browser transactions, renderer command dispatch, or per-element
snapshot deadlines must declare Host API `^1.2.0`.
