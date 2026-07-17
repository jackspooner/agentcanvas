import type { JsonObject } from '@agentcanvas/plugin-sdk';

export type FileSystemImageFit = 'contain' | 'cover' | 'stretch' | 'original';

export interface FileSystemImageSource {
  rootId: string;
  path: string;
}

export interface FileSystemImageElementData {
  source: FileSystemImageSource;
  caption?: string | null;
  fit?: FileSystemImageFit | null;
  alt?: string | null;
}

export interface FileSystemRootConfig {
  id: string;
  path: string;
}

export interface FileSystemImagesConfig {
  roots: readonly FileSystemRootConfig[];
  contentMaxBytes: number;
  resourceTtlMs: number;
}

export function fileSystemImageData(value: Readonly<JsonObject>): FileSystemImageElementData {
  return value as unknown as FileSystemImageElementData;
}

export function fitToObjectFit(fit: FileSystemImageFit | null | undefined): 'contain' | 'cover' | 'fill' | 'none' {
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
