import type {
  AgentCanvasServerPlugin,
  CanvasElement,
  JsonObject,
  PluginValidationIssue,
  ServerPluginHost
} from '@agentcanvas/plugin-sdk';
import { PluginValidationError } from '@agentcanvas/plugin-sdk';
import {
  CAROUSEL_CONTROL_HEIGHT,
  CAROUSEL_DEFAULT_HEIGHT,
  carouselData,
  carouselTitle,
  MARKDOWN_DEFAULT_HEIGHT,
  MARKDOWN_DEFAULT_WIDTH,
  markdownTitle
} from './browser/carousel.js';
import { importLegacyMarkdown } from './legacy.js';
import { type MarkdownLayoutStyle, requiredMarkdownHeight } from './markdown.js';
import {
  addDocumentInputSchema,
  markdownCarouselDataSchema,
  markdownDataSchema,
  markdownStyleSchema,
  mutationOutputSchema
} from './schemas.js';
import { renderMarkdownCarouselSnapshot, renderMarkdownSnapshot } from './snapshot.js';

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

function markdownInspection(
  markdown: string,
  allowScroll: unknown,
  width: number,
  height: number,
  style: unknown,
  path = '/height',
  code = 'markdown_content_may_clip'
): PluginValidationIssue[] {
  if (allowScroll === true) return [];
  const estimatedHeight = requiredMarkdownHeight(markdown, width, layoutStyle(style));
  return height < estimatedHeight
    ? [
        {
          path,
          code,
          message: `Markdown content is likely to need at least ${estimatedHeight}px at this width; current height is ${height}px. Increase height or persist data.allowScroll=true for an intentional scroller.`
        }
      ]
    : [];
}

const plugin: AgentCanvasServerPlugin = {
  activate(host: ServerPluginHost) {
    host.registerElementType({
      name: 'document',
      schemaVersion: 1,
      dataSchema: markdownDataSchema,
      styleSchema: markdownStyleSchema,
      defaultFrame: { width: MARKDOWN_DEFAULT_WIDTH, height: MARKDOWN_DEFAULT_HEIGHT },
      browser: true,
      snapshot: 'supported',
      inspect: (element) =>
        markdownInspection(
          String(element.data.markdown ?? ''),
          element.data.allowScroll,
          element.width ?? MARKDOWN_DEFAULT_WIDTH,
          element.height ?? MARKDOWN_DEFAULT_HEIGHT,
          element.style
        ),
      summarize: (element) => ({ title: markdownTitle(element.data.markdown) }),
      renderSnapshot: (element, context) => renderMarkdownSnapshot(element, context.theme)
    });
    host.registerElementType({
      name: 'carousel',
      schemaVersion: 1,
      dataSchema: markdownCarouselDataSchema,
      defaultFrame: { width: MARKDOWN_DEFAULT_WIDTH, height: CAROUSEL_DEFAULT_HEIGHT },
      browser: true,
      snapshot: 'supported',
      validate(element) {
        const data = carouselData(element.data);
        const issues: PluginValidationIssue[] = [];
        const seen = new Set<string>();
        data.slides.forEach((slide, index) => {
          if (seen.has(slide.id)) {
            issues.push({
              path: `/data/slides/${index}/id`,
              code: 'markdown_carousel_slide_id_duplicate',
              message: 'Markdown carousel slide IDs must be unique.'
            });
          }
          seen.add(slide.id);
        });
        if (data.initialIndex >= data.slides.length) {
          issues.push({
            path: '/data/initialIndex',
            code: 'markdown_carousel_initial_index_invalid',
            message: 'Markdown carousel initialIndex must identify an existing slide.'
          });
        }
        return issues;
      },
      inspect(element) {
        const data = carouselData(element.data);
        const width = element.width ?? MARKDOWN_DEFAULT_WIDTH;
        const height = Math.max(1, (element.height ?? CAROUSEL_DEFAULT_HEIGHT) - CAROUSEL_CONTROL_HEIGHT);
        return data.slides.flatMap((slide, index) =>
          markdownInspection(
            String(slide.data.markdown ?? ''),
            slide.data.allowScroll,
            width,
            height,
            slide.style,
            `/data/slides/${index}`,
            'markdown_carousel_slide_may_clip'
          )
        );
      },
      summarize(element) {
        const data = carouselData(element.data);
        return {
          title: carouselTitle(data),
          detail: `${data.slides.length} Markdown cards`
        };
      },
      renderSnapshot: (element, context) => renderMarkdownCarouselSnapshot(element, context.theme)
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
        const width = optionalNumber(input, 'width') ?? MARKDOWN_DEFAULT_WIDTH;
        const estimatedHeight = requiredMarkdownHeight(markdown, width, layoutStyle(input.style));
        const requestedHeight = optionalNumber(input, 'height');
        if (typeof requestedHeight === 'number' && requestedHeight < estimatedHeight && input.allowScroll !== true) {
          throw new PluginValidationError(
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
