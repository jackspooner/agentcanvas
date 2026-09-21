import type { CanvasElement, JsonObject } from '@agentcanvas/plugin-sdk';

export const CAROUSEL_CONTROL_HEIGHT = 44;
export const CAROUSEL_MAX_SLIDES = 50;
export const MARKDOWN_DEFAULT_WIDTH = 360;
export const MARKDOWN_DEFAULT_HEIGHT = 240;
export const CAROUSEL_DEFAULT_HEIGHT = MARKDOWN_DEFAULT_HEIGHT + CAROUSEL_CONTROL_HEIGHT;

export interface MarkdownCarouselSlide {
  id: string;
  schemaVersion: number;
  data: JsonObject;
  style?: JsonObject | null;
  metadata?: JsonObject;
  frame: {
    x: number;
    y: number;
    width?: number | null;
    height?: number | null;
    zIndex?: number | null;
    rotation?: number | null;
    opacity?: number | null;
  };
}

export interface MarkdownCarouselData {
  slides: MarkdownCarouselSlide[];
  initialIndex: number;
}

export function carouselData(value: Readonly<JsonObject>): MarkdownCarouselData {
  return value as unknown as MarkdownCarouselData;
}

export function markdownTitle(markdown: unknown): string {
  return typeof markdown === 'string' ? markdown.replace(/^#+\s*/u, '').slice(0, 80) || 'Markdown' : 'Markdown';
}

export function carouselTitle(data: MarkdownCarouselData, index = data.initialIndex): string {
  return markdownTitle((data.slides[index] ?? data.slides[0])?.data.markdown);
}

export function slideFromElement(
  element: Readonly<CanvasElement>,
  origin: { x: number; y: number }
): MarkdownCarouselSlide {
  const frame: MarkdownCarouselSlide['frame'] = { x: element.x - origin.x, y: element.y - origin.y };
  for (const key of ['width', 'height', 'zIndex', 'rotation', 'opacity'] as const) {
    if (element[key] !== undefined) frame[key] = element[key];
  }
  return {
    id: element.id,
    schemaVersion: element.schemaVersion,
    data: structuredClone(element.data),
    ...(element.style !== undefined ? { style: structuredClone(element.style) } : {}),
    ...(element.metadata !== undefined ? { metadata: structuredClone(element.metadata) } : {}),
    frame
  };
}

export function elementFromSlide(
  slide: Readonly<MarkdownCarouselSlide>,
  anchor: { x: number; y: number }
): CanvasElement {
  return {
    id: slide.id,
    type: 'agentcanvas.markdown/document',
    schemaVersion: slide.schemaVersion,
    x: anchor.x + slide.frame.x,
    y: anchor.y + slide.frame.y,
    data: structuredClone(slide.data),
    ...(slide.style !== undefined ? { style: structuredClone(slide.style) } : {}),
    ...(slide.metadata !== undefined ? { metadata: structuredClone(slide.metadata) } : {}),
    ...Object.fromEntries(
      (['width', 'height', 'zIndex', 'rotation', 'opacity'] as const).flatMap((key) =>
        slide.frame[key] === undefined ? [] : [[key, slide.frame[key]]]
      )
    )
  };
}
