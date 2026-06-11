import type { CanvasRecord, CanvasViewport, CanvasViewportState } from '../contracts';

export async function fetchCanvasFromLocation(): Promise<{ canvas: CanvasRecord; readOnly: boolean }> {
  const path = window.location.pathname;
  if (path.startsWith('/c/')) {
    const token = path.split('/').pop();
    const response = await fetch(`/api/share/${token}`);
    if (!response.ok) throw new Error(`failed to load share canvas: ${response.status}`);
    const body = await response.json();
    return { canvas: body.canvas, readOnly: true };
  }
  const match = path.match(/^\/canvases\/([^/]+)/);
  if (match) {
    const response = await fetch(`/api/canvases/${match[1]}`);
    if (!response.ok) throw new Error(`failed to load canvas: ${response.status}`);
    const body = await response.json();
    return { canvas: body.canvas, readOnly: false };
  }
  const response = await fetch('/api/canvases?limit=1');
  const body = await response.json();
  return { canvas: body.canvases?.[0] ?? { id: 'empty', title: 'No canvases yet', createdBy: 'system', createdAt: '', updatedAt: '', width: 1600, height: 1000, elements: [], revision: 0 }, readOnly: true };
}

export async function fetchViewportState(canvasId: string): Promise<CanvasViewportState> {
  const response = await fetch(`/api/canvases/${encodeURIComponent(canvasId)}/viewport`);
  if (!response.ok) throw new Error(`failed to load viewport: ${response.status}`);
  const body = await response.json();
  return { userViewport: body.userViewport, agentViewport: body.agentViewport ?? null };
}

export async function saveUserViewport(canvasId: string, viewport: CanvasViewport): Promise<void> {
  await fetch(`/api/canvases/${encodeURIComponent(canvasId)}/viewport`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      source: 'user',
      centerX: viewport.centerX,
      centerY: viewport.centerY,
      zoom: viewport.zoom,
      width: viewport.width,
      height: viewport.height
    })
  });
}
