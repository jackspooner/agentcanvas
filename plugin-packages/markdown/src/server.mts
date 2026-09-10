import type { AgentCanvasServerPlugin, CanvasElement, JsonObject, ServerPluginHost } from '@agentcanvas/plugin-sdk';
import { importLegacyMarkdown } from './legacy.js';
import { addDocumentInputSchema, markdownDataSchema, markdownStyleSchema, mutationOutputSchema } from './schemas.js';
import { renderMarkdownSnapshot } from './snapshot.js';

function optionalNumber(input: JsonObject, key: string): number | null | undefined {
  const value = input[key];
  return typeof value === 'number' || value === null ? value : undefined;
}

function wrappedLineCount(text: string, charactersPerLine: number): number {
  return Math.max(1, Math.ceil(Array.from(text).length / Math.max(1, charactersPerLine)));
}

function estimatedMarkdownHeight(markdown: string, width: number): number {
  const usableWidth = Math.max(80, width - 28);
  const charactersPerLine = Math.max(12, Math.floor(usableWidth / 7.5));
  let height = 28;
  for (const rawLine of markdown.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line) continue;
    if (/^\|?\s*:?-{3,}/u.test(line)) continue;
    if (/!\[[^\]]*\]\([^)]*\)/u.test(line)) {
      height += Math.min(360, Math.max(220, width * 0.6));
      continue;
    }
    if (line.includes('|')) {
      const cells = line
        .replace(/^\||\|$/gu, '')
        .split('|')
        .map((cell) => cell.trim());
      const charactersPerCell = Math.max(8, Math.floor(charactersPerLine / Math.max(1, cells.length)));
      height +=
        34 * Math.max(1, ...cells.map((cell) => wrappedLineCount(cell.replace(/[*_`]/gu, ''), charactersPerCell)));
      continue;
    }
    const visible = line.replace(/^#{1,6}\s+|^[-*+]\s+|^\d+[.)]\s+/u, '').replace(/[*_`]/gu, '');
    const wraps = wrappedLineCount(visible, charactersPerLine);
    height += line.startsWith('#') ? 38 * wraps + 6 : 26 * wraps;
  }
  return Math.min(1_200, Math.max(80, Math.ceil(height)));
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
        const estimatedHeight = estimatedMarkdownHeight(String(element.data.markdown ?? ''), element.width ?? 360);
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
        'Add sanitized Markdown in a fixed frame. Omit height to auto-size from content, width, table wrapping, and images (80-1200px); explicitly smaller frames require allowScroll=true. HTTP(S) and same-origin relative images are allowed by default, but a successful mutation does not prove a remote image loaded; verify rendered output before claiming it did.',
      inputSchema: addDocumentInputSchema,
      outputSchema: mutationOutputSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
      async invoke(input, context) {
        const canvasId = input.canvasId as string;
        const markdown = input.markdown as string;
        const width = optionalNumber(input, 'width') ?? 360;
        const estimatedHeight = estimatedMarkdownHeight(markdown, width);
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
          height: requestedHeight ?? estimatedHeight,
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
