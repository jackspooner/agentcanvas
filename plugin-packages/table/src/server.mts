import type { AgentCanvasServerPlugin, CanvasElement, JsonObject, ServerPluginHost } from '@agentcanvas/plugin-sdk';
import { importLegacyTable } from './legacy.js';
import { addTableInputSchema, mutationOutputSchema, tableDataSchema, tableStyleSchema } from './schemas.js';
import { renderTableSnapshot } from './snapshot.js';

function optionalNumber(input: JsonObject, key: string): number | null | undefined {
  const value = input[key];
  return typeof value === 'number' || value === null ? value : undefined;
}

function estimatedTableHeight(input: JsonObject, width: number): number {
  const columns: unknown[] = Array.isArray(input.columns) ? input.columns : [];
  const rows: unknown[] = Array.isArray(input.rows) ? input.rows : [];
  const columnWidth = Math.max(60, (width - 24) / Math.max(1, columns.length));
  const charactersPerLine = Math.max(8, Math.floor(columnWidth / 7));
  const bodyHeight = rows.reduce<number>((total, row) => {
    const cells: unknown[] = Array.isArray(row) ? row : [];
    const lines = Math.max(1, ...cells.map((cell) => Math.max(1, Math.ceil(String(cell).length / charactersPerLine))));
    return total + Math.max(36, lines * 20 + 16);
  }, 0);
  return Math.min(900, 52 + (typeof input.caption === 'string' && input.caption ? 44 : 0) + bodyHeight);
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
      inspect(element) {
        if (element.data.allowScroll === true) return [];
        const estimatedHeight = estimatedTableHeight(element.data as JsonObject, element.width ?? 520);
        const actualHeight = element.height ?? 220;
        return actualHeight < estimatedHeight
          ? [
              {
                path: '/height',
                code: 'table_content_may_clip',
                message: `Table content is likely to need at least ${estimatedHeight}px at this width; current height is ${actualHeight}px. Increase height or persist data.allowScroll=true for an intentional scroller.`
              }
            ]
          : [];
      },
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
      description:
        'Add a captioned string grid in a fixed frame. Omit height to auto-size from its caption, rows, width, and wrapping (up to 900px); explicitly smaller frames require allowScroll=true.',
      inputSchema: addTableInputSchema,
      outputSchema: mutationOutputSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
      async invoke(input, context) {
        const canvasId = input.canvasId as string;
        const width = optionalNumber(input, 'width') ?? 520;
        const estimatedHeight = estimatedTableHeight(input, width);
        const requestedHeight = optionalNumber(input, 'height');
        if (typeof requestedHeight === 'number' && requestedHeight < estimatedHeight && input.allowScroll !== true) {
          throw new Error(
            `Fixed table frame height ${requestedHeight}px is likely to hide rows; use at least ${estimatedHeight}px or set allowScroll to true for an intentional scrolling table.`
          );
        }
        const data: JsonObject = {
          columns: input.columns,
          rows: input.rows,
          ...(typeof input.allowScroll === 'boolean' ? { allowScroll: input.allowScroll } : {})
        };
        if (input.caption !== undefined) data.caption = input.caption;
        const element: CanvasElement = {
          id: typeof input.id === 'string' ? input.id : crypto.randomUUID(),
          type: 'agentcanvas.table/table',
          schemaVersion: 1,
          x: input.x as number,
          y: input.y as number,
          width,
          height: requestedHeight ?? estimatedHeight,
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
