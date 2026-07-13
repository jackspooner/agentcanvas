import type { CanvasElement, SnapshotContribution, SnapshotNode } from '@agentcanvas/plugin-sdk';
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

export function renderMarkdownSnapshot(element: Readonly<CanvasElement>): SnapshotContribution {
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
      rx: styleNumber(element, 'borderRadius', 10),
      fill: styleString(element, 'background', '#ffffff'),
      stroke: shorthand?.[2] ?? styleString(element, 'borderColor', '#d0d7de'),
      strokeWidth: shorthand ? Number(shorthand[1]) : styleNumber(element, 'borderWidth', 1)
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
      fill: styleString(element, 'color', '#0f172a'),
      fontFamily:
        line.role === 'code'
          ? 'ui-monospace, monospace'
          : styleString(element, 'fontFamily', 'Inter, Arial, sans-serif'),
      fontSize,
      fontWeight: line.role === 'heading' ? 700 : styleFontWeight(element),
      maxWidth: Math.max(1, width - padding * 2)
    });
    y += fontSize + (line.role === 'heading' ? 9 : 6);
  }
  return { space: 'frame', layer: 'content', nodes };
}
