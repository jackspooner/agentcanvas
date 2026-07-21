import type {
  CanvasElement,
  CanvasThemeV1,
  JsonObject,
  PluginDiagnostic,
  SnapshotContribution,
  SnapshotNode
} from '@agentcanvas/plugin-sdk';
import { DEFAULT_CANVAS_THEME } from '@agentcanvas/plugin-sdk';
import { connectorData, elementSize, stringValue } from './browser/data.js';
import { arrowHead, connectorRoute, type Point, resolveConnectorEndpoints, routeMidpoint } from './browser/geometry.js';

function styleString(element: Readonly<CanvasElement>, key: string, fallback: string): string {
  const value = element.style?.[key];
  return typeof value === 'string' ? value : fallback;
}

function styleNumber(element: Readonly<CanvasElement>, key: string, fallback: number): number {
  const value = element.style?.[key];
  return typeof value === 'number' ? value : fallback;
}

export function renderTextSnapshot(
  element: Readonly<CanvasElement>,
  theme: Readonly<CanvasThemeV1> = DEFAULT_CANVAS_THEME
): SnapshotContribution {
  const { width, height } = elementSize(element, 240, 100);
  const lines = stringValue(element.data.text).split('\n').slice(0, 100);
  const nodes: SnapshotNode[] = [
    {
      kind: 'rect',
      x: 0,
      y: 0,
      width,
      height,
      rx: styleNumber(element, 'borderRadius', theme.shape.radius),
      fill: styleString(element, 'background', theme.colors.surface),
      stroke: styleString(element, 'borderColor', theme.colors.border),
      strokeWidth: styleNumber(element, 'borderWidth', theme.shape.borderWidth)
    },
    ...lines.map(
      (text, index): SnapshotNode => ({
        kind: 'text',
        x: 14,
        y: 26 + index * (styleNumber(element, 'fontSize', 18) + 4),
        text,
        fill: styleString(element, 'color', theme.colors.text),
        fontFamily: styleString(element, 'fontFamily', theme.typography.bodyFont),
        fontSize: styleNumber(element, 'fontSize', 18),
        fontWeight: Number(element.style?.fontWeight) || 400,
        maxWidth: Math.max(1, width - 28)
      })
    )
  ];
  return { space: 'frame', layer: 'content', nodes };
}

export function renderShapeSnapshot(
  element: Readonly<CanvasElement>,
  theme: Readonly<CanvasThemeV1> = DEFAULT_CANVAS_THEME
): SnapshotContribution {
  const { width, height } = elementSize(element, 240, 160);
  const shape = stringValue(element.data.shape, 'rect');
  const fill = styleString(element, 'fill', styleString(element, 'background', theme.colors.surface));
  const stroke = styleString(element, 'stroke', styleString(element, 'borderColor', theme.colors.border));
  const strokeWidth = styleNumber(element, 'strokeWidth', styleNumber(element, 'borderWidth', 2));
  const nodes: SnapshotNode[] = [];
  if (shape === 'ellipse') {
    nodes.push({
      kind: 'ellipse',
      cx: width / 2,
      cy: height / 2,
      rx: width / 2,
      ry: height / 2,
      fill,
      stroke,
      strokeWidth
    });
  } else if (shape === 'diamond') {
    nodes.push({
      kind: 'path',
      d: `M ${width / 2} 0 L ${width} ${height / 2} L ${width / 2} ${height} L 0 ${height / 2} Z`,
      fill,
      stroke,
      strokeWidth
    });
  } else {
    nodes.push({
      kind: 'rect',
      x: 0,
      y: 0,
      width,
      height,
      rx: styleNumber(element, 'borderRadius', theme.shape.radius),
      fill,
      stroke,
      strokeWidth
    });
  }
  const label = stringValue(element.data.label);
  if (label)
    nodes.push({
      kind: 'text',
      x: width / 2,
      y: height / 2 + 5,
      text: label,
      textAnchor: 'middle',
      fill: styleString(element, 'color', theme.colors.text),
      fontFamily: styleString(element, 'fontFamily', theme.typography.bodyFont),
      fontSize: styleNumber(element, 'fontSize', 16),
      fontWeight: 600,
      maxWidth: width * 0.72
    });
  return { space: 'frame', layer: 'content', nodes };
}

function point(value: unknown): Point | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  return typeof record.x === 'number' && typeof record.y === 'number' ? { x: record.x, y: record.y } : null;
}

function runtimeGeometry(runtime: Readonly<JsonObject> | null): { from: Point; to: Point } | null {
  const value = runtime?.connectorGeometry;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const from = point((value as JsonObject).from);
  const to = point((value as JsonObject).to);
  return from && to ? { from, to } : null;
}

export function renderConnectorSnapshot(
  element: Readonly<CanvasElement>,
  runtime: Readonly<JsonObject> | null,
  theme: Readonly<CanvasThemeV1> = DEFAULT_CANVAS_THEME
): SnapshotContribution {
  const data = connectorData(element);
  const projected = runtimeGeometry(runtime);
  const fallback = resolveConnectorEndpoints(data.from, data.to);
  const resolved = projected ?? fallback;
  const route = connectorRoute(data.from, data.to, resolved);
  const stroke = data.stroke ?? theme.colors.accent;
  const strokeWidth = data.strokeWidth ?? 2;
  const nodes: SnapshotNode[] =
    route.length === 2
      ? [
          {
            kind: 'line',
            x1: resolved.from.x,
            y1: resolved.from.y,
            x2: resolved.to.x,
            y2: resolved.to.y,
            stroke,
            strokeWidth
          }
        ]
      : [
          {
            kind: 'path',
            d: route.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' '),
            fill: 'none',
            stroke,
            strokeWidth
          }
        ];
  if (element.type.endsWith('/arrow')) {
    const [tip, left, right] = arrowHead(route.at(-2) ?? resolved.from, resolved.to);
    nodes.push({
      kind: 'path',
      d: `M ${tip.x} ${tip.y} L ${left.x} ${left.y} L ${right.x} ${right.y} Z`,
      fill: stroke
    });
  }
  if (data.label) {
    const mid = routeMidpoint(route);
    nodes.push({
      kind: 'rect',
      x: mid.x - Math.min(120, data.label.length * 3.8 + 8),
      y: mid.y - 12,
      width: Math.min(240, data.label.length * 7.6 + 16),
      height: 24,
      rx: 5,
      fill: theme.colors.surface,
      stroke: theme.colors.border,
      strokeWidth: theme.shape.borderWidth
    });
    nodes.push({
      kind: 'text',
      x: mid.x,
      y: mid.y + 5,
      text: data.label,
      textAnchor: 'middle',
      fill: theme.colors.text,
      fontFamily: theme.typography.bodyFont,
      fontSize: 13,
      fontWeight: 600,
      maxWidth: 220
    });
  }
  const diagnostics: PluginDiagnostic[] = [];
  if (!projected && fallback.missingElementIds.length) {
    diagnostics.push({
      code: 'connector_geometry_unresolved',
      severity: 'warning',
      message: `Connector anchors could not be resolved for: ${fallback.missingElementIds.join(', ')}.`,
      retryable: false,
      pluginId: 'agentcanvas.primitives',
      elementId: element.id
    });
  }
  return { space: 'world', layer: 'underlay', nodes, diagnostics };
}
