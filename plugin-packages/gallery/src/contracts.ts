import type { ImageSourceReference, JsonObject } from '@agentcanvas/plugin-sdk';

export type GalleryFit = 'contain' | 'cover' | 'stretch' | 'original';

export interface GalleryItem {
  id: string;
  source: ImageSourceReference;
  caption?: string | null;
  alt?: string | null;
}

export interface GalleryData {
  items: GalleryItem[];
  presentation: 'carousel';
  fit: GalleryFit;
  initialIndex: number;
  autoplay: boolean;
  intervalMs: number;
  showControls: boolean;
  showIndicators: boolean;
}

export function galleryData(value: Readonly<JsonObject>): GalleryData {
  return value as unknown as GalleryData;
}

export function fitToObjectFit(fit: GalleryFit): 'contain' | 'cover' | 'fill' | 'none' {
  if (fit === 'cover') return 'cover';
  if (fit === 'stretch') return 'fill';
  if (fit === 'original') return 'none';
  return 'contain';
}
