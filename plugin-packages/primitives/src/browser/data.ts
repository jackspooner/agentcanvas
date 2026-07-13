import type { CanvasElement, JsonObject, JsonValue } from '@agentcanvas/plugin-sdk';

export type Anchor = 'center' | 'top' | 'right' | 'bottom' | 'left';

export interface ConnectorEndpointData {
  elementId?: string | null;
  x?: number | null;
  y?: number | null;
  anchor?: Anchor | null;
}

export interface ConnectorData {
  from: ConnectorEndpointData;
  to: ConnectorEndpointData;
  label?: string | null;
  stroke?: string | null;
  strokeWidth?: number | null;
}

export type ShapeKind = 'rect' | 'ellipse' | 'diamond';

export function objectValue(value: JsonValue | undefined, label: string): JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} must be an object`);
  return value;
}

export function stringValue(value: JsonValue | undefined, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

export function numberValue(value: JsonValue | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function connectorData(element: Readonly<CanvasElement>): ConnectorData {
  const from = objectValue(element.data.from, 'connector.from');
  const to = objectValue(element.data.to, 'connector.to');
  return {
    from: endpointData(from),
    to: endpointData(to),
    label: typeof element.data.label === 'string' ? element.data.label : null,
    stroke: typeof element.data.stroke === 'string' ? element.data.stroke : null,
    strokeWidth: typeof element.data.strokeWidth === 'number' ? element.data.strokeWidth : null
  };
}

function endpointData(value: JsonObject): ConnectorEndpointData {
  const anchor = value.anchor;
  return {
    elementId: typeof value.elementId === 'string' ? value.elementId : null,
    x: typeof value.x === 'number' ? value.x : null,
    y: typeof value.y === 'number' ? value.y : null,
    anchor:
      anchor === 'center' || anchor === 'top' || anchor === 'right' || anchor === 'bottom' || anchor === 'left'
        ? anchor
        : null
  };
}

export function elementSize(element: Readonly<CanvasElement>, defaultWidth: number, defaultHeight: number) {
  return {
    width: typeof element.width === 'number' ? element.width : defaultWidth,
    height: typeof element.height === 'number' ? element.height : defaultHeight
  };
}
