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
const endpoint = z.object({ elementId: z.string().optional(), x: z.number().optional(), y: z.number().optional(), anchor: z.enum(['center', 'top', 'right', 'bottom', 'left']).optional() });
const assetRef = z.object({ type: z.literal('asset'), project: z.string(), assetId: z.string(), assetBaseUrl: z.string().optional() });

server.registerTool('canvas_create', { description: 'Create a new AgentCanvas canvas and read-only share link.', inputSchema: { title: z.string(), project: z.string().optional(), description: z.string().optional(), conversationId: z.string().optional() } }, async (args) => textResult(await handlers.canvas_create(args)));
server.registerTool('canvas_list', { description: 'List recent AgentCanvas canvases.', inputSchema: { project: z.string().optional(), conversationId: z.string().optional(), limit: z.number().optional() } }, async (args) => textResult(await handlers.canvas_list(args)));
server.registerTool('canvas_get', { description: 'Get a canvas by id.', inputSchema: { canvasId: z.string() } }, async (args) => textResult(await handlers.canvas_get(args)));
server.registerTool('canvas_get_link', { description: 'Create a read-only share link for a canvas.', inputSchema: { canvasId: z.string(), label: z.string().optional() } }, async (args) => textResult(await handlers.canvas_get_link(args)));
server.registerTool('canvas_add_text', { description: 'Add or replace a text element.', inputSchema: { ...canvasId.shape, id: z.string().optional(), text: z.string(), ...xy } }, async (args) => textResult(await handlers.canvas_add_text(args)));
server.registerTool('canvas_add_markdown', { description: 'Add or replace a safe Markdown element.', inputSchema: { ...canvasId.shape, id: z.string().optional(), markdown: z.string(), ...xy } }, async (args) => textResult(await handlers.canvas_add_markdown(args)));
server.registerTool('canvas_place_asset', { description: 'Place an Assets-2 asset ref on a canvas.', inputSchema: { ...canvasId.shape, id: z.string().optional(), assetRef, caption: z.string().optional(), alt: z.string().optional(), fit: z.enum(['contain', 'cover', 'stretch', 'original']).optional(), ...xy } }, async (args) => textResult(await handlers.canvas_place_asset(args)));
server.registerTool('canvas_place_glb_viewer', { description: 'Place a small single-GLB 3D viewer node backed by an Assets-2 GLB asset ref.', inputSchema: { ...canvasId.shape, id: z.string().optional(), assetRef, caption: z.string().optional(), alt: z.string().optional(), cameraControls: z.boolean().optional(), autoRotate: z.boolean().optional(), ...xy } }, async (args) => textResult(await handlers.canvas_place_glb_viewer(args)));
server.registerTool('canvas_add_line', { description: 'Add a line connector.', inputSchema: { ...canvasId.shape, id: z.string().optional(), from: endpoint, to: endpoint, stroke: z.string().optional(), strokeWidth: z.number().optional(), label: z.string().optional() } }, async (args) => textResult(await handlers.canvas_add_line(args)));
server.registerTool('canvas_add_arrow', { description: 'Add an arrow connector.', inputSchema: { ...canvasId.shape, id: z.string().optional(), from: endpoint, to: endpoint, stroke: z.string().optional(), strokeWidth: z.number().optional(), label: z.string().optional() } }, async (args) => textResult(await handlers.canvas_add_arrow(args)));
server.registerTool('canvas_add_table', { description: 'Add or replace a table element.', inputSchema: { ...canvasId.shape, id: z.string().optional(), columns: z.array(z.string()), rows: z.array(z.array(z.string())), caption: z.string().optional(), ...xy } }, async (args) => textResult(await handlers.canvas_add_table(args)));
server.registerTool('canvas_update_element', { description: 'Patch an existing canvas element.', inputSchema: { ...canvasId.shape, elementId: z.string(), patch: z.record(z.string(), z.unknown()) } }, async (args) => textResult(await handlers.canvas_update_element(args)));
server.registerTool('canvas_delete_element', { description: 'Delete a canvas element.', inputSchema: { ...canvasId.shape, elementId: z.string() } }, async (args) => textResult(await handlers.canvas_delete_element(args)));
server.registerTool('canvas_clear', { description: 'Remove all elements from a canvas.', inputSchema: { canvasId: z.string() } }, async (args) => textResult(await handlers.canvas_clear(args)));
server.registerTool('canvas_get_viewport', { description: 'Get the last known user viewport and latest agent focus for a canvas. Defaults assume a 1920x900 visible browser viewport centered at 0,0.', inputSchema: { canvasId: z.string() } }, async (args) => textResult(await handlers.canvas_get_viewport(args)));
server.registerTool('canvas_set_viewport', { description: 'Move the viewer to a specific canvas center/zoom. Browser clients poll and apply this agent-controlled focus.', inputSchema: { canvasId: z.string(), centerX: z.number().optional(), centerY: z.number().optional(), zoom: z.number().optional(), width: z.number().optional(), height: z.number().optional() } }, async (args) => textResult(await handlers.canvas_set_viewport(args)));
server.registerTool('canvas_screenshot', { description: 'Render a canvas screenshot SVG and return a data URL plus a retrievable screenshot URL. overlayNodeIds=true labels visible canvas nodes for review.', inputSchema: { canvasId: z.string(), width: z.number().optional(), height: z.number().optional(), centerX: z.number().optional(), centerY: z.number().optional(), zoom: z.number().optional(), fullCanvas: z.boolean().optional(), overlayNodeIds: z.boolean().optional(), padding: z.number().optional() } }, async (args) => textResult(await handlers.canvas_screenshot(args)));

const transport = new StdioServerTransport();
await server.connect(transport);
