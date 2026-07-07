export const ASSET_REFERENCE_TYPE = 'asset' as const;

export interface AssetReference {
  type: typeof ASSET_REFERENCE_TYPE;
  project: string;
  assetId?: string;
  assetKey?: string;
  assetBaseUrl?: string;
}

export interface ResolvedAssetReference extends AssetReference {
  assetId: string;
}

export interface ServiceUrlConfig {
  assetsBaseUrl?: string;
  routerImageBaseUrl?: string;
  routerTextBaseUrl?: string;
  router3dBaseUrl?: string;
  routerVideoBaseUrl?: string;
  routerAudioBaseUrl?: string;
}

export interface CostEnvelope {
  currency: 'USD' | string;
  amount: number;
  estimated?: boolean;
  pricingSource?: string;
  pricingVersion?: string;
  calculatedAt?: string;
}

export interface AgentSafeBinaryDescriptor {
  kind: 'data-url' | 'base64' | 'binary';
  mediaType?: string;
  encodedBytes?: number;
  byteLength?: number;
  redacted: true;
}

export interface NormalizeAssetReferenceOptions {
  requireAssetId?: boolean;
}

const SAFE_PROJECT = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/u;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const SAFE_ASSET_KEY_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9_.:@-]{0,127}$/u;

export function isAssetReference(value: unknown): value is AssetReference {
  try {
    normalizeAssetReference(value);
    return true;
  } catch {
    return false;
  }
}

export function normalizeAssetReference(value: unknown, options: NormalizeAssetReferenceOptions = {}): AssetReference {
  if (!isRecord(value)) throw new Error('asset ref must be an object');
  if (value.type !== ASSET_REFERENCE_TYPE) throw new Error('asset ref type must be "asset"');
  const project = normalizeProject(value.project);
  const assetId = normalizeOptionalAssetId(value.assetId);
  const assetKey = normalizeOptionalAssetKey(value.assetKey);
  if (!assetId && !assetKey) throw new Error('asset ref must include assetId or assetKey');
  if (options.requireAssetId && !assetId) throw new Error('asset ref must include assetId');
  const assetBaseUrl = normalizeOptionalBaseUrl(value.assetBaseUrl);
  return {
    type: ASSET_REFERENCE_TYPE,
    project,
    ...(assetId ? { assetId } : {}),
    ...(assetKey ? { assetKey } : {}),
    ...(assetBaseUrl ? { assetBaseUrl } : {})
  };
}

export function withAssetBaseUrl(ref: AssetReference, assetBaseUrl: string | undefined | null): AssetReference {
  const checked = normalizeAssetReference(ref);
  const normalizedBaseUrl = normalizeOptionalBaseUrl(assetBaseUrl);
  return {
    ...checked,
    ...(normalizedBaseUrl ? { assetBaseUrl: normalizedBaseUrl } : {})
  };
}

export function assetIdentityKey(ref: AssetReference): string {
  const checked = normalizeAssetReference(ref);
  if (checked.assetId) return `${checked.project}:assetId:${checked.assetId}`;
  return `${checked.project}:assetKey:${checked.assetKey}`;
}

export function assetRecordPath(ref: AssetReference): string {
  const checked = normalizeAssetReference(ref);
  if (checked.assetId)
    return `/projects/${encodePathSegment(checked.project)}/assets/${encodePathSegment(checked.assetId)}`;
  return `/projects/${encodePathSegment(checked.project)}/assets/by-key/${encodeAssetKeyPath(checked.assetKey ?? '')}`;
}

export function assetContentPath(ref: AssetReference): string {
  return `${assetRecordPath(ref)}/content`;
}

export function resolveAssetRecordUrl(ref: AssetReference, baseUrl?: string): string {
  const checked = normalizeAssetReference(ref);
  const base = normalizeRequiredBaseUrl(baseUrl ?? checked.assetBaseUrl);
  return `${base}${assetRecordPath(checked)}`;
}

export function resolveAssetContentUrl(ref: AssetReference, baseUrl?: string): string {
  const checked = normalizeAssetReference(ref);
  const base = normalizeRequiredBaseUrl(baseUrl ?? checked.assetBaseUrl);
  return `${base}${assetContentPath(checked)}`;
}

export function redactAgentBinaryPayload(value: string | Uint8Array | ArrayBuffer): AgentSafeBinaryDescriptor {
  if (typeof value === 'string') {
    const dataUrl = value.match(/^data:([^;,]+)?(?:;[^,]*)?;base64,(.*)$/u);
    if (dataUrl) {
      return {
        kind: 'data-url',
        ...(dataUrl[1] ? { mediaType: dataUrl[1] } : {}),
        encodedBytes: dataUrl[2].length,
        redacted: true
      };
    }
    return { kind: 'base64', encodedBytes: value.length, redacted: true };
  }
  const byteLength = value instanceof ArrayBuffer ? value.byteLength : value.byteLength;
  return { kind: 'binary', byteLength, redacted: true };
}

function normalizeProject(value: unknown): string {
  if (typeof value !== 'string' || !SAFE_PROJECT.test(value)) {
    throw new Error('asset ref project must be a safe segment');
  }
  return value;
}

function normalizeOptionalAssetId(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string' || !UUID.test(value)) throw new Error('asset ref assetId must be a UUID');
  return value;
}

function normalizeOptionalAssetKey(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string') throw new Error('asset ref assetKey must be a string');
  const segments = value.split('/').filter(Boolean);
  if (segments.length === 0 || segments.some((segment) => !SAFE_ASSET_KEY_SEGMENT.test(segment))) {
    throw new Error('asset ref assetKey must be a safe project-scoped key');
  }
  return segments.join('/');
}

function normalizeOptionalBaseUrl(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string') throw new Error('assetBaseUrl must be an HTTP(S) URL string');
  return normalizeRequiredBaseUrl(value);
}

function normalizeRequiredBaseUrl(value: unknown): string {
  if (typeof value !== 'string') throw new Error('asset base URL is required');
  const url = new URL(value);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('assetBaseUrl must use HTTP(S)');
  url.pathname = url.pathname.replace(/\/+$/u, '');
  url.search = '';
  url.hash = '';
  return url.toString().replace(/\/+$/u, '');
}

function encodeAssetKeyPath(assetKey: string): string {
  return assetKey.split('/').map(encodePathSegment).join('/');
}

function encodePathSegment(value: string): string {
  return encodeURIComponent(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
