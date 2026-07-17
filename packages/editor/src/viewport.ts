import type { Viewport } from '@xyflow/react';
import type { EditorViewport } from './types.js';

export interface ViewportSize {
  width: number;
  height: number;
}

export function worldViewportToFlow(viewport: EditorViewport, size: ViewportSize): Viewport {
  return {
    x: size.width / 2 - viewport.centerX * viewport.zoom,
    y: size.height / 2 - viewport.centerY * viewport.zoom,
    zoom: viewport.zoom
  };
}

export function flowViewportToWorld(viewport: Viewport, size: ViewportSize): EditorViewport {
  return {
    centerX: (size.width / 2 - viewport.x) / viewport.zoom,
    centerY: (size.height / 2 - viewport.y) / viewport.zoom,
    zoom: viewport.zoom
  };
}
