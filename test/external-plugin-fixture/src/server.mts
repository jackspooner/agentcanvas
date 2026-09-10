import type { AgentCanvasServerPlugin, CanvasElement, LegacyElementImportResult, SnapshotContribution } from '@agentcanvas/plugin-sdk';
import { dataSchema, procedureInputSchema, procedureOutputSchema, toolInputSchema, toolOutputSchema } from './contracts.js';

const type = 'external.signal-card/signal-card';
function string(value: unknown, field: string): string {
  if (typeof value !== 'string') throw new Error(`${field} must be a string.`);
  return value;
}
export function snapshot(element: Readonly<CanvasElement>): SnapshotContribution {
  const active = element.data.status === 'active';
  return { space: 'frame', layer: 'content', nodes: [
    { kind: 'rect', x: 0, y: 0, width: element.width ?? 240, height: element.height ?? 100, rx: 10, fill: '#ffffff', stroke: active ? '#16a34a' : '#7c3aed', strokeWidth: 3 },
    { kind: 'text', x: 16, y: 34, text: string(element.data.label, 'label'), fill: '#111827', fontSize: 20, fontWeight: 700 }
  ] };
}
export function importLegacy(element: Readonly<Record<string, unknown>>): LegacyElementImportResult {
  return { element: {
    id: string(element.id, 'id'), type, schemaVersion: 1,
    x: typeof element.x === 'number' ? element.x : 0, y: typeof element.y === 'number' ? element.y : 0,
    width: 240, height: 100,
    data: { label: string(element.label, 'label'), status: string(element.status, 'status') }
  } };
}
const plugin: AgentCanvasServerPlugin = { activate(host) {
  host.registerElementType({
    name: 'signal-card', schemaVersion: 1, dataSchema, defaultFrame: { width: 240, height: 100 },
    browser: true, snapshot: 'supported',
    summarize: (element) => ({ title: string(element.data.label, 'label'), detail: string(element.data.status, 'status') }),
    renderSnapshot: snapshot
  });
  host.registerTool({
    name: 'add-signal-card', title: 'Add Signal Card', description: 'Adds an external fixture signal card.',
    inputSchema: toolInputSchema, outputSchema: toolOutputSchema,
    async invoke(input, context) {
      const element: CanvasElement = { id: string(input.id, 'id'), type, schemaVersion: 1, x: 0, y: 0, width: 240, height: 100,
        data: { label: string(input.label, 'label'), status: string(input.status, 'status') } };
      return { receipt: await context.canvas.upsertElementReceipt(string(input.canvasId, 'canvasId'), element) };
    }
  });
  host.registerProcedure({
    name: 'summarize-signal', description: 'Summarizes signal data.', inputSchema: procedureInputSchema, outputSchema: procedureOutputSchema,
    async invoke(input) { return { summary: `${string(input.label, 'label')} is ${string(input.status, 'status')}` }; }
  });
  host.registerMigration({ name: 'legacy-signal-card-v1', legacyTypes: ['signalCard'], importLegacy });
} };
export default plugin;
