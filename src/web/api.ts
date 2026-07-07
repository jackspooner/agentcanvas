import type {
  AssetDetailsResponse,
  AssetReference,
  CanvasRecord,
  CanvasViewport,
  CanvasViewportState
} from '../contracts';

export async function fetchCanvasList(limit = 200): Promise<CanvasRecord[]> {
  const response = await fetch(`/api/canvases?limit=${encodeURIComponent(String(limit))}`);
  if (!response.ok) throw new Error(`failed to load canvases: ${response.status}`);
  const body = await response.json();
  return Array.isArray(body.canvases) ? body.canvases : [];
}

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
  return {
    canvas: body.canvases?.[0] ?? {
      id: 'empty',
      title: 'No canvases yet',
      createdBy: 'system',
      createdAt: '',
      updatedAt: '',
      width: 1600,
      height: 1000,
      elements: [],
      revision: 0
    },
    readOnly: true
  };
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

export async function moveCanvasElement(
  canvasId: string,
  elementId: string,
  x: number,
  y: number
): Promise<CanvasRecord> {
  const response = await fetch(`/api/canvases/${encodeURIComponent(canvasId)}/elements:batch`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      actor: 'web-ui',
      operations: [{ op: 'patchElement', elementId, patch: { x, y } }]
    })
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(text || `failed to move element: ${response.status}`);
  }
  const body = await response.json();
  return body.canvas as CanvasRecord;
}

export async function fetchAssetDetails(assetRef: AssetReference): Promise<AssetDetailsResponse> {
  const response = await fetch(assetDetailsPath(assetRef));
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(text || `failed to load asset details: ${response.status}`);
  }
  return response.json() as Promise<AssetDetailsResponse>;
}

function assetDetailsPath(assetRef: AssetReference): string {
  if (assetRef.assetId)
    return `/api/assets/${encodeURIComponent(assetRef.project)}/${encodeURIComponent(assetRef.assetId)}/details`;
  if (assetRef.assetKey)
    return `/api/assets/${encodeURIComponent(assetRef.project)}/by-key/details?assetKey=${encodeURIComponent(assetRef.assetKey)}`;
  throw new Error('asset details require assetId or assetKey');
}
