---
name: agentcanvas-layout
description: Arrange new or edited AgentCanvas boards in readable 16:9 areas with left-to-right flow and an explicit theme. Use for canvas authoring and layout changes, not read-only inspection.
---

# AgentCanvas layout

This guide owns geometry, themes, and typography for authoring. For tool
operations use [canvas mutations](../agentcanvas/SKILL.md#mutation-mechanics).
For final evidence and verification use [inspection QA](../agentcanvas-inspection/SKILL.md#final-qa);
read-only inspection does not require applying these authoring defaults.

## Theme

Set a theme explicitly for every canvas you create or edit. Default to a dark theme with readable text and contrast; customize its colors within that dark style. Honor a user-requested theme when one is specified. If validation rejects a color pair, adjust the reported pair before continuing; verify the persisted theme through final QA.

## Typography

Choose heading, body, and monospace faces deliberately through `theme.typography.headingFont`, `bodyFont`, and `monoFont`. Avoid defaulting to Inter; use a user's requested fonts when provided. Otherwise pick a distinctive, readable heading face and a quiet body face, with monospace reserved for code and source labels. For example, Georgia, Segoe UI, and Consolas form a usable Windows palette; choose faces available in the current environment and do not install or fetch new fonts unless the user requests or authorizes it.

On an existing board, update or clear per-element `style.fontFamily` overrides as needed: they can override the theme on text, Markdown, and tables. Check the saved frames after changing typography, including at 57% zoom, and adjust card size or layout if needed; don't cram content or shrink type to compensate. Apply the inspection owner’s [rendered-evidence requirements](../agentcanvas-inspection/SKILL.md#persisted-and-rendered-evidence) to typography claims; a saved family name alone does not confirm the rendered face or fallback.

## Reading order

- Plan the whole canvas in **one 16:9 area first**. Include every topic or stage that fits legibly in that area; do not start a new area just because the topic changes. Choose the area's size for the content (for example, 1600 × 900 or 3200 × 1800 world pixels), keeping the 16:9 ratio. Use another equal-sized area only when the remaining content cannot fit without cramped text, overlap, or clipping. Keep at least 64 pixels between areas and do not create empty areas.
- Assess readability at **57% zoom** by default, or at the user's specified zoom. Use the area for useful purpose, inputs, outputs, and flow; do not reduce rich content to bare labels or fill space with repetitive prose. Choose readable type at that zoom and size cards to their contents before enlarging the area.
- Complete the first area, then the one immediately to its right, then the area below the first, then the area below the second. Treat these four areas as one 2×2 block. Place the next 2×2 block to its right, then one below the first block, then one below the second. Repeat this **top-left → top-right → bottom-left → bottom-right** pattern recursively for larger blocks. The first twelve area coordinates, in area units, are `(0,0), (1,0), (0,1), (1,1), (2,0), (3,0), (2,1), (3,1), (0,2), (1,2), (0,3), (1,3)`.
- Within an area, arrange related content from left to right. Put inputs and context before processing, and outcomes at the right. Put a branch directly below the element or stage where it begins. Keep related elements grouped, widths consistent where practical, and connectors readable without overlaps. Fill the current area before moving to the next one.
- On an unlimited canvas, start the first area around the origin so it appears on opening; a 1600 × 900 area can span `x=-800..800`, `y=-450..450`. On a fixed canvas, start at `(0,0)`. Each later area's origin advances by its width or height plus the chosen gap. A subtle boundary or area heading can help navigation, but do not add decorative empty frames.

Complete the inspection owner’s [final QA](../agentcanvas-inspection/SKILL.md#final-qa), including area containment and readability at the chosen zoom.

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
  use the [mutation response handling](../agentcanvas/SKILL.md#mutation-mechanics)
  for minimum-height diagnostics; do not estimate required height by eye.
- Keep at least 32 world pixels between unrelated frames. If element A starts
  at `x` with width `w`, the next horizontal element should normally start at
  `x + w + 32` or later.
- Overlap frames only when layering is deliberate. Do not use overlap as a
  substitute for grouping.

Useful element placements within a 1600 × 900 area:

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
- Use the image-source extensions exposed by the active runtime for image
  nodes; never assume an optional provider is active.

### Tables

- Use the table extension for comparisons and compact structured data.
- Size the frame for the column count, longest cell, and row count. Keep tables
  out of neighboring column frames.
- Label analysis using the inspection owner’s
  [evidence rules](../agentcanvas-inspection/SKILL.md#persisted-and-rendered-evidence).

## Theme palette example

A safe dark starting palette is:

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
