import type { JsonObject } from './json.js';

export interface OpaqueResourceHandle {
  handle: string;
  url: string;
  mimeType: string;
  byteLength?: number;
  width?: number;
  height?: number;
  sha256?: string;
}

export interface ResourceDetails extends OpaqueResourceHandle {
  createdAt: string;
  expiresAt?: string;
}

export interface ResourcePayload {
  bytes: Uint8Array;
  mimeType: string;
  width?: number;
  height?: number;
}

export interface ResourceRegistration {
  mimeType: string;
  byteLength?: number;
  width?: number;
  height?: number;
  sha256?: string;
  /**
   * Provider-backed resources may keep their identity while their bytes change.
   * The host still validates MIME type, size limits, and computes the current
   * checksum, but does not compare the payload with registration-time size or
   * checksum hints.
   */
  mutable?: boolean;
  ttlMs?: number;
  load(signal: AbortSignal): Promise<ResourcePayload>;
}

export interface SnapshotResourcesCapabilityV1 {
  register(registration: ResourceRegistration): OpaqueResourceHandle;
  details(handle: string): ResourceDetails | null;
  load(handle: string, signal: AbortSignal): Promise<ResourcePayload | null>;
}

export interface AssetsCapabilityV1 {
  validateReference(value: unknown): JsonObject;
  details(reference: Readonly<JsonObject>, signal: AbortSignal): Promise<JsonObject>;
  contentHandle(reference: Readonly<JsonObject>, signal: AbortSignal): Promise<OpaqueResourceHandle>;
  boundedJson(reference: Readonly<JsonObject>, signal: AbortSignal): Promise<JsonObject>;
  providerStatus(signal?: AbortSignal): Promise<{
    ok: boolean;
    identity?: string;
    capabilities?: readonly string[];
    code?: string;
    retryable?: boolean;
  }>;
}

export const IMAGE_SOURCES_CAPABILITY = 'agentcanvas.image-sources' as const;
export const IMAGE_SOURCES_CAPABILITY_VERSION = '1.0.0' as const;

/** A stable image identity whose provider-specific payload is owned by an image-source extension. */
export interface ImageSourceReference {
  provider: string;
  reference: JsonObject;
}

/** Adapter registered by an image-source extension with the host image-source registry. */
export interface ImageSourceProviderV1 {
  provider: string;
  validateReference(value: unknown): JsonObject;
  resolve(reference: Readonly<JsonObject>, signal: AbortSignal): Promise<OpaqueResourceHandle>;
}

/** Host-owned registry that lets elements consume images without depending on a storage provider. */
export interface ImageSourcesCapabilityV1 {
  registerProvider(provider: ImageSourceProviderV1): void;
  hasProvider(provider: string): boolean;
  listProviders(): readonly string[];
  validateReference(value: unknown): ImageSourceReference;
  resolve(value: unknown, signal: AbortSignal): Promise<OpaqueResourceHandle>;
}
