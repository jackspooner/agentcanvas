import type { CanvasElement, CanvasThemeV1, JsonObject, PluginDiagnostic } from '@agentcanvas/plugin-sdk';
import type { CanvasBackground, CanvasBounds, CanvasViewport, CanvasViewportState } from '../contracts';

export interface CanvasDocument {
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

export interface CanvasProjection {
  canvas: CanvasDocument;
  elementRuntime: Record<string, JsonObject>;
  diagnostics: PluginDiagnostic[];
}

export type { CanvasBounds, CanvasViewport, CanvasViewportState };
