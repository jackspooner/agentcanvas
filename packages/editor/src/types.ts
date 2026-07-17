import type { ReactNode } from 'react';

export interface EditorElement {
  id: string;
  x: number;
  y: number;
  width?: number | null;
  height?: number | null;
  zIndex?: number | null;
  rotation?: number | null;
  opacity?: number | null;
  locked?: boolean | null;
}

export interface EditorFrame {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface EditorFrameChange {
  elementId: string;
  before: EditorFrame;
  after: EditorFrame;
}

export interface EditorViewport {
  centerX: number;
  centerY: number;
  zoom: number;
}

export type EditorBounds = { mode: 'unlimited' } | { mode: 'fixed'; width: number; height: number };

export interface EditorRenderContext<TElement extends EditorElement> {
  element: TElement;
  selected: boolean;
}

export interface AgentCanvasEditorProps<TElement extends EditorElement> {
  elements: readonly TElement[];
  bounds: EditorBounds;
  viewport: EditorViewport;
  selectedElementIds?: readonly string[];
  readOnly?: boolean;
  snapToGrid?: boolean;
  gridSize?: number;
  className?: string;
  worldUnderlay?: ReactNode;
  worldOverlay?: ReactNode;
  renderElement(context: EditorRenderContext<TElement>): ReactNode;
  onViewportChange(viewport: EditorViewport): void;
  onSelectionChange?(elementIds: readonly string[]): void;
  onTransientFramesChange?(frames: ReadonlyMap<string, EditorFrame>): void;
  onFrameCommit?(changes: readonly EditorFrameChange[]): Promise<void> | void;
  onCommitError?(error: unknown): void;
}
