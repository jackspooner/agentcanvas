import type {
  AgentCanvasServerPlugin,
  AssetsCapabilityV1,
  CanvasElement,
  JsonObject,
  PluginValidationIssue,
  ServerPluginHost
} from '@agentcanvas/plugin-sdk';
import { modelData } from './data.js';
import { importLegacyModel } from './legacy.js';
import { resourceProjection } from './resources.js';
import {
  detailsInputSchema,
  detailsOutputSchema,
  modelDataSchema,
  modelStyleSchema,
  mutationOutputSchema,
  placeModelInputSchema
} from './schemas.js';
import { renderModelSnapshot } from './snapshot.js';

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
      name: 'model',
      schemaVersion: 1,
      dataSchema: modelDataSchema,
      styleSchema: modelStyleSchema,
      defaultFrame: { width: 320, height: 240 },
      browser: true,
      snapshot: 'supported',
      validate(element) {
        const data = modelData(element);
        return [
          ...referenceIssues(assets, data.assetRef, '/data/assetRef'),
          ...(data.posterAssetRef ? referenceIssues(assets, data.posterAssetRef, '/data/posterAssetRef') : [])
        ];
      },
      summarize(element) {
        const data = modelData(element);
        return {
          title: data.caption ?? data.alt ?? '3D model',
          detail: `${data.cameraControls ? 'interactive' : 'fixed'} · ${data.autoRotate ? 'autorotate' : 'static'}`
        };
      },
      async resolve(element, context) {
        const data = modelData(element);
        try {
          const source = await assets.contentHandle(data.assetRef, context.signal);
          const mime = source.mimeType.toLowerCase();
          if (mime !== 'model/gltf-binary' && mime !== 'application/octet-stream')
            throw new TypeError('GLB MIME type required');
          const runtime: JsonObject = { source: resourceProjection(source) };
          const diagnostics = [];
          if (data.posterAssetRef) {
            try {
              const poster = await assets.contentHandle(data.posterAssetRef, context.signal);
              if (!poster.mimeType.toLowerCase().startsWith('image/')) throw new TypeError('image MIME type required');
              runtime.poster = resourceProjection(poster);
            } catch {
              diagnostics.push({
                code: 'glb_poster_resolution_failed',
                severity: 'warning' as const,
                message: 'The GLB poster could not be resolved.',
                retryable: true,
                pluginId: 'agentcanvas.glb-viewer',
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
                code: 'glb_resolution_failed',
                severity: 'error',
                message: 'The GLB resource could not be resolved.',
                retryable: true,
                pluginId: 'agentcanvas.glb-viewer',
                elementId: element.id
              }
            ]
          };
        }
      },
      renderSnapshot: (element, context) => renderModelSnapshot(element, context.runtime, context.theme)
    });
    host.registerTool({
      name: 'place',
      title: 'Place GLB model',
      description: 'Place an Assets-2 GLB model on a canvas.',
      inputSchema: placeModelInputSchema,
      outputSchema: mutationOutputSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
      async invoke(input, context) {
        const canvasId = input.canvasId as string;
        const data: JsonObject = {
          assetRef: assets.validateReference(input.assetRef),
          cameraControls: typeof input.cameraControls === 'boolean' ? input.cameraControls : true,
          autoRotate: typeof input.autoRotate === 'boolean' ? input.autoRotate : false
        };
        for (const key of ['caption', 'alt'] as const) if (input[key] !== undefined) data[key] = input[key];
        if (input.posterAssetRef !== undefined)
          data.posterAssetRef = input.posterAssetRef === null ? null : assets.validateReference(input.posterAssetRef);
        const element: CanvasElement = {
          id: typeof input.id === 'string' ? input.id : crypto.randomUUID(),
          type: 'agentcanvas.glb-viewer/model',
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
        if (input.metadata && typeof input.metadata === 'object' && !Array.isArray(input.metadata))
          element.metadata = input.metadata;
        const result = await context.canvas.upsertElementReceipt(
          canvasId,
          element,
          input.expectedRevision as number | undefined
        );
        return { ok: true, canvasId, elementId: element.id, result };
      }
    });
    host.registerProcedure({
      name: 'details',
      description: 'Read safe Assets-2 metadata for a GLB model and its optional poster.',
      inputSchema: detailsInputSchema,
      outputSchema: detailsOutputSchema,
      async invoke(input, context) {
        const modelReference = assets.validateReference(input.assetRef);
        const posterReference =
          input.posterAssetRef === undefined || input.posterAssetRef === null
            ? null
            : assets.validateReference(input.posterAssetRef);
        const [model, poster] = await Promise.all([
          assets.details(modelReference, context.signal),
          posterReference ? assets.details(posterReference, context.signal) : Promise.resolve(null)
        ]);
        return { ok: true, details: { model, poster } };
      }
    });
    host.registerMigration({
      name: 'legacy-glb-v1',
      legacyTypes: ['glbViewer'],
      importLegacy: (element) => importLegacyModel(element)
    });
  }
};

export default plugin;
