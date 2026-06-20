import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { createCanvasMcpHandlers } from './client';

const handlers = createCanvasMcpHandlers();
const server = new McpServer({ name: 'AgentCanvasMcp', version: '0.1.0' });

function textResult(value: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] };
}

const canvasId = z.object({ canvasId: z.string() });
const xy = { x: z.number(), y: z.number(), width: z.number().optional(), height: z.number().optional() };
const mode = { mode: z.enum(['compact', 'full']).optional() };
const endpoint = z.object({ elementId: z.string().optional(), x: z.number().optional(), y: z.number().optional(), anchor: z.enum(['center', 'top', 'right', 'bottom', 'left']).optional() });
const assetRef = z.object({ type: z.literal('asset'), project: z.string(), assetId: z.string(), assetBaseUrl: z.string().optional() });
const bboxBox = z.object({ id: z.string(), x: z.number(), y: z.number(), width: z.number(), height: z.number(), label: z.string().optional(), color: z.string().optional(), fill: z.string().optional(), strokeWidth: z.number().optional(), labelAlign: z.enum(['left', 'center', 'right']).optional(), labelVerticalAlign: z.enum(['top', 'middle', 'bottom']).optional(), labelPadding: z.number().optional(), metadata: z.record(z.string(), z.unknown()).optional() });
const overlayPath = z.object({ id: z.string(), d: z.string(), label: z.string().optional(), color: z.string().optional(), fill: z.string().optional(), strokeWidth: z.number().optional(), metadata: z.record(z.string(), z.unknown()).optional() });
const bboxOverlayInputShape = {
  ...canvasId.shape,
  id: z.string().optional(),
  layoutAssetRef: assetRef.optional(),
  imageAssetRef: assetRef.optional(),
  canvasWidth: z.number().optional(),
  canvasHeight: z.number().optional(),
  boxes: z.array(bboxBox).optional(),
  caption: z.string().optional(),
  alt: z.string().optional(),
  showLabels: z.boolean().optional(),
  background: z.string().optional(),
  ...xy,
  ...mode
};

server.registerTool('canvas_create', { description: 'Create a new AgentCanvas canvas and read-only share link.', inputSchema: { title: z.string(), project: z.string().optional(), description: z.string().optional(), conversationId: z.string().optional() } }, async (args) => textResult(await handlers.canvas_create(args)));
server.registerTool('canvas_list', { description: 'List recent AgentCanvas canvases as compact metadata summaries with element counts.', inputSchema: { project: z.string().optional(), conversationId: z.string().optional(), limit: z.number().optional() } }, async (args) => textResult(await handlers.canvas_list(args)));
server.registerTool('canvas_get', { description: 'Get a compact canvas summary by id. Pass mode=full only when the complete element payload is required.', inputSchema: { canvasId: z.string(), ...mode, elementLimit: z.number().int().nonnegative().max(500).optional() } }, async (args) => textResult(await handlers.canvas_get(args)));
server.registerTool('canvas_get_link', { description: 'Create a read-only share link for a canvas.', inputSchema: { canvasId: z.string(), label: z.string().optional() } }, async (args) => textResult(await handlers.canvas_get_link(args)));
server.registerTool('canvas_add_text', { description: 'Add or replace a text element. Returns a compact mutation acknowledgement by default; pass mode=full only when the full canvas is required.', inputSchema: { ...canvasId.shape, id: z.string().optional(), text: z.string(), ...xy, ...mode } }, async (args) => textResult(await handlers.canvas_add_text(args)));
server.registerTool('canvas_add_markdown', { description: 'Add or replace a safe Markdown element. Returns a compact mutation acknowledgement by default; pass mode=full only when the full canvas is required.', inputSchema: { ...canvasId.shape, id: z.string().optional(), markdown: z.string(), ...xy, ...mode } }, async (args) => textResult(await handlers.canvas_add_markdown(args)));
server.registerTool('canvas_place_asset', { description: 'Place an Assets-2 asset ref on a canvas. Returns a compact mutation acknowledgement by default; pass mode=full only when the full canvas is required.', inputSchema: { ...canvasId.shape, id: z.string().optional(), assetRef, caption: z.string().optional(), alt: z.string().optional(), fit: z.enum(['contain', 'cover', 'stretch', 'original']).optional(), ...xy, ...mode } }, async (args) => textResult(await handlers.canvas_place_asset(args)));
server.registerTool('canvas_place_glb_viewer', { description: 'Place a small single-GLB 3D viewer node backed by an Assets-2 GLB asset ref. Returns a compact mutation acknowledgement by default.', inputSchema: { ...canvasId.shape, id: z.string().optional(), assetRef, caption: z.string().optional(), alt: z.string().optional(), cameraControls: z.boolean().optional(), autoRotate: z.boolean().optional(), ...xy, ...mode } }, async (args) => textResult(await handlers.canvas_place_glb_viewer(args)));
server.registerTool('canvas_place_video', { description: 'Place an Assets-2 video asset ref on a canvas as a live same-origin proxied video element. Returns a compact mutation acknowledgement by default.', inputSchema: { ...canvasId.shape, id: z.string().optional(), assetRef, caption: z.string().optional(), alt: z.string().optional(), controls: z.boolean().optional(), autoplay: z.boolean().optional(), loop: z.boolean().optional(), muted: z.boolean().optional(), posterAssetRef: assetRef.optional(), ...xy, ...mode } }, async (args) => textResult(await handlers.canvas_place_video(args)));
server.registerTool('canvas_add_bbox_overlay', { description: 'Add or replace a bbox overlay visualisation node. Provide either inline canvasWidth/canvasHeight/boxes or a layoutAssetRef that points to a bbox layout asset in Assets-2. Returns a compact mutation acknowledgement by default.', inputSchema: bboxOverlayInputShape }, async (args) => textResult(await handlers.canvas_add_bbox_overlay(args)));
server.registerTool('canvas_add_bbox_overlay_from_asset', { description: 'Add or replace a bbox overlay node that reads its layout from a bbox layout asset in Assets-2. Use this when the layout should belong to an asset rather than the canvas document.', inputSchema: { ...canvasId.shape, id: z.string().optional(), layoutAssetRef: assetRef, imageAssetRef: assetRef.optional(), caption: z.string().optional(), alt: z.string().optional(), showLabels: z.boolean().optional(), background: z.string().optional(), ...xy, ...mode } }, async (args) => textResult(await handlers.canvas_add_bbox_overlay_from_asset(args)));
server.registerTool('canvas_add_path_overlay', { description: 'Add or replace a path overlay visualisation node in a fixed internal coordinate space. Returns a compact mutation acknowledgement by default.', inputSchema: { ...canvasId.shape, id: z.string().optional(), canvasWidth: z.number(), canvasHeight: z.number(), paths: z.array(overlayPath), caption: z.string().optional(), alt: z.string().optional(), showLabels: z.boolean().optional(), background: z.string().optional(), ...xy, ...mode } }, async (args) => textResult(await handlers.canvas_add_path_overlay(args)));
server.registerTool('canvas_add_line', { description: 'Add a line connector. Returns a compact mutation acknowledgement by default.', inputSchema: { ...canvasId.shape, id: z.string().optional(), from: endpoint, to: endpoint, stroke: z.string().optional(), strokeWidth: z.number().optional(), label: z.string().optional(), ...mode } }, async (args) => textResult(await handlers.canvas_add_line(args)));
server.registerTool('canvas_add_arrow', { description: 'Add an arrow connector. Returns a compact mutation acknowledgement by default.', inputSchema: { ...canvasId.shape, id: z.string().optional(), from: endpoint, to: endpoint, stroke: z.string().optional(), strokeWidth: z.number().optional(), label: z.string().optional(), ...mode } }, async (args) => textResult(await handlers.canvas_add_arrow(args)));
server.registerTool('canvas_add_table', { description: 'Add or replace a table element. Returns a compact mutation acknowledgement by default.', inputSchema: { ...canvasId.shape, id: z.string().optional(), columns: z.array(z.string()), rows: z.array(z.array(z.string())), caption: z.string().optional(), ...xy, ...mode } }, async (args) => textResult(await handlers.canvas_add_table(args)));
server.registerTool('canvas_update_element', { description: 'Patch an existing canvas element. Returns a compact mutation acknowledgement by default; pass mode=full only when the full canvas is required.', inputSchema: { ...canvasId.shape, elementId: z.string(), patch: z.record(z.string(), z.unknown()), ...mode } }, async (args) => textResult(await handlers.canvas_update_element(args)));
server.registerTool('canvas_delete_element', { description: 'Delete an existing canvas element. Returns a compact mutation acknowledgement by default; pass mode=full only when the full canvas is required.', inputSchema: { ...canvasId.shape, elementId: z.string(), ...mode } }, async (args) => textResult(await handlers.canvas_delete_element(args)));
server.registerTool('canvas_clear', { description: 'Remove all elements from a canvas. Returns a compact mutation acknowledgement by default; pass mode=full only when the full canvas is required.', inputSchema: { canvasId: z.string(), ...mode } }, async (args) => textResult(await handlers.canvas_clear(args)));
server.registerTool('canvas_get_viewport', { description: 'Get the last known user viewport and latest agent focus for a canvas. Defaults assume a 1920x900 visible browser viewport centered at 0,0.', inputSchema: { canvasId: z.string() } }, async (args) => textResult(await handlers.canvas_get_viewport(args)));
server.registerTool('canvas_set_viewport', { description: 'Move the viewer to a specific canvas center/zoom. Browser clients poll and apply this agent-controlled focus.', inputSchema: { canvasId: z.string(), centerX: z.number().optional(), centerY: z.number().optional(), zoom: z.number().optional(), width: z.number().optional(), height: z.number().optional() } }, async (args) => textResult(await handlers.canvas_set_viewport(args)));
server.registerTool('canvas_screenshot', { description: 'Render a canvas screenshot SVG and return a retrievable screenshot URL. Pass includeDataUrl=true only when inline SVG data is required. overlayNodeIds=true labels visible canvas nodes for review.', inputSchema: { canvasId: z.string(), width: z.number().optional(), height: z.number().optional(), centerX: z.number().optional(), centerY: z.number().optional(), zoom: z.number().optional(), fullCanvas: z.boolean().optional(), overlayNodeIds: z.boolean().optional(), padding: z.number().optional(), includeDataUrl: z.boolean().optional() } }, async (args) => textResult(await handlers.canvas_screenshot(args)));

const transport = new StdioServerTransport();
await server.connect(transport);
