import type { AgentCanvasConfiguration } from '../configuration';
import type { CanvasThemeV1 } from '@agentcanvas/plugin-sdk';
import type { CanvasBounds, CanvasOperation, CanvasViewport, CanvasViewportState } from '../contracts';
import type { CanvasDocument, CanvasProjection } from './v2-types';

async function jsonResponse(response: Response, label: string): Promise<Record<string, unknown>> {
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(detail || `${label}: ${response.status}`);
  }
  return response.json() as Promise<Record<string, unknown>>;
}

export async function fetchCanvasList(limit = 200): Promise<CanvasDocument[]> {
  const body = await jsonResponse(
    await fetch(`/api/v1/canvases?limit=${encodeURIComponent(String(limit))}`),
    'failed to load canvases'
  );
  return Array.isArray(body.canvases) ? (body.canvases as CanvasDocument[]) : [];
}

export async function fetchAgentCanvasConfiguration(): Promise<AgentCanvasConfiguration> {
  const body = await jsonResponse(await fetch('/api/v1/configuration'), 'failed to load AgentCanvas configuration');
  return body.configuration as AgentCanvasConfiguration;
}

export async function updateAgentCanvasConfiguration(
  defaultCanvasSize: CanvasBounds
): Promise<AgentCanvasConfiguration> {
  const body = await jsonResponse(
    await fetch('/api/v1/configuration', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ defaultCanvasSize, actor: 'web-ui' })
    }),
    'failed to update AgentCanvas configuration'
  );
  return body.configuration as AgentCanvasConfiguration;
}

export async function fetchCanvasFromLocation(): Promise<CanvasProjection & { readOnly: boolean }> {
  const current = window.location.pathname;
  if (current.startsWith('/c/')) {
    const token = current.split('/').pop();
    const body = await jsonResponse(
      await fetch(`/api/v1/share/${encodeURIComponent(token ?? '')}`),
      'failed to load share canvas'
    );
    return {
      canvas: body.canvas as CanvasDocument,
      elementRuntime: (body.elementRuntime ?? {}) as CanvasProjection['elementRuntime'],
      diagnostics: (body.diagnostics ?? []) as CanvasProjection['diagnostics'],
      readOnly: true
    };
  }
  const match = current.match(/^\/canvases\/([^/]+)/);
  if (match) {
    const body = await jsonResponse(
      await fetch(`/api/v1/canvases/${encodeURIComponent(match[1])}`),
      'failed to load canvas'
    );
    return {
      canvas: body.canvas as CanvasDocument,
      elementRuntime: (body.elementRuntime ?? {}) as CanvasProjection['elementRuntime'],
      diagnostics: (body.diagnostics ?? []) as CanvasProjection['diagnostics'],
      readOnly: false
    };
  }
  const canvases = await fetchCanvasList(1);
  return {
    canvas:
      canvases[0] ??
      ({
        id: 'empty',
        title: 'No canvases yet',
        createdBy: 'system',
        createdAt: '',
        updatedAt: '',
        bounds: { mode: 'unlimited' },
        elements: [],
        revision: 0,
        documentVersion: 2
      } satisfies CanvasDocument),
    elementRuntime: {},
    diagnostics: [],
    readOnly: true
  };
}

export async function updateCanvasBounds(
  canvasId: string,
  bounds: CanvasBounds,
  expectedRevision?: number
): Promise<CanvasDocument> {
  const body = await jsonResponse(
    await fetch(`/api/v1/canvases/${encodeURIComponent(canvasId)}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ bounds, expectedRevision, actor: 'web-ui' })
    }),
    'failed to update canvas bounds'
  );
  return body.canvas as CanvasDocument;
}

export async function updateCanvasTheme(
  canvasId: string,
  theme: CanvasThemeV1 | null,
  expectedRevision?: number
): Promise<CanvasDocument> {
  const body = await jsonResponse(
    await fetch(`/api/v1/canvases/${encodeURIComponent(canvasId)}/theme`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ theme, expectedRevision, actor: 'web-ui' })
    }),
    'failed to update canvas theme'
  );
  return body.canvas as CanvasDocument;
}

export async function fetchViewportState(canvasId: string): Promise<CanvasViewportState> {
  const body = await jsonResponse(
    await fetch(`/api/v1/canvases/${encodeURIComponent(canvasId)}/viewport`),
    'failed to load viewport'
  );
  return {
    userViewport: body.userViewport as CanvasViewport,
    agentViewport: (body.agentViewport as CanvasViewport) ?? null
  };
}

export async function saveUserViewport(canvasId: string, viewport: CanvasViewport): Promise<void> {
  const response = await fetch(`/api/v1/canvases/${encodeURIComponent(canvasId)}/viewport`, {
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
  if (!response.ok) throw new Error(`failed to save viewport: ${response.status}`);
}

export async function applyCanvasOperations(
  canvasId: string,
  operations: readonly CanvasOperation[],
  expectedRevision?: number
): Promise<CanvasDocument> {
  const body = await jsonResponse(
    await fetch(`/api/v1/canvases/${encodeURIComponent(canvasId)}/elements:batch`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        actor: 'web-ui',
        expectedRevision,
        operations
      })
    }),
    'failed to update canvas elements'
  );
  return body.canvas as CanvasDocument;
}
