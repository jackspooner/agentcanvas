import type { CanvasElement, JsonObject } from '@agentcanvas/plugin-sdk';

export interface VideoData {
  assetRef: JsonObject;
  posterAssetRef: JsonObject | null;
  caption: string | null;
  alt: string | null;
  controls: boolean;
  autoplay: boolean;
  loop: boolean;
  muted: boolean;
}

function object(value: unknown, label: string): JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} must be an object`);
  return value as JsonObject;
}

export function videoData(element: Readonly<CanvasElement>): VideoData {
  return {
    assetRef: object(element.data.assetRef, 'video.assetRef'),
    posterAssetRef: element.data.posterAssetRef ? object(element.data.posterAssetRef, 'video.posterAssetRef') : null,
    caption: typeof element.data.caption === 'string' ? element.data.caption : null,
    alt: typeof element.data.alt === 'string' ? element.data.alt : null,
    controls: element.data.controls === true,
    autoplay: element.data.autoplay === true,
    loop: element.data.loop === true,
    muted: element.data.muted === true
  };
}
