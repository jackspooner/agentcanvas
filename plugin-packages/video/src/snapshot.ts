import type {
  CanvasElement,
  CanvasThemeV1,
  JsonObject,
  SnapshotContribution,
  SnapshotNode
} from '@agentcanvas/plugin-sdk';
import { DEFAULT_CANVAS_THEME } from '@agentcanvas/plugin-sdk';
import { videoData } from './data.js';

function runtimeHandle(runtime: Readonly<JsonObject> | null, key: string): string | null {
  const value = runtime?.[key];
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return typeof value.handle === 'string' ? value.handle : null;
}

export function renderVideoSnapshot(
  element: Readonly<CanvasElement>,
  runtime: Readonly<JsonObject> | null,
  theme: Readonly<CanvasThemeV1> = DEFAULT_CANVAS_THEME
): SnapshotContribution {
  const data = videoData(element);
  const width = typeof element.width === 'number' ? element.width : 480;
  const height = typeof element.height === 'number' ? element.height : 270;
  const posterHandle = runtimeHandle(runtime, 'poster');
  const label = data.caption ?? data.alt ?? 'Video';
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
  if (posterHandle)
    nodes.push({
      kind: 'imageHandle',
      x: 0,
      y: 0,
      width,
      height,
      handle: posterHandle,
      fit: 'cover',
      alt: data.alt ?? label
    });
  nodes.push({
    kind: 'ellipse',
    cx: width / 2,
    cy: height / 2,
    rx: 28,
    ry: 28,
    fill: theme.colors.accent,
    stroke: theme.colors.accentText,
    strokeWidth: 2
  });
  nodes.push({
    kind: 'path',
    d: `M ${width / 2 - 7} ${height / 2 - 13} L ${width / 2 + 14} ${height / 2} L ${width / 2 - 7} ${height / 2 + 13} Z`,
    fill: theme.colors.accentText
  });
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
