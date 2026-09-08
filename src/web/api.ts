import type { AgentCanvasConfiguration, UpdateAgentCanvasConfigurationInput } from '../configuration';
import type { CanvasThemeV1 } from '@agentcanvas/plugin-sdk';
import type { CanvasBounds, CanvasOperation, CanvasViewport, CanvasViewportState } from '../contracts';
import type { CanvasDocument, CanvasProjection } from './v2-types';
import type {
  MacroDefinitionRecord,
  MacroExecutionResult,
  MacroGetRequest,
  MacroListRequest,
  MacroListResponse,
  MacroServiceExecuteRequest,
  MacroServicePlanRequest,
  MacroPlan
} from '../macros/types';
import type { EmbedSessionSummary } from '../embed-sessions';

async function jsonResponse<T>(response: Response, label: string): Promise<T> {
  if (!response.ok) {
    const problem = await response.json().catch(() => null);
    const detail = typeof problem?.detail === 'string' ? problem.detail : `${label}: ${response.status}`;
    const requestId = typeof problem?.requestId === 'string' ? problem.requestId : response.headers.get('x-request-id');
    throw Object.assign(new Error(`${detail}${requestId ? ` (request ${requestId})` : ''}`), {
      status: response.status,
      code: typeof problem?.code === 'string' ? problem.code : undefined,
      requestId
    });
  }
  return response.json() as Promise<T>;
}

export async function fetchCanvasList(limit = 200): Promise<CanvasDocument[]> {
  const body = await jsonResponse<{ canvases?: CanvasDocument[] }>(
    await fetch(`/api/v1/canvases?limit=${encodeURIComponent(String(limit))}`),
    'failed to load canvases'
  );
  return Array.isArray(body.canvases) ? (body.canvases as CanvasDocument[]) : [];
}

export async function fetchAgentCanvasConfiguration(): Promise<AgentCanvasConfiguration> {
  const body = await jsonResponse<{ configuration: AgentCanvasConfiguration }>(
    await fetch('/api/v1/configuration'),
    'failed to load AgentCanvas configuration'
  );
  return body.configuration as AgentCanvasConfiguration;
}

export async function updateAgentCanvasConfiguration(
  settings: UpdateAgentCanvasConfigurationInput
): Promise<AgentCanvasConfiguration> {
  const body = await jsonResponse<{ configuration: AgentCanvasConfiguration }>(
    await fetch('/api/v1/configuration', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...settings, actor: 'web-ui' })
    }),
    'failed to update AgentCanvas configuration'
  );
  return body.configuration as AgentCanvasConfiguration;
}

export async function fetchCanvasFromLocation(): Promise<
  CanvasProjection & { readOnly: boolean; embedSession?: EmbedSessionSummary }
> {
  const current = window.location.pathname;
  if (current.startsWith('/embed/')) {
    const token = current.split('/').pop();
    const selectedCanvasId = new URLSearchParams(window.location.search).get('canvasId');
    const query = selectedCanvasId ? `?canvasId=${encodeURIComponent(selectedCanvasId)}` : '';
    const body = await jsonResponse<CanvasProjection & { session: EmbedSessionSummary; readOnly: boolean }>(
      await fetch(`/api/v1/embed-sessions/${encodeURIComponent(token ?? '')}${query}`),
      'failed to load embedded canvas'
    );
    return {
      canvas: body.canvas as CanvasDocument,
      elementRuntime: (body.elementRuntime ?? {}) as CanvasProjection['elementRuntime'],
      diagnostics: (body.diagnostics ?? []) as CanvasProjection['diagnostics'],
      readOnly: body.readOnly,
      embedSession: body.session
    };
  }
  if (current.startsWith('/c/')) {
    const token = current.split('/').pop();
    const body = await jsonResponse<{
      canvas: CanvasDocument;
      elementRuntime?: CanvasProjection['elementRuntime'];
      diagnostics?: CanvasProjection['diagnostics'];
    }>(await fetch(`/api/v1/share/${encodeURIComponent(token ?? '')}`), 'failed to load share canvas');
    return {
      canvas: body.canvas as CanvasDocument,
      elementRuntime: (body.elementRuntime ?? {}) as CanvasProjection['elementRuntime'],
      diagnostics: (body.diagnostics ?? []) as CanvasProjection['diagnostics'],
      readOnly: true
    };
  }
  const match = current.match(/^\/canvases\/([^/]+)/);
  if (match) {
    const body = await jsonResponse<{
      canvas: CanvasDocument;
      elementRuntime?: CanvasProjection['elementRuntime'];
      diagnostics?: CanvasProjection['diagnostics'];
    }>(await fetch(`/api/v1/canvases/${encodeURIComponent(match[1])}`), 'failed to load canvas');
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
  const body = await jsonResponse<{ canvas: CanvasDocument }>(
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
  const body = await jsonResponse<{ canvas: CanvasDocument }>(
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
  const body = await jsonResponse<{ userViewport: CanvasViewport; agentViewport?: CanvasViewport | null }>(
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
  await jsonResponse(response, 'failed to save viewport');
}

export async function applyCanvasOperations(
  canvasId: string,
  operations: readonly CanvasOperation[],
  expectedRevision?: number
): Promise<CanvasProjection> {
  return jsonResponse<CanvasProjection>(
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
}

export async function fetchMacroList(request: MacroListRequest = {}): Promise<MacroListResponse> {
  const query = new URLSearchParams();
  if (request.canvasId) query.set('canvasId', request.canvasId);
  if (request.includeArchived !== undefined) query.set('includeArchived', String(request.includeArchived));
  if (request.limit !== undefined) query.set('limit', String(request.limit));
  if (request.cursor) query.set('cursor', request.cursor);
  const suffix = query.toString();
  return jsonResponse<MacroListResponse>(
    await fetch(`/api/v1/macros${suffix ? `?${suffix}` : ''}`),
    'failed to load macros'
  );
}

export async function fetchMacroDefinition(request: MacroGetRequest): Promise<MacroDefinitionRecord> {
  const query = request.canvasId === undefined ? '' : `?canvasId=${encodeURIComponent(request.canvasId)}`;
  return jsonResponse<MacroDefinitionRecord>(
    await fetch(
      `/api/v1/macros/${encodeURIComponent(request.macroId)}/versions/${encodeURIComponent(String(request.macroVersion))}${query}`
    ),
    'failed to load macro version'
  );
}

export async function planMacro(request: Omit<MacroServicePlanRequest, 'now'>): Promise<MacroPlan> {
  return jsonResponse<MacroPlan>(
    await fetch(
      `/api/v1/canvases/${encodeURIComponent(request.canvasId)}/macros/${encodeURIComponent(request.macroId)}:plan`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          macroVersion: request.macroVersion,
          anchor: request.anchor,
          input: request.input,
          ...(request.label === undefined ? {} : { label: request.label })
        })
      }
    ),
    'failed to preview macro'
  );
}

export async function executeMacro(request: MacroServiceExecuteRequest): Promise<MacroExecutionResult> {
  return jsonResponse<MacroExecutionResult>(
    await fetch(`/api/v1/canvases/${encodeURIComponent(request.canvasId)}/macros:execute`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        planId: request.planId,
        expectedRevision: request.expectedRevision,
        idempotencyKey: request.idempotencyKey
      })
    }),
    'failed to run macro'
  );
}
