import type { CanvasElement, CanvasThemeV1, SnapshotContribution, SnapshotNode } from '@agentcanvas/plugin-sdk';
import { DEFAULT_CANVAS_THEME } from '@agentcanvas/plugin-sdk';
import {
  CAROUSEL_CONTROL_HEIGHT,
  CAROUSEL_DEFAULT_HEIGHT,
  carouselData,
  carouselTitle,
  MARKDOWN_DEFAULT_WIDTH
} from './browser/carousel.js';
import { projectMarkdown } from './markdown.js';

function styleString(element: Readonly<CanvasElement>, key: string, fallback: string): string {
  return typeof element.style?.[key] === 'string' ? String(element.style[key]) : fallback;
}

function styleNumber(element: Readonly<CanvasElement>, key: string, fallback: number): number {
  return typeof element.style?.[key] === 'number' ? Number(element.style[key]) : fallback;
}

function styleFontWeight(element: Readonly<CanvasElement>): number {
  const value = element.style?.fontWeight;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    if (value === 'bold') return 700;
    if (value === 'normal') return 400;
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return numeric;
  }
  return 400;
}

export function renderMarkdownSnapshot(
  element: Readonly<CanvasElement>,
  theme: Readonly<CanvasThemeV1> = DEFAULT_CANVAS_THEME
): SnapshotContribution {
  const width = typeof element.width === 'number' ? element.width : 360;
  const height = typeof element.height === 'number' ? element.height : 240;
  const baseSize = styleNumber(element, 'fontSize', 14);
  const padding = styleNumber(element, 'padding', 14);
  const shorthand =
    typeof element.style?.border === 'string'
      ? element.style.border.match(/^(\d+(?:\.\d+)?)px\s+(?:solid|dashed|dotted)\s+(#[0-9a-fA-F]{3,8})$/)
      : null;
  const lines = projectMarkdown(typeof element.data.markdown === 'string' ? element.data.markdown : '');
  const nodes: SnapshotNode[] = [
    {
      kind: 'rect',
      x: 0,
      y: 0,
      width,
      height,
      rx: styleNumber(element, 'borderRadius', theme.shape.radius),
      fill: styleString(element, 'background', theme.colors.surface),
      stroke: shorthand?.[2] ?? styleString(element, 'borderColor', theme.colors.border),
      strokeWidth: shorthand ? Number(shorthand[1]) : styleNumber(element, 'borderWidth', theme.shape.borderWidth)
    }
  ];
  let y = padding + 10;
  for (const line of lines) {
    const fontSize =
      line.role === 'heading' ? Math.max(baseSize + 2, baseSize + (7 - Math.max(1, line.depth)) * 1.5) : baseSize;
    if (y + fontSize > height - 10) break;
    nodes.push({
      kind: 'text',
      x: padding,
      y,
      text: line.text,
      fill: styleString(element, 'color', theme.colors.text),
      fontFamily:
        line.role === 'code'
          ? theme.typography.monoFont
          : line.role === 'heading'
            ? theme.typography.headingFont
            : styleString(element, 'fontFamily', theme.typography.bodyFont),
      fontSize,
      fontWeight: line.role === 'heading' ? 700 : styleFontWeight(element),
      maxWidth: Math.max(1, width - padding * 2)
    });
    y += fontSize + (line.role === 'heading' ? 9 : 6);
  }
  return { space: 'frame', layer: 'content', nodes };
}

export function renderMarkdownCarouselSnapshot(
  element: Readonly<CanvasElement>,
  theme: Readonly<CanvasThemeV1> = DEFAULT_CANVAS_THEME
): SnapshotContribution {
  const data = carouselData(element.data);
  const index = Math.min(data.initialIndex, data.slides.length - 1);
  const slide = data.slides[index] ?? data.slides[0];
  const width = typeof element.width === 'number' ? element.width : MARKDOWN_DEFAULT_WIDTH;
  const height = typeof element.height === 'number' ? element.height : CAROUSEL_DEFAULT_HEIGHT;
  const contentHeight = Math.max(1, height - CAROUSEL_CONTROL_HEIGHT);
  const content = renderMarkdownSnapshot(
    {
      id: slide.id,
      type: 'agentcanvas.markdown/document',
      schemaVersion: slide.schemaVersion,
      x: 0,
      y: 0,
      width,
      height: contentHeight,
      data: slide.data,
      ...(slide.style !== undefined ? { style: slide.style } : {})
    },
    theme
  );
  const title = carouselTitle(data, index);
  const footerY = height - CAROUSEL_CONTROL_HEIGHT;
  return {
    space: 'frame',
    layer: 'content',
    nodes: [
      ...content.nodes,
      {
        kind: 'rect',
        x: 0,
        y: footerY,
        width,
        height: CAROUSEL_CONTROL_HEIGHT,
        fill: theme.colors.surface,
        stroke: theme.colors.border,
        strokeWidth: theme.shape.borderWidth
      },
      {
        kind: 'text',
        x: 12,
        y: footerY + 27,
        text: title,
        fill: theme.colors.text,
        fontFamily: theme.typography.bodyFont,
        fontSize: 12,
        fontWeight: 600,
        maxWidth: Math.max(1, width - 86)
      },
      {
        kind: 'text',
        x: width - 12,
        y: footerY + 27,
        text: `${index + 1} / ${data.slides.length}`,
        fill: theme.colors.textMuted,
        fontFamily: theme.typography.bodyFont,
        fontSize: 12,
        fontWeight: 600,
        textAnchor: 'end'
      }
    ]
  };
}
