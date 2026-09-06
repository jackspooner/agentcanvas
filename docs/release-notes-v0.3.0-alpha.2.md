# AgentCanvas 0.3.0-alpha.2

This release makes the HTTP and MCP application-error contract enforceable.

- HTTP application failures now use RFC 9457 `application/problem+json` with stable machine-readable codes and request IDs.
- MCP application failures reuse the HTTP Problem Details semantics at `structuredContent.problem`; MCP protocol failures remain protocol-native.
- Runtime responses, OpenAPI `x-error-codes`, examples, MCP mappings, and `docs/error-codes.json` derive from one AgentCanvas registry.
- `docs/mcp-tools.standard.json` is generated beside the standard OpenAPI document.
- `npm run check:contracts` validates structure, metadata, examples, MCP descriptors, compatibility, generated artifacts, and the ratchet baseline.
- Clean installations now use `npm run setup` to fetch and build pinned internal dependencies before `npm ci`; CI and Docker use the same entry point. Docker retains the prepared packages in its runtime image.
- Internal dependency verification no longer requires a machine-specific Workspace2 path.

The old flat HTTP error envelope is removed without a compatibility fallback because AgentCanvas remains pre-1.0. See [Upgrading](upgrading.md#030-alpha2) for the client migration.
