import type { CanvasElement, CanvasElementFramePatch, CanvasThemeV1, JsonObject } from '@agentcanvas/plugin-sdk';

export const DEFAULT_CANVAS_WIDTH = 1600;
export const DEFAULT_CANVAS_HEIGHT = 1000;
export const CANVAS_LIST_LIMITS = Object.freeze({ default: 50, minimum: 1, maximum: 200 });

export type CanvasBounds = { mode: 'unlimited' } | { mode: 'fixed'; width: number; height: number };

export interface CanvasBackground {
  color?: string;
  grid?: boolean;
}

export interface CanvasRecord {
  id: string;
  title: string;
  description?: string | null;
  project?: string | null;
  conversationId?: string | null;
  createdBy: 'agent' | 'user' | 'system';
  createdAt: string;
  updatedAt: string;
  bounds: CanvasBounds;
  width?: number;
  height?: number;
  background?: CanvasBackground | null;
  theme?: CanvasThemeV1 | null;
  elements: CanvasElement[];
  revision: number;
  metadata?: JsonObject;
  documentVersion: 2;
}

export type CanvasViewportSource = 'default' | 'user' | 'agent';

export interface CanvasViewport {
  centerX: number;
  centerY: number;
  zoom: number;
  width: number;
  height: number;
  source: CanvasViewportSource;
  updatedAt: string | null;
}

export interface CanvasViewportState {
  userViewport: CanvasViewport;
  agentViewport: CanvasViewport | null;
}

export interface CanvasViewportInput {
  centerX?: number;
  centerY?: number;
  zoom?: number;
  width?: number;
  height?: number;
  source?: 'user' | 'agent';
}

export type CanvasOperation =
  | { op: 'upsertElement'; element: CanvasElement | Record<string, unknown> }
  | { op: 'patchElementFrame'; elementId: string; frame: CanvasElementFramePatch | Record<string, unknown> }
  | { op: 'replaceElementData'; elementId: string; data: JsonObject; style?: JsonObject | null }
  | { op: 'replaceElementMetadata'; elementId: string; metadata: JsonObject }
  | { op: 'deleteElement'; elementId: string }
  | { op: 'clear' };

export interface CanvasBatchRequest {
  operations: CanvasOperation[];
  expectedRevision?: number;
  idempotencyKey?: string;
  actor?: string;
}

export interface ShareLinkRecord {
  id: string;
  canvasId: string;
  mode: 'read';
  label?: string | null;
  expiresAt?: string | null;
  createdAt: string;
  revokedAt?: string | null;
}

export interface CreateCanvasInput {
  title: string;
  description?: string | null;
  project?: string | null;
  conversationId?: string | null;
  createdBy?: 'agent' | 'user' | 'system';
  bounds?: CanvasBounds | null;
  width?: number;
  height?: number;
  background?: CanvasBackground | null;
  theme?: CanvasThemeV1 | null;
  metadata?: JsonObject;
}

export interface UpdateCanvasBoundsInput {
  bounds: CanvasBounds;
  expectedRevision?: number;
  actor?: string;
}

export interface RenameCanvasInput {
  title: string;
  expectedRevision?: number;
  actor?: string;
}

export interface UpdateCanvasThemeInput {
  theme: CanvasThemeV1 | null;
  expectedRevision?: number;
  actor?: string;
}

export interface CreateShareLinkInput {
  mode?: 'read';
  label?: string | null;
  expiresAt?: string | null;
}

export type { CanvasElement, CanvasElementFramePatch, CanvasThemeV1, JsonObject } from '@agentcanvas/plugin-sdk';
