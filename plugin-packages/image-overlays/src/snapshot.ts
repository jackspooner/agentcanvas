import type {
  CanvasElement,
  JsonObject,
  PluginDiagnostic,
  SnapshotContribution,
  SnapshotNode
} from '@agentcanvas/plugin-sdk';
import type { ResolvedBBoxData } from './contracts.js';
import { overlayAccent, scaleBBox } from './geometry.js';
import { normalizeInlineBBoxData, normalizePathData } from './normalize.js';

function size(element: Readonly<CanvasElement>): { width: number; height: number } {
  return {
    width: typeof element.width === 'number' ? element.width : 320,
    height: typeof element.height === 'number' ? element.height : 240
  };
}

function failed(element: Readonly<CanvasElement>, code: string, message: string): SnapshotContribution {
  const { width, height } = size(element);
  const diagnostic: PluginDiagnostic = {
    code,
    severity: 'error',
    message,
    retryable: true,
    pluginId: 'agentcanvas.image-overlays',
    elementId: element.id
  };
  return {
    space: 'frame',
    layer: 'content',
    nodes: [
      { kind: 'rect', x: 0, y: 0, width, height, fill: '#fff7ed', stroke: '#ea580c', strokeWidth: 2 },
      { kind: 'text', x: 14, y: 28, text: 'Overlay unavailable', fill: '#9a3412', fontSize: 14, fontWeight: 700 },
      { kind: 'text', x: 14, y: 50, text: message.slice(0, 180), fill: '#7c2d12', fontSize: 12, maxWidth: width - 28 }
    ],
    diagnostics: [diagnostic]
  };
}

function bboxSource(element: Readonly<CanvasElement>, runtime: Readonly<JsonObject> | null): ResolvedBBoxData {
  const source = runtime?.canvasWidth ? runtime : element.data;
  return normalizeInlineBBoxData(source) as ResolvedBBoxData;
}

export function renderBBoxSnapshot(
  element: Readonly<CanvasElement>,
  runtime: Readonly<JsonObject> | null
): SnapshotContribution {
  try {
    const data = bboxSource(element, runtime);
    const { width, height } = size(element);
    const nodes: SnapshotNode[] = [
      { kind: 'rect', x: 0, y: 0, width, height, fill: data.background ?? '#f8fafc', stroke: '#d0d7de', strokeWidth: 1 }
    ];
    if (typeof data.imageHandle === 'string') {
      nodes.push({
        kind: 'imageHandle',
        x: 0,
        y: 0,
        width,
        height,
        handle: data.imageHandle,
        fit: 'fill',
        alt: data.alt ?? ''
      });
    }
    data.boxes.forEach((box, index) => {
      const scaled = scaleBBox(box, index, data.canvasWidth, data.canvasHeight, width, height);
      nodes.push({
        kind: 'rect',
        x: scaled.scaledX,
        y: scaled.scaledY,
        width: scaled.scaledWidth,
        height: scaled.scaledHeight,
        fill: box.fill ?? `${scaled.colorValue}22`,
        stroke: scaled.colorValue,
        strokeWidth: box.strokeWidth ?? 2
      });
      if (data.showLabels !== false) {
        nodes.push({
          kind: 'text',
          x: scaled.labelX,
          y: scaled.labelY + 13,
          text: box.label ?? box.id,
          fill: scaled.colorValue,
          fontSize: 13,
          fontWeight: 700,
          textAnchor: scaled.textAnchor,
          maxWidth: scaled.scaledWidth
        });
      }
    });
    return {
      space: 'frame',
      layer: 'content',
      nodes: [{ kind: 'group', clip: { kind: 'rect', x: 0, y: 0, width, height }, children: nodes }]
    };
  } catch (error) {
    return failed(element, 'bbox_snapshot_failed', error instanceof Error ? error.message : 'bbox snapshot failed');
  }
}

export function renderPathSnapshot(element: Readonly<CanvasElement>): SnapshotContribution {
  try {
    const data = normalizePathData(element.data);
    const { width, height } = size(element);
    const sx = width / data.canvasWidth;
    const sy = height / data.canvasHeight;
    const children: SnapshotNode[] = [
      { kind: 'rect', x: 0, y: 0, width, height, fill: data.background ?? '#f8fafc', stroke: '#d0d7de', strokeWidth: 1 }
    ];
    data.paths.forEach((overlayPath, index) => {
      children.push({
        kind: 'path',
        d: overlayPath.d,
        fill: overlayPath.fill ?? 'transparent',
        stroke: overlayPath.color ?? overlayAccent(index),
        strokeWidth: overlayPath.strokeWidth ?? 2,
        transform: [sx, 0, 0, sy, 0, 0]
      });
    });
    if (data.showLabels !== false) {
      data.paths.slice(0, 50).forEach((overlayPath, index) => {
        const y = 18 + index * 16;
        children.push({
          kind: 'rect',
          x: 10,
          y: y - 9,
          width: 8,
          height: 8,
          fill: overlayPath.color ?? overlayAccent(index)
        });
        children.push({
          kind: 'text',
          x: 24,
          y,
          text: overlayPath.label ?? overlayPath.id,
          fill: '#334155',
          fontSize: 12,
          maxWidth: Math.max(1, width - 34)
        });
      });
    }
    return {
      space: 'frame',
      layer: 'content',
      nodes: [{ kind: 'group', clip: { kind: 'rect', x: 0, y: 0, width, height }, children }]
    };
  } catch (error) {
    return failed(element, 'path_snapshot_failed', error instanceof Error ? error.message : 'path snapshot failed');
  }
}
