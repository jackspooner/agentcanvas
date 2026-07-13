import type { SnapshotContribution, SnapshotNode } from '@agentcanvas/plugin-sdk';

export interface SnapshotSafetyLimits {
  maxNodes: number;
  maxDepth: number;
  maxTextLength: number;
  maxPathLength: number;
  maxCoordinate: number;
  maxResourceHandles: number;
}

export const DEFAULT_SNAPSHOT_LIMITS: Readonly<SnapshotSafetyLimits> = Object.freeze({
  maxNodes: 10_000,
  maxDepth: 24,
  maxTextLength: 100_000,
  maxPathLength: 200_000,
  maxCoordinate: 1_000_000,
  maxResourceHandles: 1_000
});

export class SnapshotSafetyError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly hardLimit = false
  ) {
    super(message);
    this.name = 'SnapshotSafetyError';
  }
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new SnapshotSafetyError('snapshot_node_invalid', `${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function finite(value: unknown, label: string, limits: SnapshotSafetyLimits, minimum?: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > limits.maxCoordinate) {
    throw new SnapshotSafetyError('snapshot_number_invalid', `${label} must be a bounded finite number`);
  }
  if (minimum !== undefined && value < minimum) {
    throw new SnapshotSafetyError('snapshot_number_invalid', `${label} must be at least ${minimum}`);
  }
  return value;
}

function optionalFinite(value: unknown, label: string, limits: SnapshotSafetyLimits, minimum?: number): void {
  if (value !== undefined) finite(value, label, limits, minimum);
}

function paint(value: unknown, label: string): void {
  if (value === undefined) return;
  if (
    typeof value !== 'string' ||
    value.length > 100 ||
    /url\s*\(|[<>"'`;{}\\]/i.test(value) ||
    !/^(?:#[0-9a-f]{3,8}|[a-z]+|(?:rgb|rgba|hsl|hsla)\([0-9.%+, /-]+\))$/i.test(value)
  ) {
    throw new SnapshotSafetyError('snapshot_paint_invalid', `${label} is not a safe color`);
  }
}

function common(node: Record<string, unknown>, limits: SnapshotSafetyLimits): void {
  optionalFinite(node.opacity, 'opacity', limits, 0);
  if (typeof node.opacity === 'number' && node.opacity > 1) {
    throw new SnapshotSafetyError('snapshot_number_invalid', 'opacity must not exceed 1');
  }
  if (node.id !== undefined && (typeof node.id !== 'string' || node.id.length > 128)) {
    throw new SnapshotSafetyError('snapshot_node_invalid', 'node id must be a bounded string');
  }
  if (node.transform !== undefined) {
    if (!Array.isArray(node.transform) || node.transform.length !== 6) {
      throw new SnapshotSafetyError('snapshot_transform_invalid', 'transform must contain six numbers');
    }
    for (const [index, number] of node.transform.entries()) finite(number, `transform[${index}]`, limits);
  }
}

interface ValidationState {
  nodes: number;
  textLength: number;
  resources: number;
}

function validateNode(candidate: unknown, depth: number, state: ValidationState, limits: SnapshotSafetyLimits): void {
  if (depth > limits.maxDepth) {
    throw new SnapshotSafetyError('snapshot_depth_limit', `Snapshot depth exceeds ${limits.maxDepth}`, true);
  }
  state.nodes += 1;
  if (state.nodes > limits.maxNodes) {
    throw new SnapshotSafetyError('snapshot_node_limit', `Snapshot node count exceeds ${limits.maxNodes}`, true);
  }
  const node = object(candidate, 'snapshot node');
  common(node, limits);
  switch (node.kind) {
    case 'group': {
      if (!Array.isArray(node.children))
        throw new SnapshotSafetyError('snapshot_node_invalid', 'group children must be an array');
      for (const child of node.children) validateNode(child, depth + 1, state, limits);
      if (node.clip !== undefined) {
        const clip = object(node.clip, 'group clip');
        if (clip.kind !== 'rect' && clip.kind !== 'ellipse') {
          throw new SnapshotSafetyError('snapshot_node_invalid', 'group clip must be a rect or ellipse');
        }
        validateNode(clip, depth + 1, state, limits);
      }
      return;
    }
    case 'rect':
      finite(node.x, 'rect.x', limits);
      finite(node.y, 'rect.y', limits);
      finite(node.width, 'rect.width', limits, 0);
      finite(node.height, 'rect.height', limits, 0);
      optionalFinite(node.rx, 'rect.rx', limits, 0);
      optionalFinite(node.ry, 'rect.ry', limits, 0);
      optionalFinite(node.strokeWidth, 'rect.strokeWidth', limits, 0);
      paint(node.fill, 'rect.fill');
      paint(node.stroke, 'rect.stroke');
      return;
    case 'ellipse':
      finite(node.cx, 'ellipse.cx', limits);
      finite(node.cy, 'ellipse.cy', limits);
      finite(node.rx, 'ellipse.rx', limits, 0);
      finite(node.ry, 'ellipse.ry', limits, 0);
      optionalFinite(node.strokeWidth, 'ellipse.strokeWidth', limits, 0);
      paint(node.fill, 'ellipse.fill');
      paint(node.stroke, 'ellipse.stroke');
      return;
    case 'line':
      finite(node.x1, 'line.x1', limits);
      finite(node.y1, 'line.y1', limits);
      finite(node.x2, 'line.x2', limits);
      finite(node.y2, 'line.y2', limits);
      paint(node.stroke, 'line.stroke');
      optionalFinite(node.strokeWidth, 'line.strokeWidth', limits, 0);
      if (node.dash !== undefined) {
        if (!Array.isArray(node.dash) || node.dash.length > 32) {
          throw new SnapshotSafetyError('snapshot_node_invalid', 'line dash must be a bounded array');
        }
        for (const dash of node.dash) finite(dash, 'line.dash', limits, 0);
      }
      return;
    case 'path':
      if (
        typeof node.d !== 'string' ||
        node.d.length > limits.maxPathLength ||
        !/^[MmZzLlHhVvCcSsQqTtAaEe0-9+\-.,\s]*$/.test(node.d)
      ) {
        throw new SnapshotSafetyError('snapshot_path_invalid', 'path data contains unsupported content');
      }
      for (const token of node.d.match(/[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?/gi) ?? []) {
        finite(Number(token), 'path coordinate', limits);
      }
      paint(node.fill, 'path.fill');
      paint(node.stroke, 'path.stroke');
      optionalFinite(node.strokeWidth, 'path.strokeWidth', limits, 0);
      return;
    case 'text':
      finite(node.x, 'text.x', limits);
      finite(node.y, 'text.y', limits);
      if (typeof node.text !== 'string')
        throw new SnapshotSafetyError('snapshot_text_invalid', 'text must be a string');
      state.textLength += node.text.length;
      if (state.textLength > limits.maxTextLength) {
        throw new SnapshotSafetyError(
          'snapshot_text_limit',
          `Snapshot text exceeds ${limits.maxTextLength} characters`,
          true
        );
      }
      paint(node.fill, 'text.fill');
      optionalFinite(node.fontSize, 'text.fontSize', limits, 1);
      optionalFinite(node.fontWeight, 'text.fontWeight', limits, 1);
      optionalFinite(node.maxWidth, 'text.maxWidth', limits, 0);
      if (
        node.fontFamily !== undefined &&
        (typeof node.fontFamily !== 'string' || !/^[a-z0-9 ,_-]{1,100}$/i.test(node.fontFamily))
      ) {
        throw new SnapshotSafetyError('snapshot_text_invalid', 'fontFamily is not safe');
      }
      if (node.textAnchor !== undefined && !['start', 'middle', 'end'].includes(String(node.textAnchor))) {
        throw new SnapshotSafetyError('snapshot_text_invalid', 'textAnchor is invalid');
      }
      return;
    case 'imageHandle':
      finite(node.x, 'image.x', limits);
      finite(node.y, 'image.y', limits);
      finite(node.width, 'image.width', limits, 0);
      finite(node.height, 'image.height', limits, 0);
      if (typeof node.handle !== 'string' || !/^[A-Za-z0-9_-]{8,256}$/.test(node.handle)) {
        throw new SnapshotSafetyError('snapshot_resource_invalid', 'image handle is invalid');
      }
      state.resources += 1;
      if (state.resources > limits.maxResourceHandles) {
        throw new SnapshotSafetyError(
          'snapshot_resource_limit',
          `Snapshot resources exceed ${limits.maxResourceHandles}`,
          true
        );
      }
      if (node.fit !== undefined && !['contain', 'cover', 'fill', 'none'].includes(String(node.fit))) {
        throw new SnapshotSafetyError('snapshot_node_invalid', 'image fit is invalid');
      }
      if (node.alt !== undefined && (typeof node.alt !== 'string' || node.alt.length > 2_000)) {
        throw new SnapshotSafetyError('snapshot_node_invalid', 'image alt is invalid');
      }
      return;
    default:
      throw new SnapshotSafetyError('snapshot_node_invalid', `Unsupported snapshot node kind ${String(node.kind)}`);
  }
}
export function validateSnapshotContribution(
  value: unknown,
  limits: SnapshotSafetyLimits = DEFAULT_SNAPSHOT_LIMITS
): SnapshotContribution {
  const contribution = object(value, 'snapshot contribution');
  if (!['frame', 'world'].includes(String(contribution.space))) {
    throw new SnapshotSafetyError('snapshot_contribution_invalid', 'Snapshot space is invalid');
  }
  if (!['underlay', 'content', 'overlay'].includes(String(contribution.layer))) {
    throw new SnapshotSafetyError('snapshot_contribution_invalid', 'Snapshot layer is invalid');
  }
  if (!Array.isArray(contribution.nodes)) {
    throw new SnapshotSafetyError('snapshot_contribution_invalid', 'Snapshot nodes must be an array');
  }
  const state: ValidationState = { nodes: 0, textLength: 0, resources: 0 };
  for (const node of contribution.nodes) validateNode(node, 1, state, limits);
  return value as SnapshotContribution;
}

export function validateSnapshotNode(node: unknown, limits = DEFAULT_SNAPSHOT_LIMITS): SnapshotNode {
  validateSnapshotContribution({ space: 'world', layer: 'content', nodes: [node] }, limits);
  return node as SnapshotNode;
}
