---
name: agentcanvas-inspection
description: Inspect AgentCanvas canvases, URLs, revisions, elements, diagnostics, and image-overlay geometry through the current AgentCanvas MCP contract. Use for “what is on this canvas?”, exact bbox questions, canvas IDs/URLs, or persisted-versus-rendered verification.
---

# AgentCanvas Inspection

Use the resident `agentcanvasmcp` surface as the source of truth for persisted canvas state. A successful read or mutation proves persistence; only browser inspection proves rendered appearance or remote-media loading.

## Current Workflow

1. Follow [runtime discovery](../agentcanvas/SKILL.md#runtime-discovery) for
   guidance, optional capabilities, deferred tools, and direct canvas URLs.
2. Identify the canvas from an explicit ID, or use `canvas_list` and matching
   title/revision clues.
3. Page through `canvas_list_elements({canvasId})` for IDs, types, frames, and
   bounded summaries. Call `canvas_get_element({canvasId, elementId})` for
   complete target data. Use `canvas_get({canvasId})` when the complete
   persisted document or theme is required.
4. Use paginated `canvas_inspect({canvasId})` for deterministic plugin-owned
   diagnostics when quality or completeness matters; use its filters and
   whole-canvas counts. For completion, follow [final QA](#final-qa).

## Image-job bindings

Use runtime discovery above for optional `agentcanvas.mediatools` and its
`get-binding` or `list-bindings` read-only tools. Reading a binding never polls or collects its
MediaTools job. Queued/running/collected indicate unfinished delivery; failed
states include safe errors, and superseded means the item was removed or rebound.

Match binding `canvasId`, `elementId` and `itemId` with the current Gallery item.
Completion must persist a normal `agentcanvas.filesystem-images` source with
`{rootId,path}`, preserving frame geometry, caption and carousel order/settings.
Do not claim completion from a pending binding reference or progress diagnostic.
Runtime-only progress does not change the canvas revision. Completed external
revisions prune conflicting history while unrelated undo/redo survives.
After completion, inspect the target element and `canvas_inspect`; follow the
normal image-rendering evidence rules when checking actual appearance.

## Bbox Overlays

The current persisted type is:

```text
agentcanvas.image-overlays/bbox
```

Inspect inline geometry under `element.data`: `boxes`, `canvasWidth`, and
`canvasHeight`. These fields establish the overlay coordinates independently
of its outer frame.

Distinguish:

- element frame: `element.x`, `element.y`, `element.width`, `element.height`;
- internal overlay coordinate space: `element.data.canvasWidth`, `element.data.canvasHeight`;
- boxes: `element.data.boxes`.

Stored overlays may instead contain a legacy external layout reference in
`element.data.layoutAssetRef`. If inline geometry is absent, report the internal
geometry as unresolved; do not estimate it from the rendered frame. Match
multiple overlays by element ID, caption/metadata, neighboring content, or the
user’s stated target.

## Evidence Rules

- `Verified:` facts read from bounded canvas element tools, an explicit `canvas_get`, `canvas_inspect`, including inline overlay geometry.
- `One strong inference:` a canvas/element match based on title, revision, metadata, or nearby content.
- `Still unconfirmed:` ambiguous canvas matches or claims for which the required evidence is unavailable. Apply the rendered-evidence requirements below before declaring completion.

Do not:

- call old v0.1 tools such as `canvas_get_viewport` or `canvas_screenshot` unless live discovery actually exposes them;
- use the removed `canvas_get mode=full` shape;
- search only for the old element type `bboxOverlay`;
- visually measure coordinates when structured overlay data exists;
- treat clean persisted diagnostics as proof that the browser rendering is correct.

For corrective edits, use [canvas mutations](../agentcanvas/SKILL.md#mutation-mechanics); this skill does not itself authorize changing a canvas during read-only inspection.

## Persisted and rendered evidence

- Distinguish persisted state from rendered state. `canvas_get` is
  authoritative for stored elements, frames, theme, revision, and
  diagnostics. Bounded element reads plus `canvas_inspect` suffice for ordinary
  persisted-state verification. Use browser inspection when explicitly requested,
  when proving appearance, clipping, readability, or remote-media loading, or
  when an image-containing canvas must be checked for correct image display.
  Persisted references and clean diagnostics do not establish rendered success.
- Distinguish runtime facts established through discovery from repository
  guidance. Do not label architecture rules as runtime or user-facing safety facts.
- For image checks, confirm the intended stored reference and verify the
  URL/resource separately, then visually check each selected image for broken
  loading, clipping, or obstruction. Correct a failed image or report the
  unresolved result; during a demo, replace it with a working selected source
  or remove that card. Distinguish `rendered and visible` from merely persisted.
  Use permitted inspection tools; if access or authorization is unavailable,
  state what remains visually unverified and do not claim the check passed.
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

## Final QA

After the last correction, compare persisted content with the request.
Use bounded reads, or `canvas_get` when full document/theme state is needed,
and finish with `canvas_inspect`. If another mutation is necessary, repeat QA;
do not mutate after the final audit. Before saying the canvas is complete:

- confirm the expected element types and count with `canvas_list_elements`;
- run `canvas_inspect` when available and resolve every unintended warning;
- confirm titles and captions are stored exactly as intended;
- check every non-connector frame for unintended intersection and, when
  composing areas, containment within the assigned area;
- check title, Markdown, table, and image-card frames for likely clipping;
- confirm connector endpoints resolve within the same canvas;
- confirm the theme with `canvas_get` when theme state is part of the task;
- apply the [rendered-evidence requirements](#persisted-and-rendered-evidence)
  for visual, typography, and image-display claims; and
- describe only what these checks actually established.
