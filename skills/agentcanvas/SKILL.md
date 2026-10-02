---
name: agentcanvas
description: Create, edit, inspect, and verify AgentCanvas canvases through its MCP tools. Use whenever a user asks for a canvas, board, moodboard, diagram, flowchart, visual plan, spatial comparison, canvas edit, or a truthful report of what an AgentCanvas canvas contains.
---

# AgentCanvas

Treat AgentCanvas as a spatial board, not a document. A successful mutation
proves that data was persisted; it does not prove that the layout is readable,
remote media loaded, or the user's requested result is complete.

## Workflow

1. Read `canvas_get_guidance` when the server provides it, then discover the
   active runtime with `canvas_list_plugins` when the request
   depends on available element or media types. Do not infer optional
   extensions from documentation or source folders. When a tool is not directly
   published, fetch its exact descriptor with `canvas_get_extension_tool` and
   use the matching read-only or mutating extension dispatcher.
2. Inspect only the state needed for the edit. Prefer `canvas_list_elements`
   and `canvas_get_element`; use `canvas_get` when the complete persisted
   document is genuinely required. For a new canvas, choose a layout and
   approximate frames before adding elements.
3. Create or edit with the most specific tool available. `canvas_create`
   returns a direct browser `url`; retain it so you can give it to the user.
   Use `canvas_get_url` to recover the URL for an existing canvas. This direct
   URL does not create a read-only share link or bypass access controls. Use
   plugin tools for their owned element types and core frame/data tools for
   later corrections.
   After each mutation, read the returned `inspectionSummary`; when any count
   is nonzero, page through `canvas_inspect` and repair unintended warnings.
4. After composing, use `canvas_list_elements` and targeted `canvas_get_element`
   calls to compare the persisted result with the request. Use `canvas_get`
   only when the complete document, theme, or element data must be verified.
   Finish with `canvas_inspect` and no mutation afterward.
5. Treat the final persisted-state reads and `canvas_inspect` results as sufficient
   verification of persisted canvas content by default. Use browser rendering
   when the user explicitly requests a visual check, when the task depends on
   proving rendered appearance or remote-media loading, **or when an
   image-containing canvas must be checked to establish that its images are
   present and displaying correctly.** Persisted image elements and clean
   diagnostics do not prove that result.
6. Report the canvas ID, what was verified, and any remaining limitation.

## Macro workflow

Macros are host-owned, declarative creation definitions. Use only the public
HTTP routes and resident MCP tools; macro creation is available through HTTP or
MCP, not through selection authoring or an extension planner.

1. Discover the current generic catalog with `GET /api/v1/macros` or
   `macro_list`; do not infer definitions from extension folders or cached tool
   names.
2. Fetch an exact immutable version with
   `GET /api/v1/macros/:macroId/versions/:macroVersion` or `macro_get` using
   both `macroId` and `macroVersion`. Create, version, or archive through the
   public macro HTTP/MCP operations and retain the returned exact version.
3. Plan with `POST /api/v1/canvases/:canvasId/macros/:macroId:plan` or
   `macro_plan`, supplying `macroVersion`, explicit `{ x, y }` anchor, typed
   input, and optional `label` in the body. Do not duplicate `canvasId` or
   `macroId` in that body. Planning is pure. MCP returns plan identity,
   revisions, digests, expiry, named outputs, and the effect summary; use the
   HTTP plan only when operations or preview elements are explicitly needed.
4. Execute with the canvas macro execution route or `canvas_run_macro`, always
   supplying the plan ID, `expectedRevision`, and a bounded `idempotencyKey`.
   Reuse the same key when retrying the same logical execution; allocate a new
   key only for a new plan/execution. A direct invocation (`mode: "direct"`) validates and plans
   internally before the same atomic, revision-aware commit; it does not bypass
   validation or preview semantics. Prefer plan mode when a browser preview or
   confirmation is required.
5. After execution, verify outputs and affected elements with bounded element
   reads, then call `canvas_inspect`. Use `canvas_get` only when the full
   document is needed. A macro run should be one history/undo unit; do not
   claim that preview content persisted.

Macro provenance contains the macro ID, exact version, plan ID, and digests.
Never put raw invocation inputs, secrets, or sensitive row content into
provenance, labels, or agent-facing logs; retain only an explicitly safe
summary where the public response permits it.

## Existing image jobs

Use optional `agentcanvas.mediatools` when the user wants an existing MediaTools
image job placed when ready. Discover it with `canvas_list_plugins`, then fetch
`canvas_get_extension_tool({pluginId:"agentcanvas.mediatools", toolName:"bind"})`
and follow its live dispatcher/schema. It never submits generation. Example
arguments for `canvas_mutate_extension_tool`:

```json
{"pluginId":"agentcanvas.mediatools","toolName":"bind","arguments":{"bindingId":"scene-hero","canvasId":"existing-canvas-id","runId":"existing-image-job-id","target":{"kind":"image","x":-160,"y":-120},"caption":"Scene concept"}}
```

Keep a stable caller-supplied binding ID; identical inputs resume an attachment,
different inputs return an idempotency conflict. New image frames default to
320×240 and contain fit with navigation/indicators hidden. Use target
`{kind:"append",elementId:"existing-gallery",itemId:"new-slot"}` or
`{kind:"replace",elementId:"existing-gallery",itemId:"existing-slot"}` for
carousels. Existing slots keep their captions/settings; completion preserves
frame geometry and item order.

Read `get-binding` or bounded `list-bindings` through the read-only dispatcher.
Queued/running are expected pending states; collection and conversion continue
across restarts. A transient outage remains retryable. Failed/expired jobs,
missing output indexes and rejected files are terminal; inspect the safe error
and bind a different job using a new binding ID. Removed/rebound slots supersede
the old binding. Do not resubmit generation to recover collection uncertainty.

Complete outputs become normal filesystem source references; no absolute output
paths or bytes are returned. Collect before the current 24-hour job-history
expiry. Collected references survive expiry. Inspect the stored target and run
`canvas_inspect` after completion; a pending reference is not a completed image.
Operator setup is in [MediaTools extension](../../plugin-packages/mediatools/README.md).

## Truth Discipline

- Distinguish persisted state from rendered state. `canvas_get` is
  authoritative for stored elements, frames, theme, revision, and
  diagnostics, and that persisted text-format state is sufficient for ordinary
  canvas completion. Only use a browser or render check when rendered
  appearance itself must be proven.
- Distinguish runtime facts from repository guidance. Use
  `canvas_list_plugins` for active extensions and their versions. Do not label
  source-code architecture rules as runtime or user-facing safety facts.
- Never say an image loaded because an element mutation succeeded. Verify the
  URL/resource separately and inspect the rendered canvas whenever the task
  asks, or necessarily entails, checking that images are present or display
  correctly.
- Never invent element counts, active tools, URLs, dimensions, revisions, or
  diagnostics. Read them from tool results.
- Treat `Verified`, `Confirmed`, and similar labels on an existing canvas as
  evidence claims, not decoration. Keep them only when the current session
  can reproduce the evidence. Otherwise replace them with an accurate source
  label such as `Supplied` or `Unverified`, or remove them. A canvas cannot
  verify its own text.
- Label uncertain content as an assumption or recommendation. Do not present
  generated prose as researched fact.
- When elaborating a supplied brief, visibly label generated tasks, budget
  allocations, timelines, and recommendations as `Proposed` or `Assumption`.
  Put the label in the heading or caption when it applies to a whole generated
  section. Do not later claim that those details came from the brief.
- After any corrective mutation, read the canvas again before claiming the
  correction worked.

## Coordinate And Frame Model

- `x` and `y` are the top-left of an element frame in world coordinates.
- A fresh unlimited canvas opens around world coordinate `(0, 0)`. Compose
  around the origin rather than starting a wide board at positive coordinates.
- `width` and `height` are the visible frame. Set them explicitly for titles
  and shapes. For Markdown and tables, set width but normally omit height so
  the add tool can estimate it; set an explicit height with the intentional
  scrolling option only when the user requested a compact scroller or a hard
  space constraint makes one necessary. Default to showing all content.
- Generic frame edits do not auto-size plugin content. After changing a frame,
  follow any minimum height in the mutation response immediately instead of
  estimating by eye. Use `canvas_inspect` for the final whole-canvas audit (or
  as a fallback when an older client does not expose response diagnostics).
- Keep at least 32 world pixels between unrelated frames. If element A starts
  at `x` with width `w`, the next horizontal element should normally start at
  `x + w + 32` or later.
- Overlap frames only when layering is deliberate. Do not use overlap as a
  substitute for grouping.

Useful starting layouts at approximately 1440x900:

```text
Three Markdown cards: x=-610, -200, 210; y=-170; width=380; omit height
Three columns: x=-620, -200, 220; width=380; gap=40
Wide title: x=-620; y=-390; width=1220; height=80
Vertical flow: x=-140; y=-330, -170, -10, 150; width=280; height=100
```

These are starting points, not mandatory templates. Expand frames for the
actual content and re-check the final bounds.

For an equal-height Markdown row, create every card with omitted height, read
the resulting frames, then resize the row to its tallest card. Do not choose a
shared fixed height before auto-sizing the content.

## Element Guidance

### Text

- Use separate text elements for title, subtitle, and section labels.
- Give large titles wide frames. A 32-48px title usually needs 700-1200px of
  width. Text and shape add tools grow height to fit estimated content unless
  `allowClipping=true`; read the saved frame and repair any overlap warnings.
- Keep text frames vertically separate even when the visible line looks short.
- Put literal text in labels. Write `Research & Planning`, not the HTML entity
  `Research &amp; Planning`.

### Shapes And Connectors

- Use concise labels on shapes. Put paragraphs in Markdown cards.
- For diagrams, create the nodes first and retain their returned element IDs.
- Connector element IDs are scoped to one canvas. Use IDs from the current
  `canvas_get` result and never reuse an ID from another canvas.
- Route decision branches with enough spacing that labels and feedback arrows
  do not cross nodes or unrelated connectors.

### Markdown And Images

- Prefer one topic or one image per Markdown element. Do not put an entire
  board into one giant Markdown node.
- A text-only Markdown card normally needs 320-520px width and enough height
  for every heading, list, and table row. Omit `height` to let the add tool
  estimate it, or set `allowScroll: true` only for an intentionally compact
  scrolling card.
- For an image card around 380px wide, start near 340-380px high so the image,
  title, and caption all remain visible.
- HTTP(S) Markdown images are remote references. They are not copied into
  AgentCanvas and may disclose a viewer request to the image host.
- Use `allowImages: false` for untrusted Markdown when remote loading is not
  appropriate.
- Use an installed image-source extension for durable local or Assets-2 image
  nodes; never assume an optional provider is active.

### Tables

- Use the table extension for comparisons and compact structured data.
- Size the frame for the column count, longest cell, and row count. Keep tables
  out of neighboring column frames.
- Mark recommendations, assumptions, and unknowns explicitly when the table
  contains analysis rather than verified data.

## Themes

Use semantic themes for cohesion, but preserve readable contrast. If theme
validation rejects a color pair, adjust the reported pair instead of claiming
the theme was applied. A safe dark starting palette is:

```json
{
  "canvas": "#0f172a",
  "surface": "#1e293b",
  "surfaceMuted": "#334155",
  "text": "#f1f5f9",
  "textMuted": "#94a3b8",
  "border": "#475569",
  "accent": "#047857",
  "accentText": "#ffffff",
  "highlight": "#047857",
  "highlightText": "#ffffff"
}
```

## Final QA

Before saying the canvas is complete:

- confirm the expected element types and count with `canvas_list_elements`;
- run `canvas_inspect` when available and resolve every unintended warning;
- confirm titles and captions are stored exactly as intended;
- check every non-connector frame for unintended intersection;
- check title, Markdown, table, and image-card frames for likely clipping;
- confirm connector endpoints resolve within the same canvas;
- confirm the theme with `canvas_get` when theme state is part of the task;
- inspect the rendered canvas when explicitly requested, when required to
  prove appearance or remote-media loading, or when image presence/display
  correctness is part of the requested check; and
- describe only what these checks actually established.
