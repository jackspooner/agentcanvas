import type { JsonObject } from '@agentcanvas/plugin-sdk';

/** Concise runtime guidance shared by MCP connection instructions and the discoverable guidance tool. */
export const AGENTCANVAS_AGENT_GUIDANCE: JsonObject = Object.freeze({
  schemaVersion: 1,
  workflow: [
    'Read this guidance, then call canvas_list_plugins before relying on optional element or media capabilities.',
    'Inspect an existing target with canvas_list_elements and canvas_get_element. Use canvas_get only when the complete persisted document is genuinely needed.',
    'Use canvas_list_viewers to read recently reported viewports of visible browser tabs; sessions are anonymous and expire after 30 seconds without a report.',
    'canvas_create accepts optional unlimited or fixed bounds and returns a compact receipt with the direct browser URL. Use canvas_set_bounds to change them later; a fixed size must contain every existing element frame. Give the URL to the user when appropriate; use canvas_get_url to recover it later. A direct URL does not create a public share link or bypass the host access controls.',
    'Plan element frames before composing. Mutation receipts contain only the resulting revision and diagnostic severity counts. Call canvas_inspect when any count is nonzero and repair unintended warnings immediately. Use canvas_get after a write only when the full persisted document is genuinely needed; finish with canvas_inspect and no later mutation.',
    'Use canvas_delete only for authorized permanent deletion. Read the title and revision first, pass expectedRevision, then verify absence with canvas_list and a not_found read. It removes saved history, shares, viewports, retries and canvas-scoped macros while preserving external media; use canvas_clear to keep the canvas. Deletion receipts have no inspectionSummary, and canvas_inspect is not applicable after deletion.',
    'Use rendered browser evidence for appearance and remote-image claims when browser access exists.'
  ],
  layout: [
    'x and y are the top-left corner of a fixed-size element frame in canvas world coordinates.',
    'On a fixed canvas, new or moved element frames must fit entirely inside its bounds. Missing width or height uses the host render defaults of 240 × 120; rejected writes are not clamped.',
    'Frames do not auto-grow after creation. Text and shape add tools grow height to fit estimated content unless allowClipping=true; read the persisted frame and repair overlap warnings. Set explicit widths; omit height on Markdown and table add tools to request safe initial auto-sizing. Default to showing all content; use internal scrolling only when the user requested a compact scroller or a hard space constraint requires one.',
    'Keep at least 32 world pixels between unrelated frames and reserve substantially more height for headings, lists, tables, and images.',
    'Fresh unlimited canvases open fitted to their content, but coherent compact layouts are still required.'
  ],
  text: [
    'Text and shape labels are literal text. Write Research & Planning, never Research &amp; Planning.',
    'A 32-48px title normally needs a 700-1200px wide frame. Text and shape add tools increase height when their content estimate requires it.'
  ],
  truth: [
    'A successful mutation proves persisted data only; it does not prove readability or that a remote image loaded.',
    'canvas_list_plugins is authoritative for active runtime capabilities. Use canvas_get_extension_tool and its indicated dispatcher when a tool is not directly published. Repository rules are guidance, not runtime observations.',
    'Do not claim every fact was runtime-verified when some claims came from documentation or source files.',
    'Treat words such as Verified, Confirmed, and Runtime checked as evidence claims. During an audit, keep them only when the current session can reproduce the evidence; otherwise relabel or remove them. Text already written on a canvas is not evidence for itself.',
    'When elaborating a brief, visibly label each wholly generated section in its heading or caption as Proposed or Assumption, especially tasks, budget allocations, timelines, and recommendations; do not present them as supplied facts.',
    'Use the mcpCatalog counts returned with this guidance instead of guessing the number of available tools.',
    'State what was verified and what remains unverified.'
  ]
});

export const AGENTCANVAS_MCP_INSTRUCTIONS =
  'Before creating or evaluating a canvas, use canvas_get_guidance. canvas_create accepts optional bounds and returns a compact receipt and direct browser URL; canvas_set_bounds changes bounds later, and canvas_get_url recovers the URL. Neither URL creates a share link. Discover active capabilities with canvas_list_plugins and canvas_get_extension_tool, inspect existing state with bounded element reads, set explicit non-overlapping frames within fixed bounds, inspect when mutation counts are nonzero, and finish with canvas_inspect. Use canvas_get only when the full persisted document is needed. Never treat persisted state as proof of rendered appearance or remote-image loading.';
