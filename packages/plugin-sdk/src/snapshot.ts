import type { PluginDiagnostic } from './diagnostics.js';

export type SnapshotLayer = 'underlay' | 'content' | 'overlay';
export type SnapshotSpace = 'frame' | 'world';
export type SnapshotTextAnchor = 'start' | 'middle' | 'end';

export interface SnapshotNodeBase {
  id?: string;
  opacity?: number;
  transform?: readonly [number, number, number, number, number, number];
}

export interface SnapshotGroupNode extends SnapshotNodeBase {
  kind: 'group';
  children: readonly SnapshotNode[];
  clip?: SnapshotRectNode | SnapshotEllipseNode;
}

export interface SnapshotRectNode extends SnapshotNodeBase {
  kind: 'rect';
  x: number;
  y: number;
  width: number;
  height: number;
  rx?: number;
  ry?: number;
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
}

export interface SnapshotEllipseNode extends SnapshotNodeBase {
  kind: 'ellipse';
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
}

export interface SnapshotLineNode extends SnapshotNodeBase {
  kind: 'line';
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  stroke: string;
  strokeWidth?: number;
  dash?: readonly number[];
}

export interface SnapshotPathNode extends SnapshotNodeBase {
  kind: 'path';
  d: string;
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
}

export interface SnapshotTextNode extends SnapshotNodeBase {
  kind: 'text';
  x: number;
  y: number;
  text: string;
  fill?: string;
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: number;
  textAnchor?: SnapshotTextAnchor;
  maxWidth?: number;
}

export interface SnapshotImageHandleNode extends SnapshotNodeBase {
  kind: 'imageHandle';
  x: number;
  y: number;
  width: number;
  height: number;
  handle: string;
  fit?: 'contain' | 'cover' | 'fill' | 'none';
  alt?: string;
}

export type SnapshotNode =
  | SnapshotGroupNode
  | SnapshotRectNode
  | SnapshotEllipseNode
  | SnapshotLineNode
  | SnapshotPathNode
  | SnapshotTextNode
  | SnapshotImageHandleNode;

export interface SnapshotContribution {
  space: SnapshotSpace;
  layer: SnapshotLayer;
  nodes: readonly SnapshotNode[];
  diagnostics?: readonly PluginDiagnostic[];
}
