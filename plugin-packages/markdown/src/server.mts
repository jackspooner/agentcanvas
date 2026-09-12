import type { AgentCanvasServerPlugin, CanvasElement, JsonObject, ServerPluginHost } from '@agentcanvas/plugin-sdk';
import { importLegacyMarkdown } from './legacy.js';
import { type MarkdownLayoutStyle, requiredMarkdownHeight } from './markdown.js';
import { addDocumentInputSchema, markdownDataSchema, markdownStyleSchema, mutationOutputSchema } from './schemas.js';
import { renderMarkdownSnapshot } from './snapshot.js';

const MAX_AUTO_HEIGHT = 1_200;

function optionalNumber(input: JsonObject, key: string): number | null | undefined {
  const value = input[key];
  return typeof value === 'number' || value === null ? value : undefined;
}

function layoutStyle(value: unknown): MarkdownLayoutStyle {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const style = value as JsonObject;
  return {
    ...(typeof style.fontSize === 'number' ? { fontSize: style.fontSize } : {}),
    ...(typeof style.padding === 'number' ? { padding: style.padding } : {}),
    ...(typeof style.borderWidth === 'number' ? { borderWidth: style.borderWidth } : {}),
    ...(typeof style.border === 'string' ? { border: style.border } : {})
  };
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
      inspect(element) {
        if (element.data.allowScroll === true) return [];
        const estimatedHeight = requiredMarkdownHeight(
          String(element.data.markdown ?? ''),
          element.width ?? 360,
          layoutStyle(element.style)
        );
        const actualHeight = element.height ?? 240;
        return actualHeight < estimatedHeight
          ? [
              {
                path: '/height',
                code: 'markdown_content_may_clip',
                message: `Markdown content is likely to need at least ${estimatedHeight}px at this width; current height is ${actualHeight}px. Increase height or persist data.allowScroll=true for an intentional scroller.`
              }
            ]
          : [];
      },
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
        'Add sanitized Markdown in a fixed frame. Omit height to auto-size from content, width, style, table wrapping, and images (80-1200px); content needing more than 1200px returns a clipping warning unless allowScroll=true. Explicitly smaller frames require allowScroll=true. HTTP(S) and same-origin relative images are allowed by default, but a successful mutation does not prove a remote image loaded; verify rendered output before claiming it did.',
      inputSchema: addDocumentInputSchema,
      outputSchema: mutationOutputSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
      async invoke(input, context) {
        const canvasId = input.canvasId as string;
        const markdown = input.markdown as string;
        const width = optionalNumber(input, 'width') ?? 360;
        const estimatedHeight = requiredMarkdownHeight(markdown, width, layoutStyle(input.style));
        const requestedHeight = optionalNumber(input, 'height');
        if (typeof requestedHeight === 'number' && requestedHeight < estimatedHeight && input.allowScroll !== true) {
          throw new Error(
            `Fixed Markdown frame height ${requestedHeight}px is likely to hide content; use at least ${estimatedHeight}px or set allowScroll to true for an intentional scrolling card.`
          );
        }
        const element: CanvasElement = {
          id: typeof input.id === 'string' ? input.id : crypto.randomUUID(),
          type: 'agentcanvas.markdown/document',
          schemaVersion: 1,
          x: input.x as number,
          y: input.y as number,
          width,
          height: requestedHeight ?? Math.min(MAX_AUTO_HEIGHT, estimatedHeight),
          data: {
            markdown,
            ...(typeof input.allowImages === 'boolean' ? { allowImages: input.allowImages } : {}),
            ...(typeof input.allowScroll === 'boolean' ? { allowScroll: input.allowScroll } : {})
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
        const result = await context.canvas.upsertElementReceipt(
          canvasId,
          element,
          input.expectedRevision as number | undefined
        );
        return { ...result, elementId: element.id };
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
