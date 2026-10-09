---
name: agentcanvas
description: Create, edit, inspect, and verify AgentCanvas canvases through its MCP tools. Use whenever a user asks for a canvas, board, moodboard, diagram, flowchart, visual plan, spatial comparison, canvas edit, or a truthful report of what an AgentCanvas canvas contains.
---

# AgentCanvas

This guide owns runtime discovery and canvas mutations. Use only the relevant
owner sections: [layout](../agentcanvas-layout/SKILL.md) for composition, geometry,
theme, and typography; [inspection](../agentcanvas-inspection/SKILL.md) for
read-only evidence and final QA; [demonstration](../agentcanvas-demonstration/SKILL.md)
only for a product tour. These are scoped handoffs, not a requirement to load
all four guides or recursively follow their links.

## Runtime discovery

Read `canvas_get_guidance` when provided. Discover active element and media
capabilities with compact `canvas_list_plugins`; use `canvas_get_plugin` only
when one full extension status is needed. Runtime responses and the live tool
catalog determine availability, not source folders or remembered tool names.
When a tool is omitted from the lean catalog, fetch its exact descriptor with
`canvas_get_extension_tool` and use the indicated read-only or mutating
extension dispatcher.

`canvas_create` returns a direct browser `url`; retain it for the handoff.
Use `canvas_get_url` to recover an existing canvas URL. This does not create a
read-only share link or bypass access controls.

## Canvas mutations

1. Inspect only the state needed for the edit through the
   [inspection workflow](../agentcanvas-inspection/SKILL.md#current-workflow).
   For composition or layout changes, plan frames and an explicit theme using
   [layout](../agentcanvas-layout/SKILL.md).
2. Apply the [mutation mechanics](#mutation-mechanics) below.
3. Complete the [final QA](../agentcanvas-inspection/SKILL.md#final-qa) after
   the last correction, then report the ID, URL, evidence, and remaining limits.

## Mutation mechanics

Create or edit with the most specific available tool. Use extension tools for
their owned element types and core frame/data tools for later corrections.
Read returned `inspectionSummary` counts after every mutation. For nonzero
counts, page through `canvas_inspect` and repair unintended warnings; follow
returned minimum-height diagnostics when resizing content. If an older client
does not expose response diagnostics, use `canvas_inspect` as the fallback.

## Permanent canvas deletion

Use `canvas_delete` only when the user authorizes removing whole canvases.
It permanently removes the document, events/history, share links, saved
viewports, retry receipts, macro invocations and canvas-scoped macros. External
assets/files and installation macros remain with their owners. Use
`canvas_clear` to keep the canvas and remove its elements instead.

1. Discover the live `canvas_delete` descriptor. Identify exact IDs with
   `canvas_list` and verify each target title and revision before deletion.
   Do not decide from element contents when the user requested name matching.
2. Call `canvas_delete({canvasId:"canvas_example",expectedRevision:3})` using
   the revision just read. HTTP parity is
   `DELETE /api/v1/canvases/canvas_example?expectedRevision=3`.
3. A successful MCP receipt is `{canvasId,deleted:true}`. HTTP also returns
   `ok:true`. Stale revisions return `revision_conflict`; re-read the target
   before deciding whether it still matches the authorized scope. Missing or
   already-deleted targets return `not_found` and are already absent.
4. Verify with a refreshed list and a `not_found` read. Deletion returns no
   inspection summary; do not call `canvas_inspect` on a deleted canvas.
   Report deleted IDs and any skipped/changed targets.

Transient presence, embed sessions, plans and previously issued snapshot
handles retain their existing expiry. Store-backed reads/execution fail once
the canvas is deleted. MediaTools attachments to a missing target become
superseded; deletion does not cancel or resubmit generation.

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
5. Verify the affected outputs through
   [final QA](../agentcanvas-inspection/SKILL.md#final-qa). A macro run should
   be one history/undo unit; do not claim that preview content persisted.

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
expiry. Collected references survive expiry. Verify delivery using the inspection
owner's [image-job binding checks](../agentcanvas-inspection/SKILL.md#image-job-bindings).
Operator setup is in [MediaTools extension](../../plugin-packages/mediatools/README.md).

## Development preparation

Owner work uses `npm run setup:worktree` with the installed shared DevTasks CLI.
Its adapter preserves native pinned materialization, locked workspace installation
and import readiness. `-- --legacy` invokes `npm run setup` for rollback. Verification
retains package/application/external-plugin fixtures, isolated Playwright, contract/docs
and format/lint checks, with packages before plugin distributions/catalogs. Keep Linux
root/yt-dlp mappings consistent with the dependency owner. Setup starts no canvas service
or database; browser fixtures use ports 23173–23175 and temporary state.
