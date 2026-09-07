import type { CanvasElement } from '@agentcanvas/plugin-sdk';
export interface CanvasClipboardPayload {
  format: 'agentcanvas.elements/v1';
  elements: CanvasElement[];
}

export function cloneElement(element: CanvasElement): CanvasElement {
  return JSON.parse(JSON.stringify(element)) as CanvasElement;
}

export function parseClipboardPayload(value: string): CanvasClipboardPayload | null {
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    if (parsed.format !== 'agentcanvas.elements/v1' || !Array.isArray(parsed.elements)) return null;
    const elements = parsed.elements.filter((candidate): candidate is CanvasElement => {
      if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return false;
      const element = candidate as Record<string, unknown>;
      return (
        typeof element.id === 'string' &&
        typeof element.type === 'string' &&
        Number.isSafeInteger(element.schemaVersion) &&
        typeof element.x === 'number' &&
        Number.isFinite(element.x) &&
        typeof element.y === 'number' &&
        Number.isFinite(element.y) &&
        Boolean(element.data && typeof element.data === 'object' && !Array.isArray(element.data))
      );
    });
    if (elements.length !== parsed.elements.length) return null;
    return { format: 'agentcanvas.elements/v1', elements: elements.map(cloneElement) };
  } catch {
    return null;
  }
}
