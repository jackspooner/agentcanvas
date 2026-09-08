import type { CanvasElement } from './element.js';

export const DEFAULT_ELEMENT_WIDTH = 240;
export const DEFAULT_ELEMENT_HEIGHT = 120;

/** Effective host frame for rendering and anchors; null/absent sizes use host defaults, explicit zero is preserved. */
export function resolveElementFrame(element: Pick<CanvasElement, 'x' | 'y' | 'width' | 'height'>) {
  return {
    x: element.x,
    y: element.y,
    width: element.width ?? DEFAULT_ELEMENT_WIDTH,
    height: element.height ?? DEFAULT_ELEMENT_HEIGHT
  };
}

/** Axis-aligned envelope anchor, shared by browser interactions and server/snapshot resolution. */
export function resolveFrameAnchor(
  frame: ReturnType<typeof resolveElementFrame>,
  anchor: 'center' | 'top' | 'right' | 'bottom' | 'left' = 'center'
) {
  if (anchor === 'top') return { x: frame.x + frame.width / 2, y: frame.y };
  if (anchor === 'right') return { x: frame.x + frame.width, y: frame.y + frame.height / 2 };
  if (anchor === 'bottom') return { x: frame.x + frame.width / 2, y: frame.y + frame.height };
  if (anchor === 'left') return { x: frame.x, y: frame.y + frame.height / 2 };
  return { x: frame.x + frame.width / 2, y: frame.y + frame.height / 2 };
}
