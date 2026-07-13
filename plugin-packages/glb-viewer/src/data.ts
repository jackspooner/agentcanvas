import type { CanvasElement, JsonObject } from '@agentcanvas/plugin-sdk';

export interface ModelData {
  assetRef: JsonObject;
  posterAssetRef: JsonObject | null;
  caption: string | null;
  alt: string | null;
  cameraControls: boolean;
  autoRotate: boolean;
}

function object(value: unknown, label: string): JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} must be an object`);
  return value as JsonObject;
}

export function modelData(element: Readonly<CanvasElement>): ModelData {
  return {
    assetRef: object(element.data.assetRef, 'model.assetRef'),
    posterAssetRef: element.data.posterAssetRef ? object(element.data.posterAssetRef, 'model.posterAssetRef') : null,
    caption: typeof element.data.caption === 'string' ? element.data.caption : null,
    alt: typeof element.data.alt === 'string' ? element.data.alt : null,
    cameraControls: element.data.cameraControls === true,
    autoRotate: element.data.autoRotate === true
  };
}
