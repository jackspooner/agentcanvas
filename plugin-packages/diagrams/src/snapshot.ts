import type {
  CanvasElement,
  CanvasThemeV1,
  SnapshotContribution,
  SnapshotResourcesCapabilityV1
} from '@agentcanvas/extension-sdk';
import type { ErdData } from './contracts.js';
import { renderErdScene } from './erd/render.js';
import { renderMermaidPng } from './mermaid/headless.js';

export function renderNativeSnapshot(
  element: Readonly<CanvasElement>,
  theme: Readonly<CanvasThemeV1>
): SnapshotContribution {
  const { nodes, bounds } = renderErdScene(element.data as unknown as ErdData, theme);
  const width = element.width ?? 960,
    height = element.height ?? 640;
  const scale = Math.min(width / Math.max(1, bounds.width), height / Math.max(1, bounds.height));
  return {
    space: 'frame',
    layer: 'content',
    nodes: [
      {
        kind: 'group',
        transform: [scale, 0, 0, scale, (width - bounds.width * scale) / 2, (height - bounds.height * scale) / 2],
        children: [{ kind: 'group', transform: [1, 0, 0, 1, -bounds.x, -bounds.y], children: nodes }]
      }
    ]
  };
}
export async function renderMermaidSnapshot(
  element: Readonly<CanvasElement>,
  theme: Readonly<CanvasThemeV1>,
  signal: AbortSignal,
  resources: SnapshotResourcesCapabilityV1
): Promise<SnapshotContribution> {
  const rendered = await renderMermaidPng(
    element.data.source as string,
    theme,
    element.width ?? 720,
    element.height ?? 480,
    signal
  );
  signal.throwIfAborted();
  const resource = resources.register({
    mimeType: 'image/png',
    byteLength: rendered.bytes.byteLength,
    width: rendered.width,
    height: rendered.height,
    ttlMs: 300_000,
    load: async () => ({ bytes: rendered.bytes, mimeType: 'image/png', width: rendered.width, height: rendered.height })
  });
  return {
    space: 'frame',
    layer: 'content',
    nodes: [
      {
        kind: 'imageHandle',
        x: 0,
        y: 0,
        width: element.width ?? 720,
        height: element.height ?? 480,
        handle: resource.handle,
        fit: 'contain',
        alt: String(element.data.title)
      }
    ],
    diagnostics: rendered.diagnostics.map((issue) => ({
      ...issue,
      severity: 'warning' as const,
      retryable: false,
      pluginId: 'agentcanvas.diagrams',
      elementId: element.id
    }))
  };
}
