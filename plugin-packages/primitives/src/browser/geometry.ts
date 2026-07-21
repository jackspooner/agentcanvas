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

export function connectorRoute(
  fromEndpoint: ConnectorEndpointData,
  toEndpoint: ConnectorEndpointData,
  resolved: Pick<ResolvedConnectorGeometry, 'from' | 'to'>,
  offset = 60
): readonly Point[] {
  const sharedAnchor =
    fromEndpoint.elementId && toEndpoint.elementId && fromEndpoint.anchor === toEndpoint.anchor
      ? fromEndpoint.anchor
      : null;
  if (!sharedAnchor || !['left', 'right', 'top', 'bottom'].includes(sharedAnchor)) {
    return [resolved.from, resolved.to];
  }
  if (sharedAnchor === 'left' || sharedAnchor === 'right') {
    const direction = sharedAnchor === 'left' ? -1 : 1;
    const routeOffset = Math.max(offset, Math.min(320, Math.abs(resolved.to.y - resolved.from.y) * 0.5));
    const routeX =
      (direction < 0 ? Math.min(resolved.from.x, resolved.to.x) : Math.max(resolved.from.x, resolved.to.x)) +
      direction * routeOffset;
    return [resolved.from, { x: routeX, y: resolved.from.y }, { x: routeX, y: resolved.to.y }, resolved.to];
  }
  const direction = sharedAnchor === 'top' ? -1 : 1;
  const routeOffset = Math.max(offset, Math.min(320, Math.abs(resolved.to.x - resolved.from.x) * 0.5));
  const routeY =
    (direction < 0 ? Math.min(resolved.from.y, resolved.to.y) : Math.max(resolved.from.y, resolved.to.y)) +
    direction * routeOffset;
  return [resolved.from, { x: resolved.from.x, y: routeY }, { x: resolved.to.x, y: routeY }, resolved.to];
}

export function routeMidpoint(points: readonly Point[]): Point {
  if (points.length < 2) return points[0] ?? { x: 0, y: 0 };
  const lengths = points
    .slice(1)
    .map((point, index) => Math.hypot(point.x - points[index].x, point.y - points[index].y));
  const halfway = lengths.reduce((sum, length) => sum + length, 0) / 2;
  let travelled = 0;
  for (let index = 0; index < lengths.length; index += 1) {
    const length = lengths[index];
    if (travelled + length >= halfway) {
      const ratio = length === 0 ? 0 : (halfway - travelled) / length;
      return {
        x: points[index].x + (points[index + 1].x - points[index].x) * ratio,
        y: points[index].y + (points[index + 1].y - points[index].y) * ratio
      };
    }
    travelled += length;
  }
  return points.at(-1) as Point;
}
