import type { EmbedSessionSummary } from '../embed-sessions';

export const AGENTCANVAS_EMBED_BRIDGE_VERSION = 1 as const;

export interface AgentCanvasHostMessage {
  source: 'agentcanvas.host';
  version: typeof AGENTCANVAS_EMBED_BRIDGE_VERSION;
  type: 'navigate' | 'refresh';
  canvasId?: string;
}

export function isAgentCanvasHostMessage(value: unknown): value is AgentCanvasHostMessage {
  if (!value || typeof value !== 'object') return false;
  const message = value as Record<string, unknown>;
  return (
    message.source === 'agentcanvas.host' &&
    message.version === AGENTCANVAS_EMBED_BRIDGE_VERSION &&
    (message.type === 'navigate' || message.type === 'refresh') &&
    (message.canvasId === undefined || typeof message.canvasId === 'string')
  );
}

export function embedTokenFromPath(pathname: string): string | null {
  const match = pathname.match(/^\/embed\/([^/]+)$/);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
}

export function embedCanvasUrl(token: string, canvasId: string): string {
  const url = new URL(`/embed/${encodeURIComponent(token)}`, window.location.origin);
  url.searchParams.set('canvasId', canvasId);
  return url.toString();
}

export function postEmbedMessage(
  session: EmbedSessionSummary,
  type: 'ready' | 'canvas.updated' | 'error',
  payload: Record<string, unknown>
): void {
  if (window.parent === window) return;
  window.parent.postMessage(
    {
      source: 'agentcanvas.embed',
      version: AGENTCANVAS_EMBED_BRIDGE_VERSION,
      type,
      sessionId: session.id,
      ...payload
    },
    session.parentOrigin
  );
}
