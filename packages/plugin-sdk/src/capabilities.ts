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
