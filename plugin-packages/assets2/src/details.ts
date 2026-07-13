import type { JsonObject, JsonValue } from '@agentcanvas/plugin-sdk';
import type { RasterDimensions } from './dimensions.js';

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function safeNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function sensitiveString(value: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(value) || value.startsWith('/') || value.includes('\\') || value.startsWith('data:');
}

export function sanitizeAssetValue(value: unknown, depth = 0): JsonValue {
  if (depth > 16) return '[maximum depth]';
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    if (value.length > 20_000 || sensitiveString(value)) return '[redacted]';
    return value;
  }
  if (Array.isArray(value)) return value.slice(0, 500).map((item) => sanitizeAssetValue(item, depth + 1));
  const source = record(value);
  if (!source) return String(value);
  const result: JsonObject = {};
  for (const [key, child] of Object.entries(source).slice(0, 500)) {
    if (/api[_-]?key|authorization|cookie|token|secret|password/i.test(key)) continue;
    result[key] = sanitizeAssetValue(child, depth + 1);
  }
  return result;
}

export function normalizeAssetDetails(assetValue: JsonObject, measured?: RasterDimensions | null): JsonObject {
  const asset = assetValue as Record<string, unknown>;
  const metadata = record(asset.metadata) ?? {};
  const generation = record(metadata.generation);
  const settings = record(generation?.settings) ?? {};
  const size = record(settings.size) ?? {};
  const cost = record(metadata.cost);
  const width =
    safeNumber(size.width) ??
    safeNumber(asset.image_width_px) ??
    safeNumber(record(metadata.dimensions)?.width) ??
    safeNumber(metadata.width) ??
    measured?.width ??
    null;
  const height =
    safeNumber(size.height) ??
    safeNumber(asset.image_height_px) ??
    safeNumber(record(metadata.dimensions)?.height) ??
    safeNumber(metadata.height) ??
    measured?.height ??
    null;
  const normalizedGeneration: JsonObject | null = generation
    ? {
        service: sanitizeAssetValue(generation.service ?? null),
        tool: sanitizeAssetValue(generation.tool ?? null),
        provider: sanitizeAssetValue(generation.provider ?? null),
        model: sanitizeAssetValue(generation.model ?? null),
        quality: sanitizeAssetValue(settings.quality ?? null),
        width,
        height,
        prompt: sanitizeAssetValue(generation.prompt ?? null),
        jsonPrompt: sanitizeAssetValue(generation.jsonPrompt ?? null),
        contextImages: sanitizeAssetValue(generation.contextImages ?? []),
        controls: sanitizeAssetValue(record(settings.controls) ?? {}),
        providerRequest: sanitizeAssetValue(generation.providerRequest ?? null),
        requestId: sanitizeAssetValue(generation.requestId ?? null),
        imageIndex: sanitizeAssetValue(generation.imageIndex ?? null),
        generatedAt: sanitizeAssetValue(generation.generatedAt ?? null)
      }
    : null;
  const amount = safeNumber(cost?.amount);
  const currency = typeof cost?.currency === 'string' && cost.currency ? cost.currency : null;
  return {
    ok: true,
    asset: {
      project: sanitizeAssetValue(asset.project ?? null),
      assetId: sanitizeAssetValue(asset.id ?? null),
      assetKey: sanitizeAssetValue(asset.asset_key ?? null),
      filename: sanitizeAssetValue(asset.filename ?? null),
      contentType: sanitizeAssetValue(asset.content_type ?? null),
      sizeBytes: safeNumber(asset.size_bytes),
      contentSha256: sanitizeAssetValue(asset.content_sha256 ?? null),
      width,
      height,
      createdAt: sanitizeAssetValue(asset.created_at ?? null),
      updatedAt: sanitizeAssetValue(asset.updated_at ?? null)
    },
    generation: normalizedGeneration,
    cost:
      amount !== null && amount >= 0 && currency
        ? {
            currency,
            amount,
            estimated: typeof cost?.estimated === 'boolean' ? cost.estimated : null,
            pricingSource: sanitizeAssetValue(cost?.pricingSource ?? null),
            pricingVersion: sanitizeAssetValue(cost?.pricingVersion ?? null),
            calculatedAt: sanitizeAssetValue(cost?.calculatedAt ?? null)
          }
        : null,
    warnings: generation ? [] : ['generation_not_recorded']
  };
}
