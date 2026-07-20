import type {
  ImageSourceProviderV1,
  ImageSourceReference,
  ImageSourcesCapabilityV1,
  JsonObject,
  OpaqueResourceHandle
} from '@agentcanvas/plugin-sdk';
import { isPluginId } from '@agentcanvas/plugin-sdk';

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} must be an object`);
  return value as Record<string, unknown>;
}

function outerReference(value: unknown): { provider: string; reference: unknown } {
  const input = object(value, 'image source reference');
  const unsupported = Object.keys(input).filter((key) => key !== 'provider' && key !== 'reference');
  if (unsupported.length) throw new TypeError(`unsupported image source fields: ${unsupported.sort().join(', ')}`);
  if (typeof input.provider !== 'string' || !isPluginId(input.provider)) {
    throw new TypeError('image source provider must be a valid extension ID');
  }
  return { provider: input.provider, reference: input.reference };
}

export class ImageSourceRegistry implements ImageSourcesCapabilityV1 {
  private readonly providers = new Map<string, ImageSourceProviderV1>();
  private sealed = false;

  registerProvider(provider: ImageSourceProviderV1): void {
    if (this.sealed) throw new Error('image source provider registry is sealed');
    if (!isPluginId(provider.provider)) throw new TypeError('image source provider must be a valid extension ID');
    if (this.providers.has(provider.provider)) {
      throw new Error(`image source provider is already registered: ${provider.provider}`);
    }
    if (typeof provider.validateReference !== 'function' || typeof provider.resolve !== 'function') {
      throw new TypeError('image source provider must implement validation and resolution');
    }
    this.providers.set(provider.provider, Object.freeze({ ...provider }));
  }

  seal(): void {
    this.sealed = true;
  }

  hasProvider(provider: string): boolean {
    return this.providers.has(provider);
  }

  listProviders(): readonly string[] {
    return Object.freeze([...this.providers.keys()].sort());
  }

  validateReference(value: unknown): ImageSourceReference {
    const input = outerReference(value);
    const provider = this.providers.get(input.provider);
    if (!provider) throw new Error(`image source provider is unavailable: ${input.provider}`);
    return Object.freeze({
      provider: input.provider,
      reference: structuredClone(provider.validateReference(input.reference))
    });
  }

  async resolve(value: unknown, signal: AbortSignal): Promise<OpaqueResourceHandle> {
    const source = this.validateReference(value);
    const provider = this.providers.get(source.provider);
    if (!provider) throw new Error(`image source provider is unavailable: ${source.provider}`);
    const resource = await provider.resolve(source.reference, signal);
    if (!resource.mimeType.toLowerCase().startsWith('image/')) {
      throw new TypeError(`image source returned non-image MIME type: ${resource.mimeType}`);
    }
    return resource;
  }
}

export function imageSourceEnvelope(value: unknown): { provider: string; reference: JsonObject } {
  const source = outerReference(value);
  return {
    provider: source.provider,
    reference: object(source.reference, 'image source provider reference') as JsonObject
  };
}
