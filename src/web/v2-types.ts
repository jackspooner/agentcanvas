import type { JsonObject, PluginDiagnostic } from '@agentcanvas/plugin-sdk';
import type { CanvasBounds, CanvasViewport, CanvasViewportState } from '../contracts';

export type { CanvasRecord as CanvasDocument } from '@agentcanvas/core';

import type { CanvasRecord as CanvasDocument } from '@agentcanvas/core';

export interface CanvasProjection {
  canvas: CanvasDocument;
  elementRuntime: Record<string, JsonObject>;
  diagnostics: PluginDiagnostic[];
}

export type { CanvasBounds, CanvasViewport, CanvasViewportState };
