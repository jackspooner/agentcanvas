# AgentCanvas capabilities and permissions

## Capability model

Capabilities are named singleton providers with exact semantic versions. Consumers declare a range in the manifest and must call `consumeCapability` with exactly that declared range. Multiple providers, missing providers, or incompatible versions fail ordering or activation.

### Host capability: `agentcanvas.snapshot-resources@1.0.0`

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

`agentcanvas.assets2` and `agentcanvas.filesystem-images` are the current first-party providers. A missing provider does not invalidate a previously stored Gallery envelope; runtime resolution reports an explicit diagnostic until the provider returns.

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
