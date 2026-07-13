import type { JsonObject } from '@agentcanvas/plugin-sdk';

export interface AssetReference {
  type: 'asset';
  project: string;
  assetId?: string;
  assetKey?: string;
  assetBaseUrl?: string;
}

export interface BBox {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  label?: string | null;
  color?: string | null;
  fill?: string | null;
  strokeWidth?: number | null;
  labelAlign?: 'left' | 'center' | 'right' | null;
  labelVerticalAlign?: 'top' | 'middle' | 'bottom' | null;
  labelPadding?: number | null;
  metadata?: JsonObject;
}

export interface BBoxData {
  canvasWidth?: number;
  canvasHeight?: number;
  boxes?: BBox[];
  layoutAssetRef?: AssetReference;
  imageAssetRef?: AssetReference | null;
  caption?: string | null;
  alt?: string | null;
  showLabels?: boolean | null;
  background?: string | null;
}

export interface OverlayPath {
  id: string;
  d: string;
  label?: string | null;
  color?: string | null;
  fill?: string | null;
  strokeWidth?: number | null;
  metadata?: JsonObject;
}

export interface PathData {
  canvasWidth: number;
  canvasHeight: number;
  paths: OverlayPath[];
  caption?: string | null;
  alt?: string | null;
  showLabels?: boolean | null;
  background?: string | null;
}

export interface ResolvedBBoxData {
  canvasWidth: number;
  canvasHeight: number;
  boxes: BBox[];
  imageHandle?: string;
  imageUrl?: string;
  caption?: string | null;
  alt?: string | null;
  showLabels?: boolean | null;
  background?: string | null;
}
