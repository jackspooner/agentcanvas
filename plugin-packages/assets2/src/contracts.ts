import type { JsonObject } from '@agentcanvas/plugin-sdk';

export const ASSETS_CAPABILITY = 'agentcanvas.assets' as const;
export const ASSETS_CAPABILITY_VERSION = '1.0.0' as const;
export const ASSETS_SERVICE_IDENTITY = 'asset-service' as const;

export type AssetFit = 'contain' | 'cover' | 'stretch' | 'original';

export interface AssetReference {
  type: 'asset';
  project: string;
  assetId?: string;
  assetKey?: string;
  assetBaseUrl?: string;
}

export interface AssetElementData {
  assetRef: AssetReference;
  caption?: string | null;
  fit?: AssetFit | null;
  alt?: string | null;
}

export interface AssetsProviderIdentity {
  service: typeof ASSETS_SERVICE_IDENTITY;
  version: string | null;
  baseUrl: string;
  capabilities: {
    assetCrud: true;
    assetRefs: true;
  };
}

export interface AssetsPluginConfig {
  baseUrl: string;
  fetchTimeoutMs: number;
  metadataMaxBytes: number;
  previewMaxBytes: number;
  contentMaxBytes: number;
}

export function assetElementData(value: Readonly<JsonObject>): AssetElementData {
  return value as unknown as AssetElementData;
}

export function fitToObjectFit(fit: AssetFit | null | undefined): 'contain' | 'cover' | 'fill' | 'none' {
  switch (fit ?? 'contain') {
    case 'cover':
      return 'cover';
    case 'stretch':
      return 'fill';
    case 'original':
      return 'none';
    default:
      return 'contain';
  }
}
