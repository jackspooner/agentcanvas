import type { CanvasViewport } from '../contracts';

export const DEFAULT_REPORTED_VIEWPORT_WIDTH = 1920;
export const DEFAULT_REPORTED_VIEWPORT_HEIGHT = 900;

export function viewportCookieName(canvasId: string): string {
  return `agent_canvas_view_${encodeURIComponent(canvasId)}`;
}

export function readViewportCookie(canvasId: string): Partial<CanvasViewport> | null {
  if (typeof document === 'undefined') return null;
  const name = `${viewportCookieName(canvasId)}=`;
  const entry = document.cookie.split('; ').find((part) => part.startsWith(name));
  if (!entry) return null;
  try {
    return JSON.parse(decodeURIComponent(entry.slice(name.length))) as Partial<CanvasViewport>;
  } catch {
    return null;
  }
}

export function writeViewportCookie(
  canvasId: string,
  viewport: Pick<CanvasViewport, 'centerX' | 'centerY' | 'zoom'>
): void {
  if (typeof document === 'undefined') return;
  const value = encodeURIComponent(
    JSON.stringify({ centerX: viewport.centerX, centerY: viewport.centerY, zoom: viewport.zoom })
  );
  document.cookie = `${viewportCookieName(canvasId)}=${value}; Max-Age=31536000; Path=/; SameSite=Lax`;
}

export function coerceViewport(input: Partial<CanvasViewport> | null | undefined): CanvasViewport {
  return {
    centerX: Number.isFinite(input?.centerX) ? Number(input?.centerX) : 0,
    centerY: Number.isFinite(input?.centerY) ? Number(input?.centerY) : 0,
    zoom: Number.isFinite(input?.zoom) ? Math.min(Math.max(Number(input?.zoom), 0.05), 8) : 1,
    width: Number.isFinite(input?.width) ? Math.round(Number(input?.width)) : DEFAULT_REPORTED_VIEWPORT_WIDTH,
    height: Number.isFinite(input?.height) ? Math.round(Number(input?.height)) : DEFAULT_REPORTED_VIEWPORT_HEIGHT,
    source: input?.source ?? 'default',
    updatedAt: input?.updatedAt ?? null
  };
}
