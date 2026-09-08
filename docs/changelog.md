# Change history

## Unreleased — diagnostics configuration and geometry

- Added installation-wide overlap modes Off, Limited and All in the canvas index
  and configuration API. The default is bounded at 100 warnings; the limit accepts
  1–10,000. Excess overlap warnings stop inspection with an explicit info notice.
  All mode preserves exhaustive pair reporting by user choice. Other diagnostics
  and validation remain enabled.
- Configuration PATCH accepts diagnostics or canvas defaults independently and
  preserves omitted settings. Old stored configuration uses bounded/100. HTTP,
  MCP, share, embed and snapshot reads use the current policy; canvas revisions
  remain unchanged. No environment variables, MCP tool names or database schema
  versions change. OpenAPI documents the additive settings and response schema.
- SDK geometry helpers now own 240×120 null/absent frame defaults and envelope
  anchors for editor, browser, server and snapshots. Explicit zero is preserved.
  Snapshot renderers receive effective dimensions on a copy; stored envelopes
  remain unchanged. This fixes differing connector anchors and implicit snapshot
  sizes. The editor now depends on the existing SDK workspace.
- Package versions remain unreleased; publishing these new SDK exports requires
  coordinated SDK/editor versioning. No packages or tags are published here.

## Unreleased — code-quality remediation

- Macro invocation inputs are literal JSON. Only saved templates interpret macro references. Callers relying on expressions inside input must move them into templates; no request field, error code, document format or database migration is added.
- Runtime and testkit share the SDK-owned manifest schema, canonical length/path limits and duplicate-element-name check. Testkit now depends on the SDK and Ajv and deliberately leaves semantic-version validation and filesystem checks to the runtime. Previously accepted malformed testkit manifests can now fail structural checks.
- Canvas document, operation and batch types have one core owner with existing store/browser export names preserved. Data and metadata operations retain raw object input pending runtime validation.
- HTTP/runtime and browser renderer/history/command responsibilities are extracted behind existing entrypoints. Runtime-only renderer updates now propagate without remounting stable renderers.
- Switching canvas identity clears transient previews and prevents old queued or delayed saves from installing a document into the newly selected canvas. Read-only checks also apply at the mutation queue boundary.
- Biome covers editor and extension TSX, hook/accessibility errors are enforced, warnings remain visible, and CI runs the aggregate contract validator with full Git history. Embed effects use current session authority without repeating unchanged poll notifications.

Package and runtime versions are unchanged. The SDK and testkit require coordinated versioning when a release is prepared; no packages or tags are published by this remediation. Paths, MCP names, extension activation rules and persisted documents remain compatible apart from the documented macro-input semantics and stricter structural manifest checks.
