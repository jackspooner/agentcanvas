# @agentcanvas/core

`@agentcanvas/core` is the portable AgentCanvas document kernel. It contains generic canvas, bounds, viewport, sharing, operation, validation-limit, and error contracts.

`elementFitsCanvasBounds` checks an unrotated host frame against fixed bounds,
using `@agentcanvas/plugin-sdk`'s rendered frame defaults for missing sizes.

It deliberately does not own normal element types, plugin manifests, media references, plugin-specific geometry, browser renderers, snapshot renderers, HTTP/MCP servers, SQLite access, or Assets-2 integration. Public generic element/plugin contracts live in `@agentcanvas/plugin-sdk`; element-specific behavior belongs to the owning plugin.

The v0.2 element model is an open canonical envelope keyed by `<plugin-id>/<local-type>`. Consumers must use the frozen runtime registry to validate plugin-owned `data` and `style`; there is no closed element union or `group` type.
