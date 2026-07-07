# AgentCanvas Media Contracts

Shared media and asset wire contracts for AgentCanvas packages.

This package owns portable contract shapes only. It does not call services,
read files, fetch bytes, or depend on a specific local host.

## Primary Exports

- `AssetReference` supports `assetId` or `assetKey` as durable identity.
- Asset URL helpers build Assets-2 record/content paths from a runtime base URL.
- Binary redaction helpers keep agent-facing payloads compact.

`assetBaseUrl` is an optional runtime hint. It is never part of durable asset
identity and portable validators must not require localhost URLs.
