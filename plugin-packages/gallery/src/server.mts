import type {
  AgentCanvasServerPlugin,
  ImageSourcesCapabilityV1,
  JsonObject,
  PluginDiagnostic,
  PluginValidationIssue,
  ServerPluginHost,
  PluginInvocationContext
} from '@agentcanvas/plugin-sdk';
import {
  GALLERY_AUTHORING_CAPABILITY,
  IMAGE_SOURCES_CAPABILITY,
  ImageSourceNotReadyError
} from '@agentcanvas/plugin-sdk';
import { galleryData } from './contracts.js';
import { galleryDataSchema, galleryStyleSchema } from './schemas.js';
import { renderGallerySnapshot } from './snapshot.js';
import { galleryTools } from './tools.js';
import { galleryAuthoring } from './authoring.js';

function validationIssues(
  data: ReturnType<typeof galleryData>,
  imageSources: ImageSourcesCapabilityV1
): PluginValidationIssue[] {
  const issues: PluginValidationIssue[] = [];
  const seen = new Set<string>();
  data.items.forEach((item, index) => {
    if (seen.has(item.id)) {
      issues.push({
        path: `/data/items/${index}/id`,
        code: 'gallery_item_id_duplicate',
        message: 'gallery item IDs must be unique'
      });
    }
    seen.add(item.id);
    if (imageSources.hasProvider(item.source.provider)) {
      try {
        imageSources.validateReference(item.source);
      } catch {
        issues.push({
          path: `/data/items/${index}/source`,
          code: 'gallery_image_source_invalid',
          message: 'gallery image source is invalid for its provider'
        });
      }
    }
  });
  if (data.initialIndex >= data.items.length) {
    issues.push({
      path: '/data/initialIndex',
      code: 'gallery_cover_invalid',
      message: 'gallery cover index is out of range'
    });
  }
  return issues;
}

const plugin: AgentCanvasServerPlugin = {
  activate(host: ServerPluginHost) {
    const imageSources = host.consumeCapability<ImageSourcesCapabilityV1>(IMAGE_SOURCES_CAPABILITY, '^1.0.0').get();
    const tools = galleryTools(imageSources);
    let service: PluginInvocationContext | null = null;
    host.provideCapability({
      name: GALLERY_AUTHORING_CAPABILITY,
      version: '1.0.0',
      value: galleryAuthoring(
        () => {
          if (!service) throw new Error('Gallery authoring is unavailable before runtime start.');
          return service;
        },
        tools,
        imageSources
      )
    });
    host.registerElementType({
      name: 'gallery',
      schemaVersion: 1,
      dataSchema: galleryDataSchema,
      styleSchema: galleryStyleSchema,
      defaultFrame: { width: 480, height: 320 },
      browser: true,
      snapshot: 'supported',
      validate: (element) => validationIssues(galleryData(element.data), imageSources),
      summarize(element) {
        const data = galleryData(element.data);
        const cover = data.items[data.initialIndex] ?? data.items[0];
        return {
          title: cover.caption ?? cover.alt ?? 'Media Gallery',
          detail: `${data.items.length} image${data.items.length === 1 ? '' : 's'} · ${data.fit}`
        };
      },
      async resolve(element, context) {
        const data = galleryData(element.data);
        const diagnostics: PluginDiagnostic[] = [];
        const items = await Promise.all(
          data.items.map(async (item) => {
            try {
              const resource = await imageSources.resolve(item.source, context.signal);
              return {
                id: item.id,
                contentHandle: resource.handle,
                contentUrl: resource.url,
                mimeType: resource.mimeType,
                ...(resource.byteLength !== undefined ? { byteLength: resource.byteLength } : {}),
                ...(resource.width !== undefined ? { width: resource.width } : {}),
                ...(resource.height !== undefined ? { height: resource.height } : {})
              };
            } catch (error) {
              if (error instanceof ImageSourceNotReadyError) {
                diagnostics.push({
                  code: error.code,
                  severity: error.state === 'failed' ? 'error' : 'info',
                  message: error.message,
                  retryable: error.retryable,
                  pluginId: 'agentcanvas.gallery',
                  elementId: element.id
                });
                return { id: item.id, state: error.state, message: error.message };
              }
              diagnostics.push({
                code: imageSources.hasProvider(item.source.provider)
                  ? 'gallery_image_resolution_failed'
                  : 'gallery_image_provider_unavailable',
                severity: 'warning',
                message: imageSources.hasProvider(item.source.provider)
                  ? `Gallery image ${item.id} could not be resolved.`
                  : `Gallery image provider ${item.source.provider} is unavailable.`,
                retryable: true,
                pluginId: 'agentcanvas.gallery',
                elementId: element.id
              });
              return { id: item.id };
            }
          })
        );
        return { runtime: { items } as unknown as JsonObject, diagnostics };
      },
      renderSnapshot: (element, context) => renderGallerySnapshot(element, context.runtime, context.theme)
    });
    for (const tool of tools) host.registerTool(tool);
    return {
      start(context) {
        service = context;
      },
      dispose() {
        service = null;
      }
    };
  }
};

export default plugin;
