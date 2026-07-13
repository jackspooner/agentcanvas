import type { SnapshotNode } from '@agentcanvas/plugin-sdk';

export interface SnapshotBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

type Matrix = readonly [number, number, number, number, number, number];
const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

export function multiplyMatrix(left: Matrix, right: Matrix): Matrix {
  return [
    left[0] * right[0] + left[2] * right[1],
    left[1] * right[0] + left[3] * right[1],
    left[0] * right[2] + left[2] * right[3],
    left[1] * right[2] + left[3] * right[3],
    left[0] * right[4] + left[2] * right[5] + left[4],
    left[1] * right[4] + left[3] * right[5] + left[5]
  ];
}

export function transformPoint(matrix: Matrix, x: number, y: number): readonly [number, number] {
  return [matrix[0] * x + matrix[2] * y + matrix[4], matrix[1] * x + matrix[3] * y + matrix[5]];
}

export function transformBounds(bounds: SnapshotBounds, matrix: Matrix): SnapshotBounds {
  const points = [
    transformPoint(matrix, bounds.minX, bounds.minY),
    transformPoint(matrix, bounds.maxX, bounds.minY),
    transformPoint(matrix, bounds.maxX, bounds.maxY),
    transformPoint(matrix, bounds.minX, bounds.maxY)
  ];
  return {
    minX: Math.min(...points.map((point) => point[0])),
    minY: Math.min(...points.map((point) => point[1])),
    maxX: Math.max(...points.map((point) => point[0])),
    maxY: Math.max(...points.map((point) => point[1]))
  };
}

export function unionBounds(left: SnapshotBounds | null, right: SnapshotBounds | null): SnapshotBounds | null {
  if (!left) return right;
  if (!right) return left;
  return {
    minX: Math.min(left.minX, right.minX),
    minY: Math.min(left.minY, right.minY),
    maxX: Math.max(left.maxX, right.maxX),
    maxY: Math.max(left.maxY, right.maxY)
  };
}

function box(x: number, y: number, width: number, height: number, stroke = 0): SnapshotBounds {
  const half = stroke / 2;
  return { minX: x - half, minY: y - half, maxX: x + width + half, maxY: y + height + half };
}

function rawNodeBounds(node: SnapshotNode): SnapshotBounds | null {
  switch (node.kind) {
    case 'group':
      return node.children.reduce<SnapshotBounds | null>(
        (result, child) => unionBounds(result, snapshotNodeBounds(child)),
        null
      );
    case 'rect':
      return box(node.x, node.y, node.width, node.height, node.strokeWidth ?? 0);
    case 'ellipse':
      return box(node.cx - node.rx, node.cy - node.ry, node.rx * 2, node.ry * 2, node.strokeWidth ?? 0);
    case 'line': {
      const half = (node.strokeWidth ?? 1) / 2;
      return {
        minX: Math.min(node.x1, node.x2) - half,
        minY: Math.min(node.y1, node.y2) - half,
        maxX: Math.max(node.x1, node.x2) + half,
        maxY: Math.max(node.y1, node.y2) + half
      };
    }
    case 'path': {
      const numbers = (node.d.match(/[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?/gi) ?? []).map(Number);
      if (numbers.length < 2) return null;
      const half = (node.strokeWidth ?? 0) / 2;
      // Path command arity varies, so use all numeric operands conservatively on both axes.
      // Plugin geometry helpers can provide tighter primitive bounds; the host must never clip unknown path extents.
      return {
        minX: Math.min(...numbers) - half,
        minY: Math.min(...numbers) - half,
        maxX: Math.max(...numbers) + half,
        maxY: Math.max(...numbers) + half
      };
    }
    case 'text': {
      const size = node.fontSize ?? 16;
      const estimatedWidth = node.maxWidth ?? node.text.length * size * 0.6;
      const x =
        node.textAnchor === 'middle'
          ? node.x - estimatedWidth / 2
          : node.textAnchor === 'end'
            ? node.x - estimatedWidth
            : node.x;
      return box(x, node.y - size, estimatedWidth, size * 1.25);
    }
    case 'imageHandle':
      return box(node.x, node.y, node.width, node.height);
  }
}

export function snapshotNodeBounds(node: SnapshotNode): SnapshotBounds | null {
  const bounds = rawNodeBounds(node);
  return bounds && node.transform ? transformBounds(bounds, node.transform) : bounds;
}

export function envelopeMatrix(x: number, y: number, width: number, height: number, rotation: number): Matrix {
  if (!rotation) return [1, 0, 0, 1, x, y];
  const radians = (rotation * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const cx = width / 2;
  const cy = height / 2;
  return [cos, sin, -sin, cos, x + cx - cos * cx + sin * cy, y + cy - sin * cx - cos * cy];
}

export { IDENTITY as IDENTITY_MATRIX };
