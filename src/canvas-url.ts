/** Builds a browser URL for a persisted canvas using the deployment's public base URL. */
export function canvasPageUrl(publicBaseUrl: string, canvasId: string): string {
  return `${publicBaseUrl.replace(/\/+$/, '')}/canvases/${encodeURIComponent(canvasId)}`;
}

/** Builds a read-only share URL from a one-time share token. */
export function canvasShareUrl(publicBaseUrl: string, shareToken: string): string {
  return `${publicBaseUrl.replace(/\/+$/, '')}/c/${encodeURIComponent(shareToken)}`;
}
