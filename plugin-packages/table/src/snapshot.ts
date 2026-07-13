import type { CanvasElement, SnapshotContribution, SnapshotNode } from '@agentcanvas/plugin-sdk';
import { tableData } from './data.js';

function styleString(element: Readonly<CanvasElement>, key: string, fallback: string): string {
  return typeof element.style?.[key] === 'string' ? String(element.style[key]) : fallback;
}

function styleNumber(element: Readonly<CanvasElement>, key: string, fallback: number): number {
  return typeof element.style?.[key] === 'number' ? Number(element.style[key]) : fallback;
}

export function renderTableSnapshot(element: Readonly<CanvasElement>): SnapshotContribution {
  const { columns, rows, caption } = tableData(element);
  const width = typeof element.width === 'number' ? element.width : 520;
  const height = typeof element.height === 'number' ? element.height : 220;
  const border = styleString(element, 'borderColor', '#cbd5e1');
  const borderWidth = styleNumber(element, 'borderWidth', 1);
  const fontSize = styleNumber(element, 'fontSize', 13);
  const captionHeight = caption ? 34 : 0;
  const rowHeight = 30;
  const columnCount = Math.max(1, columns.length);
  const cellWidth = width / columnCount;
  const visibleRows = rows.slice(0, Math.max(0, Math.floor((height - captionHeight - rowHeight) / rowHeight)));
  const nodes: SnapshotNode[] = [
    {
      kind: 'rect',
      x: 0,
      y: 0,
      width,
      height,
      rx: styleNumber(element, 'borderRadius', 8),
      fill: styleString(element, 'background', '#ffffff'),
      stroke: border,
      strokeWidth: borderWidth
    }
  ];
  if (caption)
    nodes.push({
      kind: 'text',
      x: 12,
      y: 22,
      text: caption,
      fill: styleString(element, 'captionColor', '#334155'),
      fontFamily: styleString(element, 'fontFamily', 'Inter, Arial, sans-serif'),
      fontSize: fontSize + 1,
      fontWeight: 700,
      maxWidth: width - 24
    });
  const startY = captionHeight;
  nodes.push({
    kind: 'rect',
    x: 0,
    y: startY,
    width,
    height: rowHeight,
    fill: styleString(element, 'headerBackground', '#f8fafc'),
    stroke: border,
    strokeWidth: borderWidth
  });
  for (let column = 0; column < columnCount; column += 1) {
    const x = column * cellWidth;
    if (column > 0)
      nodes.push({
        kind: 'line',
        x1: x,
        y1: startY,
        x2: x,
        y2: startY + rowHeight * (visibleRows.length + 1),
        stroke: border,
        strokeWidth: borderWidth
      });
    nodes.push({
      kind: 'text',
      x: x + 8,
      y: startY + 20,
      text: columns[column] ?? '',
      fill: styleString(element, 'headerColor', '#0f172a'),
      fontFamily: styleString(element, 'fontFamily', 'Inter, Arial, sans-serif'),
      fontSize,
      fontWeight: 700,
      maxWidth: Math.max(1, cellWidth - 16)
    });
  }
  visibleRows.forEach((row, rowIndex) => {
    const y = startY + (rowIndex + 1) * rowHeight;
    nodes.push({ kind: 'line', x1: 0, y1: y, x2: width, y2: y, stroke: border, strokeWidth: borderWidth });
    for (let column = 0; column < columnCount; column += 1)
      nodes.push({
        kind: 'text',
        x: column * cellWidth + 8,
        y: y + 20,
        text: row[column] ?? '',
        fill: styleString(element, 'color', '#0f172a'),
        fontFamily: styleString(element, 'fontFamily', 'Inter, Arial, sans-serif'),
        fontSize,
        fontWeight: 400,
        maxWidth: Math.max(1, cellWidth - 16)
      });
  });
  return { space: 'frame', layer: 'content', nodes };
}
