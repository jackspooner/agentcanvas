import type {
  CanvasElement,
  CanvasThemeV1,
  JsonObject,
  SnapshotContribution,
  SnapshotNode
} from '@agentcanvas/plugin-sdk';
import { DEFAULT_CANVAS_THEME } from '@agentcanvas/plugin-sdk';
import { fitToObjectFit, galleryData } from './contracts.js';

interface RuntimeGalleryItem {
  id: string;
  contentHandle?: string;
  message?: string;
  state?: string;
}

function runtimeItems(runtime: Readonly<JsonObject> | null): RuntimeGalleryItem[] {
  if (!Array.isArray(runtime?.items)) return [];
  return (runtime.items as unknown[]).flatMap((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item) || typeof (item as { id?: unknown }).id !== 'string') {
      return [];
    }
    const candidate = item as { id: string; contentHandle?: unknown; message?: unknown; state?: unknown };
    return [
      {
        id: candidate.id,
        ...(typeof candidate.contentHandle === 'string' ? { contentHandle: candidate.contentHandle } : {}),
        ...(typeof candidate.message === 'string' ? { message: candidate.message } : {}),
        ...(typeof candidate.state === 'string' ? { state: candidate.state } : {})
      }
    ];
  });
}

export function renderGallerySnapshot(
  element: Readonly<CanvasElement>,
  runtime: Readonly<JsonObject> | null,
  theme: Readonly<CanvasThemeV1> = DEFAULT_CANVAS_THEME
): SnapshotContribution {
  const data = galleryData(element.data);
  const width = element.width ?? 480;
  const height = element.height ?? 320;
  const cover = data.items[data.initialIndex] ?? data.items[0];
  const resolved = runtimeItems(runtime).find((item) => item.id === cover.id);
  const style = element.style ?? {};
  const background = typeof style.background === 'string' ? style.background : theme.colors.surfaceMuted;
  const border = typeof style.borderColor === 'string' ? style.borderColor : theme.colors.border;
  const borderWidth = typeof style.borderWidth === 'number' ? style.borderWidth : theme.shape.borderWidth;
  const radius = typeof style.borderRadius === 'number' ? style.borderRadius : theme.shape.radius;
  const color = typeof style.color === 'string' ? style.color : theme.colors.text;
  const captionBackground =
    typeof style.captionBackground === 'string' ? style.captionBackground : theme.colors.surface;
  const footerHeight = cover.caption || data.showIndicators ? 34 : 0;
  const contentHeight = Math.max(1, height - footerHeight);
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
  if (resolved?.contentHandle) {
    nodes.push({
      kind: 'imageHandle',
      x: 0,
      y: 0,
      width,
      height: contentHeight,
      handle: resolved.contentHandle,
      fit: fitToObjectFit(data.fit),
      alt: cover.alt ?? cover.caption ?? `Gallery image ${data.initialIndex + 1}`
    });
  } else {
    nodes.push({
      kind: 'text',
      x: width / 2,
      y: contentHeight / 2,
      text: resolved?.message ?? 'Image unavailable',
      fill: theme.colors.textMuted,
      fontFamily: theme.typography.bodyFont,
      fontSize: 14,
      fontWeight: 600,
      textAnchor: 'middle',
      maxWidth: width - 24
    });
  }
  if (footerHeight) {
    nodes.push({ kind: 'rect', x: 0, y: contentHeight, width, height: footerHeight, fill: captionBackground });
    if (cover.caption) {
      nodes.push({
        kind: 'text',
        x: 10,
        y: contentHeight + 22,
        text: cover.caption,
        fill: color,
        fontFamily: theme.typography.bodyFont,
        fontSize: 12,
        maxWidth: Math.max(1, width - (data.showIndicators ? 72 : 20))
      });
    }
    if (data.showIndicators) {
      nodes.push({
        kind: 'text',
        x: width - 10,
        y: contentHeight + 22,
        text: `${data.initialIndex + 1} / ${data.items.length}`,
        fill: theme.colors.textMuted,
        fontFamily: theme.typography.bodyFont,
        fontSize: 12,
        fontWeight: 600,
        textAnchor: 'end'
      });
    }
  }
  return {
    space: 'frame',
    layer: 'content',
    nodes,
    ...(resolved?.contentHandle || resolved?.state
      ? {}
      : {
          diagnostics: [
            {
              code: 'gallery_cover_unavailable',
              severity: 'warning',
              message: 'The gallery cover image could not be resolved for this snapshot.',
              retryable: true,
              pluginId: 'agentcanvas.gallery',
              elementId: element.id
            }
          ]
        })
  };
}
