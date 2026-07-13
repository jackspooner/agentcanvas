import type { ConnectorEndpointData } from './data.js';

export interface Point {
  x: number;
  y: number;
}
export interface ConnectorGeometryLookup {
  resolveAnchor(elementId: string, anchor: NonNullable<ConnectorEndpointData['anchor']>): Point | null;
}
export interface ResolvedConnectorGeometry {
  from: Point;
  to: Point;
  missingElementIds: readonly string[];
}

function freePoint(endpoint: ConnectorEndpointData): Point {
  return {
    x: typeof endpoint.x === 'number' && Number.isFinite(endpoint.x) ? endpoint.x : 0,
    y: typeof endpoint.y === 'number' && Number.isFinite(endpoint.y) ? endpoint.y : 0
  };
}

export function resolveConnectorEndpoints(
  from: ConnectorEndpointData,
  to: ConnectorEndpointData,
  lookup?: ConnectorGeometryLookup
): ResolvedConnectorGeometry {
  const missing: string[] = [];
  const resolve = (endpoint: ConnectorEndpointData): Point => {
    if (endpoint.elementId && lookup) {
      const point = lookup.resolveAnchor(endpoint.elementId, endpoint.anchor ?? 'center');
      if (point) return point;
      missing.push(endpoint.elementId);
    } else if (endpoint.elementId) missing.push(endpoint.elementId);
    return freePoint(endpoint);
  };
  return { from: resolve(from), to: resolve(to), missingElementIds: missing };
}

export function arrowHead(from: Point, to: Point, length = 12, halfWidth = 5): readonly [Point, Point, Point] {
  const angle = Math.atan2(to.y - from.y, to.x - from.x);
  const baseX = to.x - Math.cos(angle) * length;
  const baseY = to.y - Math.sin(angle) * length;
  return [
    to,
    { x: baseX + Math.sin(angle) * halfWidth, y: baseY - Math.cos(angle) * halfWidth },
    { x: baseX - Math.sin(angle) * halfWidth, y: baseY + Math.cos(angle) * halfWidth }
  ];
}

export function connectorMidpoint(from: Point, to: Point): Point {
  return { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
}
