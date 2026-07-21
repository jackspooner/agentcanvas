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
   extensions from documentation or source folders.
2. Inspect the target with `canvas_get` before editing it. For a new canvas,
   choose a layout and approximate frames before adding elements.
3. Create or edit with the most specific tool available. Use plugin tools for
   their owned element types and core frame/data tools for later corrections.
4. Call `canvas_get` after composing. Compare the returned elements with the
   request, then call `canvas_inspect` when available and repair its
   deterministic plugin-owned diagnostics. Re-run both checks after repairs.
   Before reporting, the final canvas operations must be `canvas_get` followed
   by `canvas_inspect`, with no mutation afterward.
5. Visually inspect the browser canvas when browser access is available. If it
   is not, say that visual rendering and remote-media loading remain
   unverified.
6. Report the canvas ID, what was verified, and any remaining limitation.

## Truth Discipline

- Distinguish persisted state from rendered state. `canvas_get` is
  authoritative for stored elements, frames, theme, revision, and
  diagnostics. Only a browser or render check proves appearance.
- Distinguish runtime facts from repository guidance. Use
  `canvas_list_plugins` for active extensions and their versions. Do not label
  source-code architecture rules as runtime or user-facing safety facts.
- Never say an image loaded because an element mutation succeeded. Verify the
  URL/resource separately and, when possible, inspect the rendered canvas.
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
  use `canvas_inspect` and follow any reported minimum height instead of
  estimating by eye.
- Keep at least 32 world pixels between unrelated frames. If element A starts
  at `x` with width `w`, the next horizontal element should normally start at
  `x + w + 32` or later.
- Overlap frames only when layering is deliberate. Do not use overlap as a
  substitute for grouping.

Useful starting layouts at approximately 1440x900:

```text
Three cards: x=-610, -200, 210; y=-170; width=380; height=340
Three columns: x=-620, -200, 220; width=380; gap=40
Wide title: x=-620; y=-390; width=1220; height=80
Vertical flow: x=-140; y=-330, -170, -10, 150; width=280; height=100
```

These are starting points, not mandatory templates. Expand frames for the
actual content and re-check the final bounds.

## Element Guidance

### Text

- Use separate text elements for title, subtitle, and section labels.
- Give large titles wide frames. A 32-48px title usually needs 700-1200px of
  width and at least 72px of height, not the 240x100 default.
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

- confirm the expected element types and count with `canvas_get`;
- run `canvas_inspect` when available and resolve every unintended warning;
- confirm titles and captions are stored exactly as intended;
- check every non-connector frame for unintended intersection;
- check title, Markdown, table, and image-card frames for likely clipping;
- confirm connector endpoints resolve within the same canvas;
- confirm the theme in the returned canvas instead of assuming a default;
- inspect the rendered canvas when possible; and
- describe only what these checks actually established.
