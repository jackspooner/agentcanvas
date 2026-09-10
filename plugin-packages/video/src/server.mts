import type {
  AgentCanvasServerPlugin,
  AssetsCapabilityV1,
  CanvasElement,
  JsonObject,
  PluginValidationIssue,
  ServerPluginHost
} from '@agentcanvas/plugin-sdk';
import { videoData } from './data.js';
import { importLegacyVideo } from './legacy.js';
import { resourceProjection } from './resources.js';
import { mutationOutputSchema, placeVideoInputSchema, videoDataSchema, videoStyleSchema } from './schemas.js';
import { renderVideoSnapshot } from './snapshot.js';

function optionalNumber(input: JsonObject, key: string): number | null | undefined {
  const value = input[key];
  return typeof value === 'number' || value === null ? value : undefined;
}

function referenceIssues(capability: AssetsCapabilityV1, value: unknown, path: string): PluginValidationIssue[] {
  try {
    capability.validateReference(value);
    return [];
  } catch {
    return [{ path, code: 'asset_reference_invalid', message: 'asset reference is invalid' }];
  }
}

const plugin: AgentCanvasServerPlugin = {
  activate(host: ServerPluginHost) {
    const assets = host.consumeCapability<AssetsCapabilityV1>('agentcanvas.assets', '^1.0.0').get();
    host.registerElementType({
      name: 'video',
      schemaVersion: 1,
      dataSchema: videoDataSchema,
      styleSchema: videoStyleSchema,
      defaultFrame: { width: 480, height: 270 },
      browser: true,
      snapshot: 'supported',
      validate(element) {
        const data = videoData(element);
        return [
          ...referenceIssues(assets, data.assetRef, '/data/assetRef'),
          ...(data.posterAssetRef ? referenceIssues(assets, data.posterAssetRef, '/data/posterAssetRef') : [])
        ];
      },
      summarize(element) {
        const data = videoData(element);
        return {
          title: data.caption ?? data.alt ?? 'Video',
          detail: `${data.controls ? 'controls' : 'no controls'} · ${data.autoplay ? 'autoplay' : 'manual'}`
        };
      },
      async resolve(element, context) {
        const data = videoData(element);
        try {
          const source = await assets.contentHandle(data.assetRef, context.signal);
          if (!source.mimeType.toLowerCase().startsWith('video/')) throw new TypeError('video MIME type required');
          const runtime: JsonObject = { source: resourceProjection(source) };
          const diagnostics = [];
          if (data.posterAssetRef) {
            try {
              const poster = await assets.contentHandle(data.posterAssetRef, context.signal);
              if (!poster.mimeType.toLowerCase().startsWith('image/')) throw new TypeError('image MIME type required');
              runtime.poster = resourceProjection(poster);
            } catch {
              diagnostics.push({
                code: 'video_poster_resolution_failed',
                severity: 'warning' as const,
                message: 'The video poster could not be resolved.',
                retryable: true,
                pluginId: 'agentcanvas.video',
                elementId: element.id
              });
            }
          }
          return { runtime, diagnostics };
        } catch {
          return {
            runtime: {},
            diagnostics: [
              {
                code: 'video_resolution_failed',
                severity: 'error',
                message: 'The video resource could not be resolved.',
                retryable: true,
                pluginId: 'agentcanvas.video',
                elementId: element.id
              }
            ]
          };
        }
      },
      renderSnapshot: (element, context) => renderVideoSnapshot(element, context.runtime, context.theme)
    });
    host.registerTool({
      name: 'place',
      title: 'Place video',
      description: 'Place an Assets-2 video on a canvas.',
      inputSchema: placeVideoInputSchema,
      outputSchema: mutationOutputSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
      async invoke(input, context) {
        const canvasId = input.canvasId as string;
        const data: JsonObject = {
          assetRef: assets.validateReference(input.assetRef),
          controls: typeof input.controls === 'boolean' ? input.controls : true,
          autoplay: typeof input.autoplay === 'boolean' ? input.autoplay : false,
          loop: typeof input.loop === 'boolean' ? input.loop : false,
          muted: typeof input.muted === 'boolean' ? input.muted : false
        };
        for (const key of ['caption', 'alt'] as const) if (input[key] !== undefined) data[key] = input[key];
        if (input.posterAssetRef !== undefined)
          data.posterAssetRef = input.posterAssetRef === null ? null : assets.validateReference(input.posterAssetRef);
        const element: CanvasElement = {
          id: typeof input.id === 'string' ? input.id : crypto.randomUUID(),
          type: 'agentcanvas.video/video',
          schemaVersion: 1,
          x: input.x as number,
          y: input.y as number,
          width: optionalNumber(input, 'width') ?? 480,
          height: optionalNumber(input, 'height') ?? 270,
          data
        };
        for (const key of ['zIndex', 'rotation', 'opacity'] as const) {
          const value = optionalNumber(input, key);
          if (value !== undefined) element[key] = value;
        }
        if (typeof input.locked === 'boolean' || input.locked === null) element.locked = input.locked;
        if (input.style && typeof input.style === 'object' && !Array.isArray(input.style)) element.style = input.style;
        if (input.metadata && typeof input.metadata === 'object' && !Array.isArray(input.metadata))
          element.metadata = input.metadata;
        const result = await context.canvas.upsertElementReceipt(
          canvasId,
          element,
          input.expectedRevision as number | undefined
        );
        return { ...result, elementId: element.id };
      }
    });
    host.registerMigration({
      name: 'legacy-video-v1',
      legacyTypes: ['video'],
      importLegacy: (element) => importLegacyVideo(element)
    });
  }
};

export default plugin;
