# Physical schema 4 migration

Physical schema 4 adds host-owned macro definition, immutable version, and
invocation storage. The document schema remains version 2. This is an offline
database operation: stop AgentCanvas before `apply`, `verify` during cutover, or
`restore`. Startup never opportunistically migrates a live database.

## Supported source paths

Run `inspect` first. The CLI selects the supported path from the database
metadata:

| Source state | Offline path | Result |
| --- | --- | --- |
| v1 legacy database | `migrate apply` with every required importer in `--plugins` | physical 4 / document 2 |
| physical 2 / document 2 | `migrate apply` | adds theme and macro storage; physical 4 / document 2 |
| physical 3 / document 2 | `migrate apply` | first offline apply performs the dedicated core 3→4 macro-storage migration and preserves existing canvas/event/idempotency rows; physical 4 / document 2 |
| physical 4 / document 2 | no migration | current host can open it |

Newer or contradictory metadata is rejected. A v1 migration still requires the
owning extensions for all legacy element importers; missing importers are a
preflight blocker.

## Inspect, back up, and apply

From the repository root, archive the read-only inspection report for this
specific database before applying anything:

```bash
npm run migrate -- inspect --database <database-path> --json > <inspection.json>
npm run migrate -- apply --database <database-path> --backup-dir <backup-dir> --plugins <plugins-path>
npm run migrate -- verify --database <database-path> --plugins <plugins-path>
```

`apply` requires exclusive SQLite access and creates a native SQLite backup
before mutation. It writes `<backup-path>.manifest.json` beside the backup. The
manifest records the resolved source and backup paths, byte length, SHA-256,
source/target physical and document versions, preflight counts, timestamp, and
tool version. Inspect the returned paths and manifest; do not edit or move the
backup without moving its sidecar as a deliberate retention operation.

The migration verifies the backup checksum and source version, refuses source
changes after backup creation, and commits only after transaction-local
validation. It compares the preflight counts for canvases, elements, shares,
events, and idempotency rows, computes preservation fingerprints for existing
canvas state and operational tables, and runs SQLite integrity and foreign-key
checks. The v2/2 path intentionally invalidates old idempotency rows; the v1
path applies its documented legacy invalidation. The physical 3/document 2
path preserves existing canvas, event, and idempotency rows during the
dedicated core migration. If installed plugin migrations remain pending, a
subsequent offline apply/verify cycle may be required; one physical-3 apply is
not claimed to perform both core and plugin migrations. Macro tables start
empty and do not seed an example macro.

The post-apply verifier must report physical/document `4/2`, the expected
counts and mappings from the archived inspection/ledger, valid integrity and
foreign-key checks, and a completed host migration ledger row. Current canvas
documents remain document version 2; historical event bodies retain their
document-version semantics.

## Restore

Use the exact backup path returned by `apply`, with its manifest still beside
it:

```bash
npm run migrate -- restore --database <database-path> --backup <backup-path>
```

`restore` verifies the sidecar manifest, path, byte length, SHA-256, counts, and
supported source state before staging a native SQLite copy. The service must be
stopped. The current database is retained at a timestamped failed-database path
and WAL/SHM sidecars are moved with it before the verified backup is atomically
installed. If the restored source is physical 2/2 or 3/2, the current host will
again report that offline migration is required; retain the backup and rerun
the appropriate `migrate apply` path after investigation.

Keep the inspection report, backup, manifest, apply result, and verify result
until the installation's retention decision is complete. Never run SQL against
the live database to add macro tables or change `PRAGMA user_version`.
