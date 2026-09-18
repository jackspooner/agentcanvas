# v0.3.0-alpha.4: Primitive sizing and host API 1.3

Text and shape add tools increase height to fit the existing deterministic
content estimate. Explicit heights are minimums; omitted/null heights start at
100px for text and 160px for shapes. Width and position stay unchanged, larger
frames never shrink, and `allowClipping: true` preserves deliberate clipping.
Read actual persisted frames and repair any overlap warnings introduced by
growth. Rendered fit still requires browser verification.

Host API 1.3.0 recognizes the SDK `PluginValidationError(message)`. Expected
extension input rejection returns the existing non-retryable `validation_error`
problem with status 400 and safe corrective guidance through HTTP and MCP.
Primitive HTML-entity rejection and Markdown undersizing use this contract;
unexpected errors remain sanitized 500s. Markdown sizing is unchanged.

The plugin SDK advances to 0.3.0-alpha.2, the extension SDK to 0.3.0-alpha.3,
core to 0.2.1, and Primitives/Markdown to 0.2.1. Extensions using the error require
host API `^1.3.0`; existing extensions remain compatible. Rebuild packages and
refresh existing SDK dependency pins; packages are not published by this change.

Follow the [upgrade instructions](upgrading.md#030-alpha4) to replace affected
runtime extensions and restart. Existing documents, generic writes, frame
patches, line/arrow sizing, element schemas and SQLite schemas are unchanged.
