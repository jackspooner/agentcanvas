import type { CanvasElement, JsonObject, SnapshotContribution, SnapshotNode } from '@agentcanvas/plugin-sdk';
import { fileSystemImageData, fitToObjectFit } from './contracts.js';

export function renderFileSystemImageSnapshot(
  element: Readonly<CanvasElement>,
  runtime: Readonly<JsonObject> | null
): SnapshotContribution {
  const data = fileSystemImageData(element.data);
  const width = element.width ?? 320;
  const height = element.height ?? 240;
  const captionHeight = data.caption ? 30 : 0;
  const contentHeight = Math.max(1, height - captionHeight);
  const handle = typeof runtime?.contentHandle === 'string' ? runtime.contentHandle : null;
  const nodes: SnapshotNode[] = [
    { kind: 'rect', x: 0, y: 0, width, height, rx: 8, fill: '#f8fafc', stroke: '#cbd5e1', strokeWidth: 1 }
  ];
  if (handle) {
    nodes.push({
      kind: 'imageHandle',
      x: 0,
      y: 0,
      width,
      height: contentHeight,
      handle,
      fit: fitToObjectFit(data.fit),
      alt: data.alt ?? data.caption ?? data.source.path
    });
  } else {
    nodes.push({
      kind: 'text',
      x: width / 2,
      y: contentHeight / 2,
      text: 'Image unavailable',
      fill: '#64748b',
      fontFamily: 'system-ui',
      fontSize: 14,
      fontWeight: 600,
      textAnchor: 'middle',
      maxWidth: width - 24
    });
  }
  if (data.caption) {
    nodes.push({ kind: 'rect', x: 0, y: contentHeight, width, height: captionHeight, fill: '#ffffff' });
    nodes.push({
      kind: 'text',
      x: 10,
      y: contentHeight + 20,
      text: data.caption,
      fill: '#334155',
      fontFamily: 'system-ui',
      fontSize: 12,
      maxWidth: width - 20
    });
  }
  return {
    space: 'frame',
    layer: 'content',
    nodes,
    ...(handle
      ? {}
      : {
          diagnostics: [
            {
              code: 'filesystem_image_resource_unavailable',
              severity: 'warning',
              message: 'The filesystem image could not be resolved for this snapshot.',
              retryable: true,
              pluginId: 'agentcanvas.filesystem-images',
              elementId: element.id
            }
          ]
        })
  };
}
