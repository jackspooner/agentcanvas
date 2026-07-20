import type { AgentCanvasServerPlugin, CanvasElement, JsonObject, ServerPluginHost } from '@agentcanvas/plugin-sdk';
import { importLegacyTable } from './legacy.js';
import { addTableInputSchema, mutationOutputSchema, tableDataSchema, tableStyleSchema } from './schemas.js';
import { renderTableSnapshot } from './snapshot.js';

function optionalNumber(input: JsonObject, key: string): number | null | undefined {
  const value = input[key];
  return typeof value === 'number' || value === null ? value : undefined;
}

const plugin: AgentCanvasServerPlugin = {
  activate(host: ServerPluginHost) {
    host.registerElementType({
      name: 'table',
      schemaVersion: 1,
      dataSchema: tableDataSchema,
      styleSchema: tableStyleSchema,
      defaultFrame: { width: 520, height: 220 },
      browser: true,
      snapshot: 'supported',
      validate(element) {
        const columns = Array.isArray(element.data.columns) ? element.data.columns : [];
        const rows = Array.isArray(element.data.rows) ? element.data.rows : [];
        return rows.flatMap((row, index) =>
          Array.isArray(row) && row.length > columns.length
            ? [
                {
                  path: `/data/rows/${index}`,
                  code: 'table_row_too_wide',
                  message: 'table row has more cells than columns'
                }
              ]
            : []
        );
      },
      summarize: (element) => ({
        title: typeof element.data.caption === 'string' && element.data.caption ? element.data.caption : 'Table',
        detail: `${Array.isArray(element.data.rows) ? element.data.rows.length : 0} rows`
      }),
      renderSnapshot: (element, context) => renderTableSnapshot(element, context.theme)
    });
    host.registerTool({
      name: 'add-table',
      title: 'Add table',
      description: 'Add a captioned string grid to a canvas.',
      inputSchema: addTableInputSchema,
      outputSchema: mutationOutputSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
      async invoke(input, context) {
        const canvasId = input.canvasId as string;
        const data: JsonObject = { columns: input.columns, rows: input.rows };
        if (input.caption !== undefined) data.caption = input.caption;
        const element: CanvasElement = {
          id: typeof input.id === 'string' ? input.id : crypto.randomUUID(),
          type: 'agentcanvas.table/table',
          schemaVersion: 1,
          x: input.x as number,
          y: input.y as number,
          width: optionalNumber(input, 'width') ?? 520,
          height: optionalNumber(input, 'height') ?? 220,
          data
        };
        for (const key of ['zIndex', 'rotation', 'opacity'] as const) {
          const value = optionalNumber(input, key);
          if (value !== undefined) element[key] = value;
        }
        if (typeof input.locked === 'boolean' || input.locked === null) element.locked = input.locked;
        if (input.style && typeof input.style === 'object' && !Array.isArray(input.style)) element.style = input.style;
        if (input.metadata && typeof input.metadata === 'object' && !Array.isArray(input.metadata))
          element.metadata = input.metadata;
        const result = await context.canvas.upsertElement(
          canvasId,
          element,
          input.expectedRevision as number | undefined
        );
        return { ok: true, canvasId, elementId: element.id, result };
      }
    });
    host.registerMigration({
      name: 'legacy-table-v1',
      legacyTypes: ['table'],
      importLegacy: (element) => importLegacyTable(element)
    });
  }
};

export default plugin;
