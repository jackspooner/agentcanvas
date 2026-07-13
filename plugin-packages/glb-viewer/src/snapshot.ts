import type { CanvasElement, JsonObject, SnapshotContribution, SnapshotNode } from '@agentcanvas/plugin-sdk';
import { modelData } from './data.js';

function runtimeHandle(runtime: Readonly<JsonObject> | null, key: string): string | null {
  const value = runtime?.[key];
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return typeof value.handle === 'string' ? value.handle : null;
}

export function renderModelSnapshot(
  element: Readonly<CanvasElement>,
  runtime: Readonly<JsonObject> | null
): SnapshotContribution {
  const data = modelData(element);
  const width = typeof element.width === 'number' ? element.width : 320;
  const height = typeof element.height === 'number' ? element.height : 240;
  const poster = runtimeHandle(runtime, 'poster');
  const label = data.caption ?? data.alt ?? '3D model';
  const nodes: SnapshotNode[] = [
    { kind: 'rect', x: 0, y: 0, width, height, rx: 8, fill: '#e2e8f0', stroke: '#94a3b8', strokeWidth: 1 }
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
      fill: '#94a3b8',
      stroke: '#475569',
      strokeWidth: 1
    });
    nodes.push({
      kind: 'path',
      d: `M ${cx - size / 2} ${cy - size / 4} L ${cx} ${cy} L ${cx} ${cy + size / 2} L ${cx - size / 2} ${cy + size / 4} Z`,
      fill: '#64748b',
      stroke: '#475569',
      strokeWidth: 1
    });
    nodes.push({
      kind: 'path',
      d: `M ${cx + size / 2} ${cy - size / 4} L ${cx} ${cy} L ${cx} ${cy + size / 2} L ${cx + size / 2} ${cy + size / 4} Z`,
      fill: '#475569',
      stroke: '#334155',
      strokeWidth: 1
    });
  }
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
