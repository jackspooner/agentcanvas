import type { CanvasThemeV1, SnapshotNode, SnapshotTextNode } from '@agentcanvas/extension-sdk';
import type { ErdData } from '../contracts.js';
import { diagramGeometry, type Bounds } from './geometry.js';

/** Vector scene shared by browser rendering and server snapshots; all appearance comes from the host theme. */
export function renderErdScene(
  data: ErdData,
  theme: Readonly<CanvasThemeV1>
): { nodes: SnapshotNode[]; bounds: Bounds } {
  const geometry = diagramGeometry(data);
  const nodes: SnapshotNode[] = [];
  const text = (
    x: number,
    y: number,
    value: string,
    maxWidth: number,
    options: Partial<SnapshotTextNode> = {}
  ): SnapshotTextNode => ({
    kind: 'text',
    x,
    y,
    text: fitText(value, maxWidth, options.fontSize ?? 12),
    maxWidth,
    fontFamily: theme.typography.bodyFont,
    fontSize: 12,
    fill: theme.colors.text,
    ...options
  });
  for (const [index, edge] of geometry.relationships.entries()) {
    const relationship = data.relationships[index];
    const children: SnapshotNode[] = edge.points.slice(1).map((point, index) => ({
      kind: 'line',
      x1: edge.points[index].x,
      y1: edge.points[index].y,
      x2: point.x,
      y2: point.y,
      stroke: theme.colors.textMuted,
      strokeWidth: 1.5,
      ...(relationship.identifying ? {} : { dash: [6, 4] })
    }));
    for (const marker of [...edge.sourceMarkers, ...edge.targetMarkers]) {
      if (marker.kind === 'line') children.push({ ...marker, stroke: theme.colors.textMuted });
      else if (marker.kind === 'ellipse')
        children.push({ ...marker, stroke: theme.colors.textMuted, fill: theme.colors.canvas });
    }
    if (relationship.label) {
      const width = Math.min(320, relationship.label.length * 7);
      children.push({
        kind: 'rect',
        x: edge.label.x - width / 2 - 6,
        y: edge.label.y - 12,
        width: width + 12,
        height: 24,
        fill: theme.colors.canvas,
        rx: 3
      });
      children.push(text(edge.label.x, edge.label.y + 4, relationship.label, width, { textAnchor: 'middle' }));
    }
    nodes.push({ kind: 'group', id: `relationship:${edge.id}`, children });
  }
  for (const [index, frame] of geometry.entities.entries()) {
    const entity = data.entities[index];
    const children: SnapshotNode[] = [
      {
        kind: 'rect',
        x: frame.x,
        y: frame.y,
        width: frame.width,
        height: frame.height,
        fill: theme.colors.surface,
        stroke: theme.colors.border,
        strokeWidth: theme.shape.borderWidth
      },
      {
        kind: 'rect',
        x: frame.x,
        y: frame.y,
        width: frame.width,
        height: frame.headerHeight,
        fill: theme.colors.highlight
      },
      text(frame.x + 12, frame.y + 23, entity.name, frame.width - 24, {
        fontSize: 14,
        fontWeight: 600,
        fontFamily: theme.typography.headingFont,
        fill: theme.colors.highlightText
      })
    ];
    if (entity.alias)
      children.push(text(frame.x + 12, frame.y + 44, entity.alias, frame.width - 24, { fill: theme.colors.textMuted }));
    if (!entity.attributes.length)
      children.push(
        text(frame.x + 12, frame.y + frame.headerHeight + 19, 'No attributes', frame.width - 24, {
          fill: theme.colors.textMuted
        })
      );
    if (frame.rows.length)
      children.push({
        kind: 'path',
        d: frame.rows.map((row) => `M ${frame.x} ${row.y} H ${frame.x + frame.width}`).join(' '),
        stroke: theme.colors.border,
        strokeWidth: theme.shape.borderWidth,
        fill: 'none'
      });
    for (const [rowIndex, row] of frame.rows.entries()) {
      const attribute = entity.attributes[rowIndex];
      const available = frame.width - 156;
      const nameWidth = available * 0.55;
      const typeWidth = available * 0.45;
      children.push({
        kind: 'group',
        id: `attribute:${entity.id}:${attribute.id}`,
        children: [
          text(frame.x + 10, row.centerY + 4, attribute.keys.join(' '), 62, {
            fontSize: 10,
            fill: theme.colors.accent,
            fontWeight: 600
          }),
          text(frame.x + 76, row.centerY + 4, attribute.name, nameWidth),
          text(frame.x + 84 + nameWidth, row.centerY + 4, attribute.dataType, typeWidth, {
            fontFamily: theme.typography.monoFont,
            fill: theme.colors.textMuted
          }),
          text(
            frame.x + frame.width - 10,
            row.centerY + 4,
            attribute.nullable === null ? '?' : attribute.nullable ? 'NULL' : 'NOT NULL',
            58,
            { textAnchor: 'end', fontSize: 10, fill: theme.colors.textMuted }
          )
        ]
      });
    }
    nodes.push({ kind: 'group', id: `entity:${entity.id}`, children });
  }
  if (data.title)
    nodes.push(
      text(geometry.bounds.x + 16, geometry.bounds.y + 25, data.title, geometry.bounds.width - 32, {
        fontSize: 18,
        fontWeight: 600,
        fontFamily: theme.typography.headingFont
      })
    );
  return { nodes, bounds: geometry.bounds };
}

function fitText(value: string, width: number, fontSize: number): string {
  const limit = Math.max(1, Math.floor(width / (fontSize * 0.7)));
  return value.length > limit ? `${value.slice(0, limit - 1).replace(/[\uD800-\uDBFF]$/, '')}…` : value;
}
