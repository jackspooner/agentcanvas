import { createHash, randomBytes } from 'node:crypto';
import type {
  OpaqueResourceHandle,
  ResourceDetails,
  ResourcePayload,
  ResourceRegistration,
  SnapshotResourcesCapabilityV1
} from '@agentcanvas/plugin-sdk';

const SAFE_MIME_TYPES = new Set([
  'image/svg+xml',
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'image/avif',
  'video/mp4',
  'video/webm',
  'model/gltf-binary',
  'model/gltf+json',
  'application/json',
  'application/zip'
]);

interface StoredResource {
  details: ResourceDetails;
  registration: ResourceRegistration;
}

export interface ResourceBrokerOptions {
  maxBytes?: number;
  defaultTtlMs?: number;
  maximumTtlMs?: number;
  now?: () => number;
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function checkMimeType(value: string): string {
  const mimeType = value.trim().toLowerCase();
  if (!SAFE_MIME_TYPES.has(mimeType)) throw new Error(`resource MIME type is not allowed: ${mimeType}`);
  return mimeType;
}

export class ResourceBroker implements SnapshotResourcesCapabilityV1 {
  private readonly resources = new Map<string, StoredResource>();
  private readonly maxBytes: number;
  private readonly defaultTtlMs: number;
  private readonly maximumTtlMs: number;
  private readonly now: () => number;
  private expirationTimer: ReturnType<typeof setTimeout> | undefined;
  private nextExpiration = Infinity;
  private disposed = false;

  constructor(options: ResourceBrokerOptions = {}) {
    // Provider-specific limits are normally lower; this remains the independent host ceiling.
    this.maxBytes = options.maxBytes ?? 512 * 1024 * 1024;
    this.defaultTtlMs = options.defaultTtlMs ?? 60 * 60 * 1_000;
    this.maximumTtlMs = options.maximumTtlMs ?? 24 * 60 * 60 * 1_000;
    this.now = options.now ?? Date.now;
  }

  register(registration: ResourceRegistration): OpaqueResourceHandle {
    if (this.disposed) throw new Error('Resource broker is disposed');
    const mimeType = checkMimeType(registration.mimeType);
    if (
      registration.byteLength !== undefined &&
      (!Number.isSafeInteger(registration.byteLength) || registration.byteLength < 0)
    ) {
      throw new Error('resource byteLength must be a non-negative safe integer');
    }
    if (registration.byteLength !== undefined && registration.byteLength > this.maxBytes) {
      throw new Error(`resource exceeds ${this.maxBytes} byte limit`);
    }
    const ttlMs = registration.ttlMs ?? this.defaultTtlMs;
    if (!Number.isSafeInteger(ttlMs) || ttlMs < 1 || ttlMs > this.maximumTtlMs) {
      throw new Error(`resource ttlMs must be from 1 through ${this.maximumTtlMs}`);
    }
    const handle = `res_${randomBytes(24).toString('base64url')}`;
    const created = this.now();
    const details: ResourceDetails = {
      handle,
      url: `/api/v1/resources/${encodeURIComponent(handle)}/content`,
      mimeType,
      createdAt: new Date(created).toISOString(),
      expiresAt: new Date(created + ttlMs).toISOString(),
      ...(registration.byteLength !== undefined ? { byteLength: registration.byteLength } : {}),
      ...(registration.width !== undefined ? { width: registration.width } : {}),
      ...(registration.height !== undefined ? { height: registration.height } : {}),
      ...(registration.sha256 ? { sha256: registration.sha256 } : {})
    };
    this.resources.set(handle, { details, registration });
    this.scheduleExpiration(created + ttlMs);
    return Object.freeze({
      handle,
      url: details.url,
      mimeType,
      ...(details.byteLength !== undefined ? { byteLength: details.byteLength } : {}),
      ...(details.width !== undefined ? { width: details.width } : {}),
      ...(details.height !== undefined ? { height: details.height } : {}),
      ...(details.sha256 ? { sha256: details.sha256 } : {})
    });
  }

  registerBytes(
    bytes: Uint8Array,
    metadata: Omit<ResourceRegistration, 'load' | 'byteLength' | 'sha256'>
  ): OpaqueResourceHandle {
    const stable = Uint8Array.from(bytes);
    return this.register({
      ...metadata,
      byteLength: stable.byteLength,
      sha256: sha256(stable),
      load: async () => ({
        bytes: Uint8Array.from(stable),
        mimeType: metadata.mimeType,
        ...(metadata.width !== undefined ? { width: metadata.width } : {}),
        ...(metadata.height !== undefined ? { height: metadata.height } : {})
      })
    });
  }

  details(handle: string): ResourceDetails | null {
    const resource = this.live(handle);
    return resource ? Object.freeze({ ...resource.details }) : null;
  }

  async load(handle: string, signal: AbortSignal): Promise<ResourcePayload | null> {
    const resource = this.live(handle);
    if (!resource) return null;
    const payload = await resource.registration.load(signal);
    if (!ArrayBuffer.isView(payload.bytes) || payload.bytes.BYTES_PER_ELEMENT !== 1) {
      throw new Error('resource loader must return Uint8Array bytes');
    }
    const bytes = Uint8Array.from(payload.bytes);
    if (bytes.byteLength > this.maxBytes) throw new Error(`resource exceeds ${this.maxBytes} byte limit`);
    const mimeType = checkMimeType(payload.mimeType);
    if (mimeType !== resource.details.mimeType) throw new Error('resource loader MIME type differs from registration');
    if (
      !resource.registration.mutable &&
      resource.details.byteLength !== undefined &&
      resource.details.byteLength !== bytes.byteLength
    ) {
      throw new Error('resource loader byte length differs from registration');
    }
    const digest = sha256(bytes);
    if (!resource.registration.mutable && resource.details.sha256 && resource.details.sha256 !== digest) {
      throw new Error('resource loader SHA-256 differs from registration');
    }
    resource.details = {
      ...resource.details,
      byteLength: bytes.byteLength,
      sha256: digest,
      ...(payload.width !== undefined ? { width: payload.width } : {}),
      ...(payload.height !== undefined ? { height: payload.height } : {})
    };
    return {
      bytes,
      mimeType,
      ...(payload.width !== undefined ? { width: payload.width } : {}),
      ...(payload.height !== undefined ? { height: payload.height } : {})
    };
  }

  pruneExpired(): number {
    let removed = 0;
    for (const handle of this.resources.keys()) {
      if (!this.live(handle)) removed += 1;
    }
    return removed;
  }

  /** Releases all handles and scheduled expiration work. Safe to call more than once. */
  dispose(): void {
    this.disposed = true;
    clearTimeout(this.expirationTimer);
    this.expirationTimer = undefined;
    this.resources.clear();
    this.nextExpiration = Infinity;
  }

  private scheduleExpiration(expiresAt: number): void {
    if (expiresAt >= this.nextExpiration) return;
    clearTimeout(this.expirationTimer);
    this.nextExpiration = expiresAt;
    this.expirationTimer = setTimeout(
      () => {
        this.expirationTimer = undefined;
        this.nextExpiration = Infinity;
        this.pruneExpired();
        let next = Infinity;
        for (const resource of this.resources.values()) {
          next = Math.min(next, Date.parse(resource.details.expiresAt as string));
        }
        this.scheduleExpiration(next);
      },
      Math.max(1, expiresAt - this.now())
    );
    this.expirationTimer.unref?.();
  }

  private live(handle: string): StoredResource | null {
    if (!/^res_[A-Za-z0-9_-]{32}$/.test(handle)) return null;
    const resource = this.resources.get(handle);
    if (!resource) return null;
    if (resource.details.expiresAt && Date.parse(resource.details.expiresAt) <= this.now()) {
      this.resources.delete(handle);
      return null;
    }
    return resource;
  }
}
