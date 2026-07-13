import type { CanvasElement, JsonObject, SnapshotContribution, SnapshotNode } from '@agentcanvas/plugin-sdk';
import { videoData } from './data.js';

function runtimeHandle(runtime: Readonly<JsonObject> | null, key: string): string | null {
  const value = runtime?.[key];
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return typeof value.handle === 'string' ? value.handle : null;
}

export function renderVideoSnapshot(
  element: Readonly<CanvasElement>,
  runtime: Readonly<JsonObject> | null
): SnapshotContribution {
  const data = videoData(element);
  const width = typeof element.width === 'number' ? element.width : 480;
  const height = typeof element.height === 'number' ? element.height : 270;
  const posterHandle = runtimeHandle(runtime, 'poster');
  const label = data.caption ?? data.alt ?? 'Video';
  const nodes: SnapshotNode[] = [
    { kind: 'rect', x: 0, y: 0, width, height, rx: 8, fill: '#0f172a', stroke: '#334155', strokeWidth: 1 }
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
    fill: '#0f172acc',
    stroke: '#ffffff',
    strokeWidth: 2
  });
  nodes.push({
    kind: 'path',
    d: `M ${width / 2 - 7} ${height / 2 - 13} L ${width / 2 + 14} ${height / 2} L ${width / 2 - 7} ${height / 2 + 13} Z`,
    fill: '#ffffff'
  });
  nodes.push({ kind: 'rect', x: 0, y: Math.max(0, height - 36), width, height: 36, fill: '#0f172acc' });
  nodes.push({
    kind: 'text',
    x: 12,
    y: height - 13,
    text: label,
    fill: '#ffffff',
    fontFamily: 'Inter, Arial, sans-serif',
    fontSize: 14,
    fontWeight: 600,
    maxWidth: Math.max(1, width - 24)
  });
  return { space: 'frame', layer: 'content', nodes };
}
