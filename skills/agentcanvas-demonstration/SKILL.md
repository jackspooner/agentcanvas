---
name: agentcanvas-demonstration
description: Create a polished, interactive-looking AgentCanvas showcase for a first-time user. Use when someone asks to demonstrate, tour, introduce, showcase, or explain what AgentCanvas can do through a real canvas; assume a fresh default install and verify only capabilities exposed by the active runtime.
---

# AgentCanvas Demonstration

Create one attractive demonstration canvas that teaches by showing. The result
should feel like a small product tour, not a random test board: clear hierarchy,
spacious layout, a few contrasting element types, and a truthful handoff that
explains what was persisted and what was visually checked.

This guide owns the tour narrative and capability selection. Use the base
[discovery](../agentcanvas/SKILL.md#runtime-discovery) and
[mutation](../agentcanvas/SKILL.md#canvas-mutations) sections for operations,
[layout](../agentcanvas-layout/SKILL.md) for composition, and
[inspection QA](../agentcanvas-inspection/SKILL.md#final-qa) for evidence.
Read the scoped sections needed for the tour, without reloading their callers.

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

Adapt this promise to the active runtime established through base discovery.
Optional extensions may be absent even when their source is installed.

## Walkthrough workflow

### 1. Discover and set expectations

- Use [runtime discovery](../agentcanvas/SKILL.md#runtime-discovery) to select
  the element types and capabilities the tour can actually demonstrate.
- Start a new canvas unless the user supplied an existing canvas to tour.
- Ask the user for two to four images they would like displayed, or ask for a
  visual theme if they do not have specific images. If they provide local files,
  URLs, or image-source references advertised by the active runtime, use them
  according to that runtime contract. If they do not provide images or prefer
  the agent to choose, use the available web/image search tools to find a small,
  coherent set of
  suitable image URLs. Do not silently invent image sources.
- Explain internally that this is a demonstration board and that generated copy
  is illustrative, not product documentation or researched fact.

### 2. Compose the board

Apply the [layout guide](../agentcanvas-layout/SKILL.md): an explicit theme,
readable typography, and a 16:9 area centered on the origin for an unlimited
canvas. Plan a title, three teaching regions (core canvas, rich cards, structured
data), and a workflow strip. Fit their frames to content using the layout
owner’s sizing rules; add an image region when suitable sources are available.

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

Prefer core text and shapes when a richer extension is absent. For web-found
images, preserve the source URL and mention that the Markdown card is a remote
reference, not a copied durable asset; do not use suspicious, inaccessible, or private URLs.
Respect the image search tool's licensing/source information and avoid claiming
ownership or permanence. If no suitable image can be found, continue with a
text-only demonstration and say so.

Image cards make image-display verification part of this tour's promise.
Apply the inspection owner’s [image evidence requirements](../agentcanvas-inspection/SKILL.md#persisted-and-rendered-evidence)
and record the result in the handoff.

### 3. Optional macro moment

If `macro_list`, `macro_create`, `macro_plan`, and `canvas_run_macro` are active,
use them to show the plan-first workflow in a small, safe area of the same
canvas. Discover the exact schemas before constructing requests. The macro
should create one or two plainly labeled demonstration elements, for example a
`Macro-created card`, with no external calls or sensitive inputs.

Follow the base [macro workflow](../agentcanvas/SKILL.md#macro-workflow).
Narrate the plan's preview/effect summary, then show the persisted result after
execution so the user can understand the distinction.

Skip this section if the tools are unavailable or if the user asked for a
minimal tour. Report the omission rather than inventing a macro result.

### 4. Verify like a product demo

Apply [final QA](../agentcanvas-inspection/SKILL.md#final-qa) to the promised
capabilities, including the persisted theme and any macro-created elements.
Rendered appearance is part of a visual tour; follow the inspection owner’s
browser/image evidence requirements and report any unavailable check.

## Handoff

Keep the final response short and concrete:

- Give the canvas ID and direct browser URL.
- Name the capabilities actually demonstrated, based on the runtime response.
- State what was verified: persisted elements, revision, theme, diagnostics,
  and optionally rendered appearance.
- Call out limitations, such as skipped optional extensions or an unperformed
  browser visual check.

Keep handoff claims within the inspection evidence collected for this tour.
