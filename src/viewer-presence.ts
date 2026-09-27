import { CanvasError } from './errors.js';

export const VIEWER_PRESENCE_TTL_MS = 30_000;
export const VIEWER_PRESENCE_MAX_ACTIVE = 1_000;

export interface ViewerViewport {
  centerX: number;
  centerY: number;
  zoom: number;
  width: number;
  height: number;
}

export interface ActiveViewer {
  viewerId: string;
  viewport: ViewerViewport;
  lastSeenAt: string;
}

interface ViewerEntry extends ActiveViewer {
  canvasId: string;
  seenAt: number;
}

/** Transient browser presence, separate from persisted user and agent viewports. */
export class ViewerPresenceRegistry {
  private readonly entries = new Map<string, ViewerEntry>();

  constructor(private readonly now: () => number = Date.now) {}

  upsert(canvasId: string, viewerId: string, viewport: ViewerViewport): void {
    const now = this.now();
    this.prune(now);
    const key = JSON.stringify([canvasId, viewerId]);
    if (!this.entries.has(key) && this.entries.size >= VIEWER_PRESENCE_MAX_ACTIVE) {
      throw new CanvasError(
        'viewer_presence_capacity',
        'the active viewer limit has been reached',
        'storage',
        503,
        true
      );
    }
    this.entries.set(key, { canvasId, viewerId, viewport, seenAt: now, lastSeenAt: new Date(now).toISOString() });
  }

  remove(canvasId: string, viewerId: string): void {
    this.entries.delete(JSON.stringify([canvasId, viewerId]));
  }

  list(canvasId: string): { canvasId: string; asOf: string; viewers: ActiveViewer[] } {
    const now = this.now();
    this.prune(now);
    return {
      canvasId,
      asOf: new Date(now).toISOString(),
      viewers: [...this.entries.values()]
        .filter((entry) => entry.canvasId === canvasId)
        .map(({ viewerId, viewport, lastSeenAt }) => ({ viewerId, viewport, lastSeenAt }))
        .sort((left, right) => left.viewerId.localeCompare(right.viewerId))
    };
  }

  private prune(now: number): void {
    for (const [key, entry] of this.entries) {
      if (now - entry.seenAt >= VIEWER_PRESENCE_TTL_MS) this.entries.delete(key);
    }
  }
}
