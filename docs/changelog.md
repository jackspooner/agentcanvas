# Change history

## 0.3.0-alpha.6 — permanent canvas deletion

- Add revision-aware HTTP DELETE and MCP canvas_delete with atomic cleanup of
  documents, history, shares, saved viewports, retries and canvas-scoped macros.
- Offline schema 5 migration preserves data and live macro-version immutability;
  earlier migrations chain to the current schema with verified backups.
- Open editors stop on a missing canvas. External media and installation macros
  remain unchanged. See [upgrade guidance](upgrading.md#030-alpha6-permanent-canvas-deletion-physical-schema-5).

## Unreleased — setup and build checks

- Pin the dependency runner's Windows child `PATH` fix so nested npm builds
  resolve their tools without exceeding the shell's environment limit.
- Keep Markdown carousel restoration assertions compatible with Playwright's
  object matcher types while retaining every persisted field check.

## 0.3.0-alpha.5 — MediaTools image bindings

- Optional MediaTools 0.1.0 attaches existing jobs to Gallery slots and converts
  completed outputs through Filesystem Images admission. Persisted binding intents,
  collection before conversion, five-second polling and bounded outage backoff
  support recovery without submitting new generation.
- Host API 1.4.0 adds managed extension lifecycle hooks. Gallery and Filesystem
  Images 0.1.1 expose narrow authoring/admission capabilities; the SDK adds generic
  not-ready image states for matching runtime, browser and snapshot placeholders.
- External revisions preserve unrelated undo/redo and prune conflicting dependencies.
  Standard default activation and persisted element schemas remain unchanged.
- Gallery keeps active image downloads and loaded content through unchanged runtime
  refreshes, while source changes, navigation and disposal still cancel obsolete work.

## Unreleased — MCP canvas bounds and fixed-frame enforcement

- MCP canvas creation accepts bounds, and `canvas_set_bounds` changes them with
  revision checks. HTTP and MCP element writes reject new or changed frames
  outside fixed bounds; bounds changes reject sizes that exclude existing
  elements. Invalid writes leave the document and revision unchanged.
- Existing fixed canvases with older out-of-bounds elements remain readable;
  move or delete those elements before reducing bounds. No database migration
  or new dependency is required.

## Unreleased — canvas navigation visibility

- Canvas viewers can hide the top bar to give the canvas more space and restore
  it with an always available button, including in read-only shares.

## Unreleased — Markdown card carousel

- Markdown 0.3.0 adds an accessible `agentcanvas.markdown/carousel` element and
  editor commands that atomically combine 2–50 unlocked Markdown documents or
  unpack them without losing source IDs, content, styling, metadata, dimensions,
  or relative layout.
- Carousel navigation is browser-local with no autoplay. The persisted initial
  card owns deterministic summaries and snapshots. Existing Markdown documents,
  core APIs, database schemas, and dependencies are unchanged.

## 0.3.0-alpha.4 — primitive sizing and validation

- Primitives 0.2.1 grows text/shape add-tool heights to the existing content
  estimate, preserving width, position, larger frames and intentional clipping.
  Actual frames remain available through element reads; overlap diagnostics run
  against the grown frame. Generic writes, frame patches and stored data do not
  change.
- Host API 1.3.0 recognizes the SDK `PluginValidationError` as the existing
  non-retryable 400 validation problem with safe corrective guidance. Primitive
  HTML-entity rejection and Markdown 0.2.1 undersizing use this type; unexpected
  errors remain sanitized 500s. SDK pins and generated contracts are refreshed.
- No element-schema/database migration, dependency addition or package
  publication. See the upgrade notes for runtime extension replacement.

## Unreleased — Markdown frame sizing

- Markdown rendering, snapshot projection, and frame estimation now share one
  block parser. Auto-sizing accounts for font size, padding, borders, wrapping,
  block spacing, tables, code, and images with a conservative safety buffer.
- Content exceeding the 1200px automatic-height cap now produces an inspection
  warning unless internal scrolling was explicitly allowed. Agent guidance no
  longer suggests a fixed height for Markdown card rows.

## Unreleased — compact MCP mutation receipts

- MCP canvas writes now return canvas ID, revision, and whole-canvas inspection
  counts instead of repeating the full document. Canvas creation also returns its
  direct URL; macro writes and execution return compact mutation-specific receipts.
- Bundled extensions use the new SDK receipt operations. Existing extension code
  may keep using the compatible full-document operations. HTTP write responses are
  unchanged.
- Macro schemas include only reachable definitions and generic core upsert publishes
  the canonical element envelope, substantially reducing the MCP tool catalog.

## Unreleased — filesystem image stability

- Unchanged filesystem images now reuse their live resource handle across canvas
  polls, preventing browser flashes and unnecessary resource registrations. A
  changed file or expired handle still produces a fresh resource.

## Diagrams 0.2.0 — visual controls

- Optional Diagrams adds individual box sizing, theme-inheriting appearance,
  connector bends and label positions. Mermaid keeps source and a separate
  presentation layer; browser controls and server PNGs share its renderer.
- All five Mermaid families support visual controls. Sequence participants move
  horizontally without reordering messages. Source changes explicitly reset saved
  visual overrides. Native Auto layout resets bends/labels and preserves styling.
- Existing tools expose native presentation operations and Mermaid layout
  inspection. Both element schemas advance to 2 with offline 1→2 migrations;
  existing source, entity positions and styles are preserved. Generic clients and
  macro templates need schema 2. See the [upgrade instructions](../plugin-packages/diagrams/README.md#upgrading-from-diagrams-01).

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
