import type {
  AgentCanvasServerPlugin,
  AssetsCapabilityV1,
  CanvasElement,
  ImageSourcesCapabilityV1,
  JsonObject,
  PluginInvocationContext,
  PluginProcedureDescriptor,
  PluginToolDescriptor,
  ServerPluginHost,
  SnapshotResourcesCapabilityV1
} from '@agentcanvas/plugin-sdk';
import { IMAGE_SOURCES_CAPABILITY } from '@agentcanvas/plugin-sdk';
import { ASSETS_CAPABILITY, ASSETS_CAPABILITY_VERSION, assetElementData, type AssetReference } from './contracts.js';
import { importLegacyAsset } from './legacy.js';
import { Assets2Capability, readAssetsPluginConfig } from './provider.js';
import {
  assetDataSchema,
  assetDetailsInputSchema,
  assetDetailsToolInputSchema,
  assetStyleSchema,
  asJsonSchema,
  detailsOutputSchema,
  mutationOutputSchema,
  placeAssetInputSchema
} from './schemas.js';
import { renderAssetSnapshot } from './snapshot.js';

function optionalNumber(input: JsonObject, key: string): number | null | undefined {
  const value = input[key];
  return typeof value === 'number' || value === null ? value : undefined;
}

function detailsDescriptor(capability: AssetsCapabilityV1): Pick<
  PluginToolDescriptor,
  'inputSchema' | 'outputSchema'
> & {
  invoke(input: JsonObject, signal: AbortSignal): Promise<JsonObject>;
} {
  return {
    inputSchema: asJsonSchema(assetDetailsInputSchema),
    outputSchema: asJsonSchema(detailsOutputSchema),
    async invoke(input, signal) {
      const reference = capability.validateReference(input.assetRef);
      return { ok: true, details: await capability.details(reference, signal) };
    }
  };
}

export function compactDetails(details: JsonObject, include: readonly string[]): JsonObject {
  const generation = details.generation;
  if (!generation || typeof generation !== 'object' || Array.isArray(generation)) return details;
  const source = generation as JsonObject;
  const compact: JsonObject = {};
  for (const key of [
    'service',
    'tool',
    'provider',
    'model',
    'quality',
    'width',
    'height',
    'requestId',
    'imageIndex',
    'generatedAt',
    ...include
  ]) {
    if (source[key] !== undefined) compact[key] = source[key];
  }
  return { ...details, generation: compact };
}

function placeTool(capability: AssetsCapabilityV1): PluginToolDescriptor {
  return {
    name: 'place',
    title: 'Place asset',
    description: 'Place a durable Assets-2 raster asset on a canvas.',
    inputSchema: asJsonSchema(placeAssetInputSchema),
    outputSchema: asJsonSchema(mutationOutputSchema),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    async invoke(input: JsonObject, context: PluginInvocationContext): Promise<JsonObject> {
      const canvasId = input.canvasId as string;
      const data: JsonObject = { assetRef: capability.validateReference(input.assetRef) };
      for (const key of ['caption', 'fit', 'alt'] as const) {
        if (input[key] !== undefined) data[key] = input[key];
      }
      const element: CanvasElement = {
        id: typeof input.id === 'string' ? input.id : crypto.randomUUID(),
        type: 'agentcanvas.assets2/asset',
        schemaVersion: 1,
        x: input.x as number,
        y: input.y as number,
        width: optionalNumber(input, 'width') ?? 320,
        height: optionalNumber(input, 'height') ?? 240,
        data
      };
      for (const key of ['zIndex', 'rotation', 'opacity'] as const) {
        const value = optionalNumber(input, key);
        if (value !== undefined) element[key] = value;
      }
      if (typeof input.locked === 'boolean' || input.locked === null) element.locked = input.locked;
      if (input.style && typeof input.style === 'object' && !Array.isArray(input.style)) element.style = input.style;
      if (input.metadata && typeof input.metadata === 'object' && !Array.isArray(input.metadata)) {
        element.metadata = input.metadata;
      }
      const result = await context.canvas.upsertElementReceipt(
        canvasId,
        element,
        input.expectedRevision as number | undefined
      );
      return { ...result, elementId: element.id };
    }
  };
}

const plugin: AgentCanvasServerPlugin = {
  activate(host: ServerPluginHost) {
    const resources = host
      .consumeCapability<SnapshotResourcesCapabilityV1>('agentcanvas.snapshot-resources', '^1.0.0')
      .get();
    const imageSources = host.consumeCapability<ImageSourcesCapabilityV1>(IMAGE_SOURCES_CAPABILITY, '^1.0.0').get();
    const capability = new Assets2Capability(readAssetsPluginConfig(host.config, process.env), resources);
    imageSources.registerProvider({
      provider: 'agentcanvas.assets2',
      validateReference: (value) => capability.validateReference(value),
      async resolve(reference, signal) {
        const resource = await capability.contentHandle(reference, signal);
        if (!resource.mimeType.toLowerCase().startsWith('image/')) {
          throw new TypeError('Assets-2 gallery sources must be images');
        }
        return resource;
      }
    });
    host.provideCapability<AssetsCapabilityV1>({
      name: ASSETS_CAPABILITY,
      version: ASSETS_CAPABILITY_VERSION,
      value: capability,
      readiness: async () => {
        const status = await capability.providerStatus();
        return {
          ok: status.ok,
          ...(status.code ? { code: status.code } : {}),
          ...(status.ok ? {} : { message: 'Required Assets-2 provider is unavailable.' }),
          retryable: status.retryable
        };
      }
    });
    host.registerElementType({
      name: 'asset',
      schemaVersion: 1,
      dataSchema: asJsonSchema(assetDataSchema),
      styleSchema: asJsonSchema(assetStyleSchema),
      defaultFrame: { width: 320, height: 240 },
      browser: true,
      snapshot: 'supported',
      summarize(element) {
        const data = assetElementData(element.data);
        return {
          title: data.caption ?? data.alt ?? `Asset ${data.assetRef.assetId ?? data.assetRef.assetKey}`,
          detail: `${data.assetRef.project} · ${data.fit ?? 'contain'}`
        };
      },
      async resolve(element, context) {
        const data = assetElementData(element.data);
        try {
          const resource = await capability.contentHandle(data.assetRef as unknown as JsonObject, context.signal);
          if (!resource.mimeType.startsWith('image/')) throw new Error('Asset element requires a raster image');
          return {
            runtime: {
              contentHandle: resource.handle,
              contentUrl: resource.url,
              mimeType: resource.mimeType,
              ...(resource.byteLength !== undefined ? { byteLength: resource.byteLength } : {}),
              ...(resource.width !== undefined ? { width: resource.width } : {}),
              ...(resource.height !== undefined ? { height: resource.height } : {})
            }
          };
        } catch {
          return {
            runtime: {} as JsonObject,
            diagnostics: [
              {
                code: 'asset_resolution_failed',
                severity: 'error',
                message: 'The Assets-2 resource could not be resolved.',
                retryable: true,
                pluginId: 'agentcanvas.assets2',
                elementId: element.id
              }
            ]
          };
        }
      },
      renderSnapshot: (element, context) => renderAssetSnapshot(element, context.runtime, context.theme)
    });
    host.registerTool(placeTool(capability));
    const details = detailsDescriptor(capability);
    host.registerTool({
      name: 'get-details',
      title: 'Get asset details',
      description: 'Read safe metadata, generation, dimension, and cost details for an Assets-2 asset.',
      inputSchema: asJsonSchema(assetDetailsToolInputSchema),
      outputSchema: details.outputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      async invoke(input, context) {
        const full = await details.invoke(input, context.signal);
        return {
          ok: true,
          details: compactDetails(full.details as JsonObject, (input.include as string[] | undefined) ?? [])
        };
      }
    });
    host.registerProcedure({
      name: 'details',
      description: 'Read the safe browser details projection for an Assets-2 asset.',
      ...details,
      invoke: (input, context) => details.invoke(input, context.signal)
    } satisfies PluginProcedureDescriptor);
    host.registerMigration({
      name: 'legacy-asset-v1',
      legacyTypes: ['asset'],
      importLegacy: (element) => importLegacyAsset(element, (value) => capability.validateReference(value))
    });
  }
};

export default plugin;
