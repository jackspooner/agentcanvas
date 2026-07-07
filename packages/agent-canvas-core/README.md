# AgentCanvas Core

Reusable AgentCanvas contracts, validation, geometry, and bbox-layout helpers.

The runtime service remains in the AgentCanvas repo root. This package owns
portable model logic that can be reused by services, MCP tools, clients, and
renderers.

## Contract Notes

- Asset refs come from `@agentcanvas/media-contracts`.
- Canvas elements may use `assetId` or `assetKey`.
- `assetBaseUrl` is a runtime hint and may point at any configured HTTP(S)
  Assets-2 service URL.
