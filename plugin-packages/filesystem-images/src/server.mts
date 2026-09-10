import type {
  AgentCanvasServerPlugin,
  CanvasElement,
  ImageSourcesCapabilityV1,
  JsonObject,
  PluginInvocationContext,
  PluginToolDescriptor,
  ServerPluginHost,
  SnapshotResourcesCapabilityV1
} from '@agentcanvas/plugin-sdk';
import { IMAGE_SOURCES_CAPABILITY } from '@agentcanvas/plugin-sdk';
import { fileSystemImageData } from './contracts.js';
import { FileSystemImageSourceResolver, normalizeRelativeImagePath, readFileSystemImagesConfig } from './filesystem.js';
import {
  asJsonSchema,
  imageDataSchema,
  imageStyleSchema,
  listRootsInputSchema,
  listRootsOutputSchema,
  mutationOutputSchema,
  placeImageInputSchema
} from './schemas.js';
import { renderFileSystemImageSnapshot } from './snapshot.js';

function optionalNumber(input: JsonObject, key: string): number | null | undefined {
  const value = input[key];
  return typeof value === 'number' || value === null ? value : undefined;
}

function placeTool(sourceResolver: FileSystemImageSourceResolver): PluginToolDescriptor {
  return {
    name: 'place',
    title: 'Place filesystem image',
    description: 'Place an image from an administrator-allowlisted filesystem root.',
    inputSchema: asJsonSchema(placeImageInputSchema),
    outputSchema: asJsonSchema(mutationOutputSchema),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    async invoke(input: JsonObject, context: PluginInvocationContext): Promise<JsonObject> {
      const canvasId = input.canvasId as string;
      const data: JsonObject = { source: sourceResolver.validateSource(input.source) as unknown as JsonObject };
      for (const key of ['caption', 'fit', 'alt'] as const) {
        if (input[key] !== undefined) data[key] = input[key];
      }
      const element: CanvasElement = {
        id: typeof input.id === 'string' ? input.id : crypto.randomUUID(),
        type: 'agentcanvas.filesystem-images/image',
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
  async activate(host: ServerPluginHost) {
    const resources = host
      .consumeCapability<SnapshotResourcesCapabilityV1>('agentcanvas.snapshot-resources', '^1.0.0')
      .get();
    const imageSources = host.consumeCapability<ImageSourcesCapabilityV1>(IMAGE_SOURCES_CAPABILITY, '^1.0.0').get();
    const sourceResolver = await FileSystemImageSourceResolver.create(
      readFileSystemImagesConfig(host.config),
      resources
    );
    imageSources.registerProvider({
      provider: 'agentcanvas.filesystem-images',
      validateReference: (value) => sourceResolver.validateSource(value) as unknown as JsonObject,
      resolve: (reference, signal) => sourceResolver.resource(reference, signal)
    });
    host.registerElementType({
      name: 'image',
      schemaVersion: 1,
      dataSchema: asJsonSchema(imageDataSchema),
      styleSchema: asJsonSchema(imageStyleSchema),
      defaultFrame: { width: 320, height: 240 },
      browser: true,
      snapshot: 'supported',
      validate(element) {
        try {
          normalizeRelativeImagePath(fileSystemImageData(element.data).source.path);
          return [];
        } catch (error) {
          return [
            {
              path: '/data/source/path',
              code: 'filesystem_image_path_invalid',
              message: error instanceof Error ? error.message : 'filesystem image path is invalid'
            }
          ];
        }
      },
      summarize(element) {
        const data = fileSystemImageData(element.data);
        return {
          title: data.caption ?? data.alt ?? data.source.path.split('/').at(-1) ?? 'Filesystem image',
          detail: `${data.source.rootId} / ${data.source.path}`
        };
      },
      async resolve(element, context) {
        const data = fileSystemImageData(element.data);
        try {
          const resource = await sourceResolver.resource(data.source, context.signal);
          return {
            runtime: {
              contentHandle: resource.handle,
              contentUrl: resource.url,
              mimeType: resource.mimeType,
              byteLength: resource.byteLength
            }
          };
        } catch {
          return {
            runtime: {} as JsonObject,
            diagnostics: [
              {
                code: 'filesystem_image_resolution_failed',
                severity: 'error',
                message: 'The filesystem image could not be resolved from an allowlisted root.',
                retryable: true,
                pluginId: 'agentcanvas.filesystem-images',
                elementId: element.id
              }
            ]
          };
        }
      },
      renderSnapshot: (element, context) => renderFileSystemImageSnapshot(element, context.runtime, context.theme)
    });
    host.registerTool(placeTool(sourceResolver));
    host.registerTool({
      name: 'list-roots',
      title: 'List filesystem image roots',
      description: 'List the opaque IDs of filesystem roots available to image nodes.',
      inputSchema: asJsonSchema(listRootsInputSchema),
      outputSchema: asJsonSchema(listRootsOutputSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      async invoke(): Promise<JsonObject> {
        return { roots: sourceResolver.listRoots() } as unknown as JsonObject;
      }
    });
  }
};

export default plugin;
