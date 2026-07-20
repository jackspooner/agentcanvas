import type {
  CanvasElement,
  CanvasThemeV1,
  JsonObject,
  SnapshotContribution,
  SnapshotNode
} from '@agentcanvas/plugin-sdk';
import { DEFAULT_CANVAS_THEME } from '@agentcanvas/plugin-sdk';
import { fileSystemImageData, fitToObjectFit } from './contracts.js';

export function renderFileSystemImageSnapshot(
  element: Readonly<CanvasElement>,
  runtime: Readonly<JsonObject> | null,
  theme: Readonly<CanvasThemeV1> = DEFAULT_CANVAS_THEME
): SnapshotContribution {
  const data = fileSystemImageData(element.data);
  const width = element.width ?? 320;
  const height = element.height ?? 240;
  const captionHeight = data.caption ? 30 : 0;
  const contentHeight = Math.max(1, height - captionHeight);
  const handle = typeof runtime?.contentHandle === 'string' ? runtime.contentHandle : null;
  const style = element.style ?? {};
  const background = typeof style.background === 'string' ? style.background : theme.colors.surfaceMuted;
  const border = typeof style.borderColor === 'string' ? style.borderColor : theme.colors.border;
  const borderWidth = typeof style.borderWidth === 'number' ? style.borderWidth : theme.shape.borderWidth;
  const radius = typeof style.borderRadius === 'number' ? style.borderRadius : theme.shape.radius;
  const nodes: SnapshotNode[] = [
    {
      kind: 'rect',
      x: 0,
      y: 0,
      width,
      height,
      rx: radius,
      fill: background,
      stroke: border,
      strokeWidth: borderWidth
    }
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
      fill: theme.colors.textMuted,
      fontFamily: theme.typography.bodyFont,
      fontSize: 14,
      fontWeight: 600,
      textAnchor: 'middle',
      maxWidth: width - 24
    });
  }
  if (data.caption) {
    nodes.push({ kind: 'rect', x: 0, y: contentHeight, width, height: captionHeight, fill: theme.colors.surface });
    nodes.push({
      kind: 'text',
      x: 10,
      y: contentHeight + 20,
      text: data.caption,
      fill: theme.colors.text,
      fontFamily: theme.typography.bodyFont,
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
