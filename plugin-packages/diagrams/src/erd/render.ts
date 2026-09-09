import type { CanvasThemeV1, SnapshotNode, SnapshotTextNode } from '@agentcanvas/extension-sdk';
import type { ErdData } from '../contracts.js';
import { type Bounds, diagramGeometry, labelWidth } from './geometry.js';

/** Browser and snapshots resolve the same optional overrides against the current host theme. */
export function renderErdScene(
  data: ErdData,
  theme: Readonly<CanvasThemeV1>
): { nodes: SnapshotNode[]; bounds: Bounds } {
  const geometry = diagramGeometry(data);
  const nodes: SnapshotNode[] = [];
  const textCount =
    data.entities.reduce(
      (sum, entity) => sum + 1 + Number(Boolean(entity.alias)) + Math.max(1, entity.attributes.length * 4),
      0
    ) +
    data.relationships.filter((edge) => edge.label).length +
    Number(Boolean(data.title));
  const textLimit = Math.floor(100000 / Math.max(1, textCount));
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
    text: fitText(value, maxWidth, options.fontSize ?? 12, textLimit),
    maxWidth,
    fontFamily: theme.typography.bodyFont,
    fontSize: 12,
    fill: theme.colors.text,
    ...options
  });
  for (const [index, edge] of geometry.relationships.entries()) {
    const relationship = data.relationships[index];
    const appearance = relationship.appearance ?? {};
    const stroke = appearance.borderColor ?? theme.colors.textMuted;
    const strokeWidth = appearance.borderWidth ?? 1.5;
    const fontSize = appearance.fontSize ?? 12;
    const borderStyle = appearance.borderStyle ?? (relationship.identifying ? 'solid' : 'dashed');
    const children: SnapshotNode[] = edge.points.slice(1).map((point, index) => ({
      kind: 'line',
      x1: edge.points[index].x,
      y1: edge.points[index].y,
      x2: point.x,
      y2: point.y,
      stroke,
      strokeWidth,
      ...(borderStyle === 'solid' ? {} : { dash: borderStyle === 'dotted' ? [2, 3] : [6, 4] })
    }));
    for (const marker of [...edge.sourceMarkers, ...edge.targetMarkers]) {
      if (marker.kind === 'line') children.push({ ...marker, stroke, strokeWidth });
      else if (marker.kind === 'ellipse') children.push({ ...marker, stroke, strokeWidth, fill: theme.colors.canvas });
    }
    if (relationship.label) {
      const width = labelWidth(relationship.label, fontSize);
      children.push({
        kind: 'rect',
        x: edge.label.x - width / 2 - 6,
        y: edge.label.y - fontSize,
        width: width + 12,
        height: fontSize * 2,
        fill: appearance.fill ?? theme.colors.canvas,
        rx: 3
      });
      children.push(
        text(edge.label.x, edge.label.y + fontSize / 3, relationship.label, width, {
          textAnchor: 'middle',
          fontSize,
          fontFamily: appearance.fontFamily ?? theme.typography.bodyFont,
          fill: appearance.textColor ?? theme.colors.text
        })
      );
    }
    nodes.push({ kind: 'group', id: `relationship:${edge.id}`, children });
  }
  for (const [index, frame] of geometry.entities.entries()) {
    const entity = data.entities[index];
    const appearance = entity.appearance ?? {};
    const fontSize = appearance.fontSize ?? 12;
    const borderStyle = appearance.borderStyle ?? 'solid';
    const children: SnapshotNode[] = [
      {
        kind: 'rect',
        x: frame.x,
        y: frame.y,
        width: frame.width,
        height: frame.height,
        fill: appearance.fill ?? theme.colors.surface,
        stroke: borderStyle === 'solid' ? (appearance.borderColor ?? theme.colors.border) : 'none',
        strokeWidth: appearance.borderWidth ?? theme.shape.borderWidth
      },
      {
        kind: 'rect',
        x: frame.x,
        y: frame.y,
        width: frame.width,
        height: frame.headerHeight,
        fill: appearance.headerFill ?? theme.colors.highlight
      },
      text(frame.x + 12, frame.y + Math.max(23, fontSize + 10), entity.name, frame.width - 24, {
        fontSize: appearance.fontSize ?? 14,
        fontWeight: 600,
        fontFamily: appearance.fontFamily ?? theme.typography.headingFont,
        fill: appearance.textColor ?? theme.colors.highlightText
      })
    ];
    if (borderStyle !== 'solid') {
      const corners = [
        [frame.x, frame.y],
        [frame.x + frame.width, frame.y],
        [frame.x + frame.width, frame.y + frame.height],
        [frame.x, frame.y + frame.height]
      ];
      for (let i = 0; i < 4; i++)
        children.push({
          kind: 'line',
          x1: corners[i][0],
          y1: corners[i][1],
          x2: corners[(i + 1) % 4][0],
          y2: corners[(i + 1) % 4][1],
          stroke: appearance.borderColor ?? theme.colors.border,
          strokeWidth: appearance.borderWidth ?? theme.shape.borderWidth,
          dash: borderStyle === 'dotted' ? [2, 3] : [6, 4]
        });
    }
    if (entity.alias)
      children.push(
        text(frame.x + 12, frame.y + frame.headerHeight - 12, entity.alias, frame.width - 24, {
          fill: appearance.textColor ?? theme.colors.textMuted,
          fontSize,
          fontFamily: appearance.fontFamily ?? theme.typography.bodyFont
        })
      );
    if (!entity.attributes.length)
      children.push(
        text(frame.x + 12, frame.y + frame.headerHeight + 19, 'No attributes', frame.width - 24, {
          fill: appearance.textColor ?? theme.colors.textMuted,
          fontSize,
          fontFamily: appearance.fontFamily ?? theme.typography.bodyFont
        })
      );
    if (frame.rows.length)
      children.push({
        kind: 'path',
        d: frame.rows.map((row) => `M ${frame.x} ${row.y} H ${frame.x + frame.width}`).join(' '),
        stroke: appearance.borderColor ?? theme.colors.border,
        strokeWidth: appearance.borderWidth ?? theme.shape.borderWidth,
        fill: 'none'
      });
    for (const [rowIndex, row] of frame.rows.entries()) {
      const attribute = entity.attributes[rowIndex];
      const { nameWidth, typeWidth } = frame;
      children.push({
        kind: 'group',
        id: `attribute:${entity.id}:${attribute.id}`,
        children: [
          text(frame.x + 10, row.centerY + 4, attribute.keys.join(' '), 62, {
            fontSize: 10,
            fill: appearance.textColor ?? theme.colors.accent,
            fontFamily: appearance.fontFamily ?? theme.typography.bodyFont,
            fontWeight: 600
          }),
          text(frame.x + 76, row.centerY + fontSize / 3, attribute.name, nameWidth, {
            fontSize,
            fill: appearance.textColor ?? theme.colors.text,
            fontFamily: appearance.fontFamily ?? theme.typography.bodyFont
          }),
          text(frame.x + 84 + nameWidth, row.centerY + 4, attribute.dataType, typeWidth, {
            fontSize,
            fontFamily: appearance.fontFamily ?? theme.typography.monoFont,
            fill: appearance.textColor ?? theme.colors.textMuted
          }),
          text(
            frame.x + frame.width - 10,
            row.centerY + 4,
            attribute.nullable === null ? '?' : attribute.nullable ? 'NULL' : 'NOT NULL',
            58,
            {
              textAnchor: 'end',
              fontSize: 10,
              fill: appearance.textColor ?? theme.colors.textMuted,
              fontFamily: appearance.fontFamily ?? theme.typography.bodyFont
            }
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

function fitText(value: string, width: number, fontSize: number, maximum = Infinity): string {
  const limit = Math.max(1, Math.min(maximum, Math.floor(width / (fontSize * 0.7))));
  return value.length > limit ? `${value.slice(0, limit - 1).replace(/[\uD800-\uDBFF]$/, '')}…` : value;
}
