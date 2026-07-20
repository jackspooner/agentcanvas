import type {
  CanvasElement,
  CanvasThemeV1,
  JsonObject,
  SnapshotContribution,
  SnapshotNode
} from '@agentcanvas/plugin-sdk';
import { DEFAULT_CANVAS_THEME } from '@agentcanvas/plugin-sdk';
import { modelData } from './data.js';

function runtimeHandle(runtime: Readonly<JsonObject> | null, key: string): string | null {
  const value = runtime?.[key];
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return typeof value.handle === 'string' ? value.handle : null;
}

export function renderModelSnapshot(
  element: Readonly<CanvasElement>,
  runtime: Readonly<JsonObject> | null,
  theme: Readonly<CanvasThemeV1> = DEFAULT_CANVAS_THEME
): SnapshotContribution {
  const data = modelData(element);
  const width = typeof element.width === 'number' ? element.width : 320;
  const height = typeof element.height === 'number' ? element.height : 240;
  const poster = runtimeHandle(runtime, 'poster');
  const label = data.caption ?? data.alt ?? '3D model';
  const style = element.style ?? {};
  const nodes: SnapshotNode[] = [
    {
      kind: 'rect',
      x: 0,
      y: 0,
      width,
      height,
      rx: typeof style.borderRadius === 'number' ? style.borderRadius : theme.shape.radius,
      fill: typeof style.background === 'string' ? style.background : theme.colors.surfaceMuted,
      stroke: typeof style.borderColor === 'string' ? style.borderColor : theme.colors.border,
      strokeWidth: typeof style.borderWidth === 'number' ? style.borderWidth : theme.shape.borderWidth
    }
  ];
  if (poster)
    nodes.push({
      kind: 'imageHandle',
      x: 0,
      y: 0,
      width,
      height,
      handle: poster,
      fit: 'cover',
      alt: data.alt ?? label
    });
  else {
    const size = Math.min(width, height) * 0.34;
    const cx = width / 2;
    const cy = height / 2 - 6;
    nodes.push({
      kind: 'path',
      d: `M ${cx} ${cy - size / 2} L ${cx + size / 2} ${cy - size / 4} L ${cx} ${cy} L ${cx - size / 2} ${cy - size / 4} Z`,
      fill: theme.colors.highlight,
      stroke: theme.colors.border,
      strokeWidth: 1
    });
    nodes.push({
      kind: 'path',
      d: `M ${cx - size / 2} ${cy - size / 4} L ${cx} ${cy} L ${cx} ${cy + size / 2} L ${cx - size / 2} ${cy + size / 4} Z`,
      fill: theme.colors.accent,
      stroke: theme.colors.border,
      strokeWidth: 1
    });
    nodes.push({
      kind: 'path',
      d: `M ${cx + size / 2} ${cy - size / 4} L ${cx} ${cy} L ${cx} ${cy + size / 2} L ${cx + size / 2} ${cy + size / 4} Z`,
      fill: theme.colors.highlightText,
      stroke: theme.colors.border,
      strokeWidth: 1
    });
  }
  nodes.push({ kind: 'rect', x: 0, y: Math.max(0, height - 36), width, height: 36, fill: theme.colors.surface });
  nodes.push({
    kind: 'text',
    x: 12,
    y: height - 13,
    text: label,
    fill: typeof style.color === 'string' ? style.color : theme.colors.text,
    fontFamily: theme.typography.bodyFont,
    fontSize: 14,
    fontWeight: 600,
    maxWidth: Math.max(1, width - 24)
  });
  return { space: 'frame', layer: 'content', nodes };
}
