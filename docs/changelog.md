# Change history

## Unreleased — code-quality remediation

- Macro invocation inputs are literal JSON. Only saved templates interpret macro references. Callers relying on expressions inside input must move them into templates; no request field, error code, document format or database migration is added.
- Runtime and testkit share the SDK-owned manifest schema, canonical length/path limits and duplicate-element-name check. Testkit now depends on the SDK and Ajv and deliberately leaves semantic-version validation and filesystem checks to the runtime. Previously accepted malformed testkit manifests can now fail structural checks.
- Canvas document, operation and batch types have one core owner with existing store/browser export names preserved. Data and metadata operations retain raw object input pending runtime validation.
- HTTP/runtime and browser renderer/history/command responsibilities are extracted behind existing entrypoints. Runtime-only renderer updates now propagate without remounting stable renderers.
- Switching canvas identity clears transient previews and prevents old queued or delayed saves from installing a document into the newly selected canvas. Read-only checks also apply at the mutation queue boundary.
- Biome covers editor and extension TSX, hook/accessibility errors are enforced, warnings remain visible, and CI runs the aggregate contract validator with full Git history. Embed effects use current session authority without repeating unchanged poll notifications.

Package and runtime versions are unchanged. The SDK and testkit require coordinated versioning when a release is prepared; no packages or tags are published by this remediation. Paths, MCP names, extension activation rules and persisted documents remain compatible apart from the documented macro-input semantics and stricter structural manifest checks.
