---
name: agentcanvas-demonstration
description: Create a polished, interactive-looking AgentCanvas showcase for a first-time user. Use when someone asks to demonstrate, tour, introduce, showcase, or explain what AgentCanvas can do through a real canvas; assume a fresh default install and verify only capabilities exposed by the active runtime.
---

# AgentCanvas Demonstration

Create one attractive demonstration canvas that teaches by showing. The result
should feel like a small product tour, not a random test board: clear hierarchy,
spacious layout, a few contrasting element types, and a truthful handoff that
explains what was persisted and what was visually checked.

Use the `agentcanvas` skill for the underlying canvas mutation, inspection,
diagnostic, coordinate, and truth-discipline rules. This skill adds the
demonstration narrative and default-install selection logic.

## Demonstration promise

Show the new user these capabilities when the active runtime supports them:

1. A structured canvas with a title, subtitle, sections, and a coherent theme.
2. Core text, shapes, and connectors arranged as a simple agent workflow.
3. A Markdown card for richer explanatory content.
4. A table for compact structured comparison.
5. Image cards sourced from the user or image search, when available.
6. Agent-facing persistence and diagnostics: create, inspect, repair, and report
   a direct canvas URL.
7. Host-owned macros when the generic macro tools are present: create or use a
   tiny versioned definition, preview it, then execute it as one atomic action.

Do not claim that a capability is available because it exists in documentation
or source folders. First call `canvas_get_guidance` and `canvas_list_plugins`,
then adapt to the returned active registry. A default install normally includes
the core canvas plus the standard Markdown, primitives, table, overlay, video,
GLB, and image-source extensions, but the runtime response is authoritative.

## Walkthrough workflow

### 1. Discover and set expectations

- Read `canvas_get_guidance` if available.
- Call `canvas_list_plugins` and record active element types, tools, and
  diagnostics capabilities.
- Start a new canvas unless the user supplied an existing canvas to tour.
- Ask the user for two to four images they would like displayed, or ask for a
  visual theme if they do not have specific images. If they provide local files,
  URLs, or asset references, use those references according to the active
  runtime contract. If they do not provide images or prefer the agent to choose,
  use the available web/image search tools to find a small, coherent set of
  suitable image URLs. Do not silently invent image sources.
- Explain internally that this is a demonstration board and that generated copy
  is illustrative, not product documentation or researched fact.

### 2. Compose the board

Use a dark, high-contrast semantic theme unless the user requests another style.
For a fresh unlimited canvas, compose around the origin with roughly these
regions:

```text
Title:       x=-620, y=-390, width=1220, height=90
Core canvas: x=-620, y=-220, width=380, height=360
Rich cards:  x=-200, y=-220, width=380, height=360
Structured:  x=220,  y=-220, width=380, height=360
Workflow:    x=-620, y=190,  width=1220, height=260
```

Keep at least 32 world pixels between unrelated frames. Adjust frames to the
actual content and returned minimum-height diagnostics; these coordinates are
only a starting composition.

Create the following content, adapting element types to the active registry:

- Title text: `AgentCanvas in 5 minutes`.
- Subtitle text: `A durable visual workspace for agents and people`.
- Core canvas card: concise copy explaining that canvases hold spatial elements,
  frames, revisions, themes, and diagnostics.
- Rich cards card: Markdown with three short sections - `Explain`, `Organize`,
  and `Review` - and one sentence each. Keep it short enough to display without
  scrolling.
- Structured card: a small table with columns `Capability`, `What it shows`,
  and `Proof`. Use statements such as `Canvas state / persisted elements /
  canvas_get`; label any product opinions as `Demonstration` rather than fact.
- Image gallery: add one Markdown element per selected image, with a concise
  title and caption identifying the source as `User-supplied` or `Web search`.
  Use `allowImages: true` only for the selected image URLs. Keep image cards
  separate from explanatory Markdown so each image has a readable frame.
- Workflow strip: four concise nodes - `Ask`, `Compose`, `Inspect`, `Iterate` -
  connected left to right. Create nodes first, retain their returned IDs, then
  create connectors using only those IDs.
- Footer or callout: `The agent can create it. The person can see it. Both can
  inspect what is actually there.`

Prefer core text and shapes when a richer extension is absent. Do not make the
demo depend on Assets-2 or a media provider. For web-found images, preserve the
source URL and mention that the Markdown card is a remote reference, not a
copied durable asset; do not use suspicious, inaccessible, or private URLs.
Respect the image search tool's licensing/source information and avoid claiming
ownership or permanence. If no suitable image can be found, continue with a
text-only demonstration and say so.

### Image verification

An image element persisted in the canvas does not prove that the image loaded.
When the demonstration contains images:

1. Read the mutation diagnostics and confirm the Markdown element contains the
   intended image reference without exposing binary data or data URLs.
2. Open the returned canvas URL in the available browser surface and visually
   confirm each selected image is present, not broken, clipped, or obscured.
3. If an image fails, replace it with a working selected URL or remove that card;
   never report a broken remote image as demonstrated capability.
4. Record the visual check in the final handoff and distinguish `rendered and
   visible` from merely `persisted as Markdown`.

### 3. Optional macro moment

If `macro_list`, `macro_create`, `macro_plan`, and `canvas_run_macro` are active,
use them to show the plan-first workflow in a small, safe area of the same
canvas. Discover the exact schemas before constructing requests. The macro
should create one or two plainly labeled demonstration elements, for example a
`Macro-created card`, with no external calls or sensitive inputs.

- Create or select an exact immutable macro version.
- Plan it with an explicit anchor and typed input.
- Show the plan's preview/effect summary in the agent narration; do not claim
  the preview is persisted.
- Execute with the returned plan ID, current `expectedRevision`, and a bounded
  idempotency key.
- Re-read the canvas and inspect diagnostics after execution.

Skip this section if the tools are unavailable or if the user asked for a
minimal tour. Report the omission rather than inventing a macro result.

### 4. Verify like a product demo

After every mutation, read returned diagnostics and inspection summaries and fix
unintended warnings immediately. At the end:

1. Call `canvas_get` and verify the expected element types, labels, frames,
   theme, revision, and any macro-created elements.
2. Call `canvas_inspect` when available and resolve unintended diagnostics.
3. If a browser/canvas URL is available, use it for the user-facing handoff.
   Persisted state proves storage, not visual readability; perform a browser
   check when the user explicitly asked to see the result or when visual
   appearance is part of the demonstration promise.
4. Make `canvas_get` followed by `canvas_inspect` the final canvas operations;
   do not mutate after final QA.

## Handoff

Keep the final response short and concrete:

- Give the canvas ID and direct browser URL.
- Name the capabilities actually demonstrated, based on the runtime response.
- State what was verified: persisted elements, revision, theme, diagnostics,
  and optionally rendered appearance.
- Call out limitations, such as skipped optional extensions or an unperformed
  browser visual check.

Never say "everything works" from a successful mutation alone. Say exactly what
the final `canvas_get`, `canvas_inspect`, and any browser check established.
