import type { AgentCanvasServerPlugin, CanvasElement, JsonObject, ServerPluginHost } from '@agentcanvas/plugin-sdk';
import { importLegacyMarkdown } from './legacy.js';
import { addDocumentInputSchema, markdownDataSchema, markdownStyleSchema, mutationOutputSchema } from './schemas.js';
import { renderMarkdownSnapshot } from './snapshot.js';

function optionalNumber(input: JsonObject, key: string): number | null | undefined {
  const value = input[key];
  return typeof value === 'number' || value === null ? value : undefined;
}

const plugin: AgentCanvasServerPlugin = {
  activate(host: ServerPluginHost) {
    host.registerElementType({
      name: 'document',
      schemaVersion: 1,
      dataSchema: markdownDataSchema,
      styleSchema: markdownStyleSchema,
      defaultFrame: { width: 360, height: 240 },
      browser: true,
      snapshot: 'supported',
      summarize: (element) => ({
        title:
          String(element.data.markdown ?? '')
            .replace(/^#+\s*/u, '')
            .slice(0, 80) || 'Markdown'
      }),
      renderSnapshot: (element, context) => renderMarkdownSnapshot(element, context.theme)
    });
    host.registerTool({
      name: 'add-document',
      title: 'Add Markdown document',
      description:
        'Add a sanitized Markdown document to a canvas. Embedded HTTP(S) and same-origin relative images are displayed by default; set allowImages to false to keep only alt text.',
      inputSchema: addDocumentInputSchema,
      outputSchema: mutationOutputSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
      async invoke(input, context) {
        const canvasId = input.canvasId as string;
        const element: CanvasElement = {
          id: typeof input.id === 'string' ? input.id : crypto.randomUUID(),
          type: 'agentcanvas.markdown/document',
          schemaVersion: 1,
          x: input.x as number,
          y: input.y as number,
          width: optionalNumber(input, 'width') ?? 360,
          height: optionalNumber(input, 'height') ?? 240,
          data: {
            markdown: input.markdown,
            ...(typeof input.allowImages === 'boolean' ? { allowImages: input.allowImages } : {})
          }
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
      name: 'legacy-markdown-v1',
      legacyTypes: ['markdown'],
      importLegacy: (element) => importLegacyMarkdown(element)
    });
  }
};

export default plugin;
