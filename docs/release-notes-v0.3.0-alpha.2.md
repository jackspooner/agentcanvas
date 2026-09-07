# AgentCanvas 0.3.0-alpha.2

This release makes the HTTP and MCP application-error contract enforceable.

- MCP canvas responses preserve missing-extension elements without reporting successful mutations as failures; empty element registries retain canvas creation/read support while rejecting upserts.
- Canvas lists share a default of 50 and a strict integer range of 1–200 across store, HTTP, OpenAPI, and MCP. HTTP rejects invalid limits with `400 validation_error` instead of clamping or returning a server error.
- Formatting and lint checks now include package and extension-package TSX. The keyboard-focusable canvas retains a documented, local lint exception for its custom keyboard interaction.

- HTTP application failures now use RFC 9457 `application/problem+json` with stable machine-readable codes and request IDs.
- MCP application failures reuse the HTTP Problem Details semantics at `structuredContent.problem`; MCP protocol failures remain protocol-native.
- Runtime responses, OpenAPI `x-error-codes`, examples, MCP mappings, and `docs/error-codes.json` derive from one AgentCanvas registry.
- `docs/mcp-tools.standard.json` is generated beside the standard OpenAPI document.
- `npm run check:contracts` validates structure, metadata, examples, MCP descriptors, compatibility, generated artifacts, and the ratchet baseline.
- Clean installations now use `npm run setup` to fetch and build pinned internal dependencies before `npm ci`; CI and Docker use the same entry point. Docker retains the prepared packages in its runtime image.
- Internal dependency verification no longer requires a machine-specific Workspace2 path.
- Canvas title, bounds, and theme updates commit their document, revision, and event together; failed writes roll back completely.
- Core HTTP mutations enforce the published request schemas. Malformed JSON, invalid fields, and missing required bodies return `400` Problem Details without writing data; share creation requires an object body, including `{}` for default options.
- The browser installs runtime media and diagnostics from batch responses, refreshes after macros and metadata changes, and renews resources without requiring a document revision change. Older responses cannot overwrite newer documents.
- Browser errors display Problem Details and request IDs. Unexpected server failures produce one structured stderr record with the matching request ID and source locations, excluding exception messages and request values.
- Expired resource registrations release their buffers automatically. Closing an owned runtime disposes its resource broker.
- Wheel zoom works over ordinary extension content while interactive controls keep their wheel events.
- Compatible dependency updates resolve the reported production and development vulnerabilities. Browser fixtures account for canvas zoom, an explicitly zoomed culling viewport, and same-origin GLB delivery.

The old flat HTTP error envelope is removed without a compatibility fallback because AgentCanvas remains pre-1.0. See [Upgrading](upgrading.md#030-alpha2) for the client migration.
