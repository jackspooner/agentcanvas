import { createHash } from 'node:crypto';
import type {
  AssetsCapabilityV1,
  JsonObject,
  OpaqueResourceHandle,
  ResourcePayload,
  SnapshotResourcesCapabilityV1
} from '@agentcanvas/plugin-sdk';
import { ASSETS_SERVICE_IDENTITY, type AssetReference, type AssetsPluginConfig } from './contracts.js';
import { normalizeAssetDetails } from './details.js';
import { readRasterDimensions } from './dimensions.js';

const SAFE_PROJECT = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SAFE_KEY_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9_.:@-]{0,127}$/;
const SAFE_RESOURCE_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'image/avif',
  'video/mp4',
  'video/webm',
  'model/gltf-binary',
  'model/gltf+json'
]);

function object(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    throw new TypeError(`${label} must be an object`);
  return value as Record<string, unknown>;
}

function normalizedBaseUrl(value: unknown): string {
  if (typeof value !== 'string' || !value) throw new TypeError('Assets-2 baseUrl must be a non-empty URL');
  const url = new URL(value);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new TypeError('Assets-2 baseUrl must use HTTP(S)');
  if (url.username || url.password || url.search || url.hash)
    throw new TypeError('Assets-2 baseUrl must not contain credentials or query data');
  if (url.pathname !== '/' && url.pathname !== '') throw new TypeError('Assets-2 baseUrl must not contain a path');
  url.pathname = url.pathname.replace(/\/+$/, '');
  return url.toString().replace(/\/+$/, '');
}

function integer(config: Readonly<JsonObject>, key: keyof AssetsPluginConfig): number {
  const value = config[key];
  if (!Number.isSafeInteger(value)) throw new TypeError(`Assets-2 ${key} must be a safe integer`);
  return value as number;
}

function environmentInteger(environment: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const raw = environment[name];
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${name} must be a positive safe integer`);
  }
  return value;
}

export function readAssetsPluginConfig(
  config: Readonly<JsonObject>,
  environment: NodeJS.ProcessEnv
): AssetsPluginConfig {
  return {
    baseUrl: normalizedBaseUrl(environment.ASSETS_BASE_URL ?? config.baseUrl),
    fetchTimeoutMs: environmentInteger(
      environment,
      'AGENT_CANVAS_ASSET_FETCH_TIMEOUT_MS',
      integer(config, 'fetchTimeoutMs')
    ),
    metadataMaxBytes: environmentInteger(
      environment,
      'AGENT_CANVAS_ASSET_METADATA_MAX_BYTES',
      integer(config, 'metadataMaxBytes')
    ),
    previewMaxBytes: environmentInteger(
      environment,
      'AGENT_CANVAS_ASSET_PREVIEW_MAX_BYTES',
      integer(config, 'previewMaxBytes')
    ),
    contentMaxBytes: environmentInteger(
      environment,
      'AGENT_CANVAS_ASSET_PROXY_MAX_BYTES',
      integer(config, 'contentMaxBytes')
    )
  };
}

function normalizeReference(value: unknown, configuredBaseUrl: string): AssetReference {
  const source = object(value, 'asset reference');
  const unknown = Object.keys(source).filter(
    (key) => !['type', 'project', 'assetId', 'assetKey', 'assetBaseUrl'].includes(key)
  );
  if (unknown.length) throw new TypeError(`unknown asset reference fields: ${unknown.sort().join(', ')}`);
  if (source.type !== 'asset') throw new TypeError('asset reference type must be asset');
  if (typeof source.project !== 'string' || !SAFE_PROJECT.test(source.project)) {
    throw new TypeError('asset reference project is invalid');
  }
  const assetId = source.assetId;
  const assetKey = source.assetKey;
  if (assetId !== undefined && (typeof assetId !== 'string' || !UUID.test(assetId))) {
    throw new TypeError('asset reference assetId must be a UUID');
  }
  if (
    assetKey !== undefined &&
    (typeof assetKey !== 'string' ||
      !assetKey ||
      assetKey.split('/').some((segment) => !SAFE_KEY_SEGMENT.test(segment)))
  ) {
    throw new TypeError('asset reference assetKey is invalid');
  }
  if (!assetId && !assetKey) throw new TypeError('asset reference requires assetId or assetKey');
  let assetBaseUrl: string | undefined;
  if (source.assetBaseUrl !== undefined) {
    assetBaseUrl = normalizedBaseUrl(source.assetBaseUrl);
    if (assetBaseUrl !== configuredBaseUrl) {
      throw new TypeError('asset reference base URL does not match the configured Assets-2 provider');
    }
  }
  return {
    type: 'asset',
    project: source.project,
    ...(typeof assetId === 'string' ? { assetId } : {}),
    ...(typeof assetKey === 'string' ? { assetKey } : {}),
    ...(assetBaseUrl ? { assetBaseUrl } : {})
  };
}

function pathFor(reference: AssetReference): string {
  const project = encodeURIComponent(reference.project);
  if (reference.assetId) return `/projects/${project}/assets/${encodeURIComponent(reference.assetId)}`;
  const key = String(reference.assetKey)
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
  return `/projects/${project}/assets/by-key/${key}`;
}

async function cancel(response: Response): Promise<void> {
  await response.body?.cancel();
}

export class Assets2Capability implements AssetsCapabilityV1 {
  private readonly handles = new Map<string, OpaqueResourceHandle>();
  private readonly pendingHandles = new Map<string, Promise<OpaqueResourceHandle>>();

  constructor(
    private readonly config: AssetsPluginConfig,
    private readonly resources: SnapshotResourcesCapabilityV1,
    private readonly fetcher: typeof fetch = globalThis.fetch
  ) {}

  validateReference(value: unknown): JsonObject {
    return normalizeReference(value, this.config.baseUrl) as unknown as JsonObject;
  }

  private reference(value: Readonly<JsonObject>): AssetReference {
    return normalizeReference(value, this.config.baseUrl);
  }

  private referenceKey(reference: AssetReference): string {
    return reference.assetId
      ? `${reference.project}:id:${reference.assetId}`
      : `${reference.project}:key:${reference.assetKey}`;
  }

  private async request(path: string, signal?: AbortSignal): Promise<Response> {
    const deadline = Date.now() + this.config.fetchTimeoutMs;
    let current = new URL(path, `${this.config.baseUrl}/`);
    const allowedOrigin = new URL(this.config.baseUrl).origin;
    for (let redirects = 0; redirects <= 3; redirects += 1) {
      if (current.origin !== allowedOrigin || !current.href.startsWith(`${this.config.baseUrl}/`)) {
        throw new Error('Assets-2 request escaped its configured origin');
      }
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new DOMException('Assets-2 request timed out', 'TimeoutError');
      const timeout = AbortSignal.timeout(remaining);
      const combinedSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
      const response = await this.fetcher(current, { redirect: 'manual', signal: combinedSignal });
      if (![301, 302, 303, 307, 308].includes(response.status)) return response;
      const location = response.headers.get('location');
      await cancel(response);
      if (!location) throw new Error('Assets-2 redirect did not include a location');
      current = new URL(location, current);
    }
    throw new Error('Assets-2 returned too many redirects');
  }

  private async boundedBytes(response: Response, maxBytes: number): Promise<Uint8Array> {
    const declared = Number(response.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > maxBytes) {
      await cancel(response);
      throw new Error('Assets-2 response exceeded its byte limit');
    }
    const reader = response.body?.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    if (reader) {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          total += value.byteLength;
          if (total > maxBytes) {
            await reader.cancel();
            throw new Error('Assets-2 response exceeded its byte limit');
          }
          chunks.push(value);
        }
      } finally {
        reader.releaseLock();
      }
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return bytes;
  }

  private async jsonResponse(response: Response, maxBytes = this.config.metadataMaxBytes): Promise<JsonObject> {
    const bytes = await this.boundedBytes(response, maxBytes);
    return object(JSON.parse(new TextDecoder().decode(bytes)), 'Assets-2 response') as JsonObject;
  }

  private async metadata(reference: AssetReference, signal: AbortSignal): Promise<JsonObject> {
    const response = await this.request(pathFor(reference), signal);
    if (!response.ok) {
      await cancel(response);
      throw new Error(`Assets-2 metadata request failed with HTTP ${response.status}`);
    }
    return this.jsonResponse(response);
  }

  async providerStatus(signal?: AbortSignal): Promise<{
    ok: boolean;
    identity?: string;
    capabilities?: readonly string[];
    code?: string;
    retryable?: boolean;
  }> {
    try {
      const healthResponse = await this.request('/health', signal);
      if (!healthResponse.ok) {
        await cancel(healthResponse);
        return { ok: false, code: 'assets_health_failed', retryable: true };
      }
      const health = await this.jsonResponse(healthResponse);
      if (health.status !== 'ok') return { ok: false, code: 'assets_health_failed', retryable: true };
      const identityResponse = await this.request('/whoami', signal);
      if (!identityResponse.ok) {
        await cancel(identityResponse);
        return { ok: false, code: 'assets_health_failed', retryable: true };
      }
      const identity = await this.jsonResponse(identityResponse);
      if (identity.service !== ASSETS_SERVICE_IDENTITY) {
        return {
          ok: false,
          identity: typeof identity.service === 'string' ? identity.service : undefined,
          code: 'assets_identity_mismatch',
          retryable: true
        };
      }
      const capabilities = object(identity.capabilities, 'Assets-2 capabilities');
      const advertised = Object.entries(capabilities)
        .filter(([, enabled]) => enabled === true)
        .map(([name]) => name)
        .sort();
      if (capabilities.asset_crud !== true || capabilities.asset_refs !== true) {
        return {
          ok: false,
          identity: ASSETS_SERVICE_IDENTITY,
          capabilities: advertised,
          code: 'assets_capabilities_missing',
          retryable: true
        };
      }
      return { ok: true, identity: ASSETS_SERVICE_IDENTITY, capabilities: advertised };
    } catch {
      return { ok: false, code: 'assets_unavailable', retryable: true };
    }
  }

  async boundedJson(referenceValue: Readonly<JsonObject>, signal: AbortSignal): Promise<JsonObject> {
    const reference = this.reference(referenceValue);
    const response = await this.request(`${pathFor(reference)}/content`, signal);
    if (!response.ok) {
      await cancel(response);
      throw new Error(`Assets-2 JSON content request failed with HTTP ${response.status}`);
    }
    const mimeType = String(response.headers.get('content-type') ?? '')
      .split(';')[0]
      .trim()
      .toLowerCase();
    if (mimeType !== 'application/json' && !mimeType.endsWith('+json')) {
      await cancel(response);
      throw new Error(`Assets-2 JSON content has unsupported MIME type ${mimeType || 'unknown'}`);
    }
    return this.jsonResponse(response, this.config.previewMaxBytes);
  }

  async details(reference: Readonly<JsonObject>, signal: AbortSignal): Promise<JsonObject> {
    const checked = this.reference(reference);
    const record = await this.metadata(checked, signal);
    const preliminary = normalizeAssetDetails(record);
    const preliminaryAsset = object(preliminary.asset, 'normalized asset details');
    if (typeof preliminaryAsset.width === 'number' && typeof preliminaryAsset.height === 'number') {
      return preliminary;
    }
    const mimeType =
      typeof record.content_type === 'string' ? record.content_type.split(';')[0].trim().toLowerCase() : '';
    if (!mimeType.startsWith('image/') || mimeType === 'image/avif') return preliminary;
    const response = await this.request(`${pathFor(checked)}/content`, signal);
    if (!response.ok) {
      await cancel(response);
      return preliminary;
    }
    const responseType = String(response.headers.get('content-type') ?? '')
      .split(';')[0]
      .trim()
      .toLowerCase();
    if (responseType !== mimeType) {
      await cancel(response);
      return preliminary;
    }
    const measured = readRasterDimensions(await this.boundedBytes(response, this.config.contentMaxBytes));
    return normalizeAssetDetails(record, measured);
  }

  async contentHandle(referenceValue: Readonly<JsonObject>, signal: AbortSignal): Promise<OpaqueResourceHandle> {
    const reference = this.reference(referenceValue);
    const referenceKey = this.referenceKey(reference);
    const cached = this.handles.get(referenceKey);
    if (cached && this.resources.details(cached.handle)) return cached;
    if (cached) this.handles.delete(referenceKey);
    const pending = this.pendingHandles.get(referenceKey);
    if (pending) return pending;
    const creation = this.createContentHandle(reference, signal);
    this.pendingHandles.set(referenceKey, creation);
    try {
      return await creation;
    } finally {
      this.pendingHandles.delete(referenceKey);
    }
  }

  private async createContentHandle(
    reference: AssetReference,
    signal: AbortSignal
  ): Promise<OpaqueResourceHandle> {
    const record = await this.metadata(reference, signal);
    const mimeType =
      typeof record.content_type === 'string' ? record.content_type.split(';')[0].trim().toLowerCase() : '';
    if (!SAFE_RESOURCE_TYPES.has(mimeType)) {
      throw new Error(`Assets-2 asset MIME type ${mimeType || 'unknown'} is unsupported`);
    }
    const byteLength =
      typeof record.size_bytes === 'number' && Number.isSafeInteger(record.size_bytes) ? record.size_bytes : undefined;
    if (byteLength !== undefined && byteLength > this.config.contentMaxBytes) {
      throw new Error('Assets-2 asset exceeds the content byte limit');
    }
    const details = normalizeAssetDetails(record);
    const detailAsset = object(details.asset, 'normalized asset details');
    const handle = this.resources.register({
      mimeType,
      ...(byteLength !== undefined ? { byteLength } : {}),
      ...(typeof detailAsset.width === 'number' ? { width: detailAsset.width } : {}),
      ...(typeof detailAsset.height === 'number' ? { height: detailAsset.height } : {}),
      ...(typeof record.content_sha256 === 'string' && /^[a-f0-9]{64}$/i.test(record.content_sha256)
        ? { sha256: record.content_sha256.toLowerCase() }
        : {}),
      mutable: true,
      ttlMs: 60 * 60 * 1000,
      load: async (resourceSignal): Promise<ResourcePayload> => {
        const currentRecord = await this.metadata(reference, resourceSignal);
        const currentMimeType =
          typeof currentRecord.content_type === 'string'
            ? currentRecord.content_type.split(';')[0].trim().toLowerCase()
            : '';
        if (currentMimeType !== mimeType || !SAFE_RESOURCE_TYPES.has(currentMimeType)) {
          throw new Error('Assets-2 asset MIME type changed or is unsupported');
        }
        const currentByteLength =
          typeof currentRecord.size_bytes === 'number' && Number.isSafeInteger(currentRecord.size_bytes)
            ? currentRecord.size_bytes
            : undefined;
        if (currentByteLength !== undefined && currentByteLength > this.config.contentMaxBytes) {
          throw new Error('Assets-2 asset exceeds the content byte limit');
        }
        const currentSha256 =
          typeof currentRecord.content_sha256 === 'string' && /^[a-f0-9]{64}$/i.test(currentRecord.content_sha256)
            ? currentRecord.content_sha256.toLowerCase()
            : undefined;
        const response = await this.request(`${pathFor(reference)}/content`, resourceSignal);
        if (!response.ok) {
          await cancel(response);
          throw new Error(`Assets-2 content request failed with HTTP ${response.status}`);
        }
        const responseType = String(response.headers.get('content-type') ?? '')
          .split(';')[0]
          .trim()
          .toLowerCase();
        if (responseType !== mimeType) {
          await cancel(response);
          throw new Error('Assets-2 content MIME type did not match its metadata');
        }
        const bytes = await this.boundedBytes(response, this.config.contentMaxBytes);
        if (currentByteLength !== undefined && currentByteLength !== bytes.byteLength) {
          throw new Error('Assets-2 content length did not match current metadata');
        }
        if (currentSha256 && createHash('sha256').update(bytes).digest('hex') !== currentSha256) {
          throw new Error('Assets-2 content SHA-256 did not match current metadata');
        }
        const currentDetails = normalizeAssetDetails(currentRecord);
        const currentAsset = object(currentDetails.asset, 'normalized asset details');
        return {
          bytes,
          mimeType,
          ...(typeof currentAsset.width === 'number' ? { width: currentAsset.width } : {}),
          ...(typeof currentAsset.height === 'number' ? { height: currentAsset.height } : {})
        };
      }
    });
    if (this.handles.size >= 10_000) this.handles.delete(this.handles.keys().next().value as string);
    this.handles.set(this.referenceKey(reference), handle);
    return handle;
  }
}
