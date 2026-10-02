# AgentCanvas capabilities and permissions

## Capability model

Capabilities are named singleton providers with exact semantic versions. Consumers declare a range in the manifest and must call `consumeCapability` with exactly that declared range. Multiple providers, missing providers, or incompatible versions fail ordering or activation.

### Host capability: `agentcanvas.snapshot-resources@1.0.0`

Resource registrations are fixed by default. A provider that owns a stable
identity with replaceable bytes must opt into `mutable: true`; the host then
refreshes the handle's measured size, checksum, and dimensions from the loaded
payload while retaining MIME-type validation and byte limits. Assets-2 uses this
mode because `asset_replace_content` preserves the asset ID. Providers must
revalidate their current metadata before fetching mutable content and reject
size or checksum mismatches rather than weakening integrity checks.

The host resource broker supports:

- registering a lazy bounded byte loader with MIME, optional length/dimensions/SHA-256, and TTL;
- reading safe resource details;
- loading content by opaque handle with abort support.

The broker allows a controlled MIME set and defaults to a 512 MiB host hard ceiling, one-hour TTL, and 24-hour maximum TTL. Provider/plugin limits are normally lower. Content loader MIME, declared byte length, and SHA-256 are rechecked.

### Host capability: `agentcanvas.image-sources@1.0.0`

The host image-source registry supports multiple provider adapters behind one singleton capability. A persisted reference has exactly two fields:

```json
{
  "provider": "example.images",
  "reference": { "providerOwned": "value" }
}
```

Source extensions register a provider ID, strict reference validator, and resolver that returns an opaque image resource handle. Consumers validate and resolve the envelope without importing provider code. Provider IDs are extension IDs, duplicate registration fails startup, and non-image MIME types are rejected.

`agentcanvas.assets2`, `agentcanvas.filesystem-images`, and the optional
`agentcanvas.mediatools` pending-job provider are first-party adapters. A missing
provider preserves previously stored Gallery envelopes and reports a diagnostic.

Providers may throw the SDK's `ImageSourceNotReadyError` with `queued`, `running`,
or `failed`, a safe viewer message, code, and retryability. Gallery projects the
state into runtime diagnostics and browser/snapshot placeholders. This adds no
persisted Gallery schema fields and no dependency on a particular job service.

### Gallery authoring and filesystem admission

`agentcanvas.gallery-authoring@1.0.0` exposes creation, append, item reads, and
conditional source replacement. Gallery performs writes through its own scoped
canvas operations, checks the expected source and current revision, and preserves
other item fields, settings and geometry. Consumers receive no arbitrary-element
mutation permission.

`agentcanvas.filesystem-image-admission@1.0.0` converts an absolute collected file
path and configured root ID into a canonical image-source reference. Filesystem
Images applies its existing real-path containment, regular-file, format and size
checks; it does not create implicit roots or copy bytes into AgentCanvas.

### Optional plugin capability: `agentcanvas.assets@1.0.0`

`agentcanvas.assets2` provides:

- strict durable reference validation;
- safe detail projection;
- opaque content handles;
- bounded JSON asset-content resolution;
- provider health, exact identity, and capability status.

Only extensions that declare `agentcanvas.assets@^1.0.0` require this provider. Its readiness confirms `asset-service`, `asset_crud`, and `asset_refs`; provider failure does not make AgentCanvas core unhealthy.

`boundedJson` resolves and parses the asset's JSON content endpoint, not the Assets-2 metadata record. It accepts `application/json` and `+json` MIME types and uses the configured preview-byte limit.

## Permission vocabulary

First-party manifests currently use:

| Permission | Intended meaning |
|---|---|
| `canvas.read` | Read canvases through scoped invocation context |
| `canvas.mutate-own` | Mutate plugin-owned element data or create owned elements |
| `assets.read` | Consume the Assets capability or register the Assets-2 image provider |
| `filesystem.read` | Read files through an extension's explicitly configured policy |
| `diagnostics.emit` | Emit safe scoped diagnostics |

The manifest schema accepts other non-empty permission strings for forward compatibility.

## Security boundary

Permissions are not a sandbox. The supported canvas host service does enforce them: `canvas.read` is required for reads, and `canvas.mutate-own` limits upsert, data replacement, and deletion to elements in the calling plugin namespace. Capability consumption is separately limited to exact manifest declarations and compatible ranges.

Plugins remain trusted Node and same-origin browser dependencies. Do not install unreviewed distributions. Secrets belong in declared environment variables and must not appear in manifests, config files, status output, diagnostics, or resource metadata.
