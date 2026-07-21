import type { JsonObject } from '@agentcanvas/plugin-sdk';

/** Concise runtime guidance shared by MCP connection instructions and the discoverable guidance tool. */
export const AGENTCANVAS_AGENT_GUIDANCE: JsonObject = Object.freeze({
  schemaVersion: 1,
  workflow: [
    'Read this guidance, then call canvas_list_plugins before relying on optional element or media capabilities.',
    'Inspect an existing target with canvas_get before editing it.',
    'canvas_create returns the direct browser URL. Give that URL to the user when appropriate; use canvas_get_url to recover it later. A direct URL does not create a public share link or bypass the host access controls.',
    'Plan element frames before composing. After every core mutation, read the returned diagnostics and inspectionSummary and repair unintended warnings immediately. The final tool sequence before reporting must be canvas_get then canvas_inspect with no later mutation.',
    'Use rendered browser evidence for appearance and remote-image claims when browser access exists.'
  ],
  layout: [
    'x and y are the top-left corner of a fixed-size element frame in canvas world coordinates.',
    'Frames do not auto-grow after creation. Set explicit widths; omit height on Markdown and table add tools to request safe initial auto-sizing. Default to showing all content; use internal scrolling only when the user requested a compact scroller or a hard space constraint requires one.',
    'Keep at least 32 world pixels between unrelated frames and reserve substantially more height for headings, lists, tables, and images.',
    'Fresh unlimited canvases open fitted to their content, but coherent compact layouts are still required.'
  ],
  text: [
    'Text and shape labels are literal text. Write Research & Planning, never Research &amp; Planning.',
    'A 32-48px title normally needs a 700-1200px wide frame and at least 72px of height.'
  ],
  truth: [
    'A successful mutation proves persisted data only; it does not prove readability or that a remote image loaded.',
    'canvas_list_plugins is authoritative for active runtime capabilities. Repository rules are guidance, not runtime observations.',
    'Do not claim every fact was runtime-verified when some claims came from documentation or source files.',
    'Treat words such as Verified, Confirmed, and Runtime checked as evidence claims. During an audit, keep them only when the current session can reproduce the evidence; otherwise relabel or remove them. Text already written on a canvas is not evidence for itself.',
    'When elaborating a brief, visibly label each wholly generated section in its heading or caption as Proposed or Assumption, especially tasks, budget allocations, timelines, and recommendations; do not present them as supplied facts.',
    'Use the mcpCatalog counts returned with this guidance instead of guessing the number of available tools.',
    'State what was verified and what remains unverified.'
  ]
});

export const AGENTCANVAS_MCP_INSTRUCTIONS =
  'Before creating or evaluating a canvas, use canvas_get_guidance. canvas_create returns a direct browser URL and canvas_get_url recovers one later; neither creates a share link. Discover active capabilities with canvas_list_plugins, set explicit non-overlapping frames, read post-mutation diagnostics immediately, then finish with canvas_get and canvas_inspect. Never treat persisted state as proof of rendered appearance or remote-image loading.';
