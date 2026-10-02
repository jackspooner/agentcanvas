import type {
  AgentCanvasServerPlugin,
  FilesystemImageAdmissionCapabilityV1,
  GalleryAuthoringCapabilityV1,
  ImageSourcesCapabilityV1
} from '@agentcanvas/extension-sdk';
import {
  FILESYSTEM_IMAGE_ADMISSION_CAPABILITY,
  GALLERY_AUTHORING_CAPABILITY,
  IMAGE_SOURCES_CAPABILITY,
  ImageSourceNotReadyError,
  PluginValidationError
} from '@agentcanvas/extension-sdk';
import { MediaToolsClient } from 'media-tools-mcp/client';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { BindingWorker } from './worker.js';
import { publicBinding, type BindInput, type MediaToolsConfig } from './contracts.js';
import { bindInputSchema, bindOutputSchema, getInputSchema, listInputSchema, listOutputSchema } from './schemas.js';

const plugin: AgentCanvasServerPlugin = {
  activate(host) {
    const config = host.config as unknown as MediaToolsConfig;
    const gallery = host.consumeCapability<GalleryAuthoringCapabilityV1>(GALLERY_AUTHORING_CAPABILITY, '^1.0.0').get();
    const files = host
      .consumeCapability<FilesystemImageAdmissionCapabilityV1>(FILESYSTEM_IMAGE_ADMISSION_CAPABILITY, '^1.0.0')
      .get();
    const sources = host.consumeCapability<ImageSourcesCapabilityV1>(IMAGE_SOURCES_CAPABILITY, '^1.0.0').get();
    let worker: BindingWorker | undefined;
    const current = () => {
      if (!worker) throw new PluginValidationError('MediaTools bindings are unavailable before runtime start.');
      return worker;
    };
    sources.registerProvider({
      provider: 'agentcanvas.mediatools',
      validateReference(value) {
        if (!value || typeof value !== 'object' || Array.isArray(value))
          throw new PluginValidationError('Invalid job image reference.');
        const input = value as Record<string, unknown>;
        if (
          Object.keys(input).length !== 1 ||
          typeof input.bindingId !== 'string' ||
          !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(input.bindingId)
        ) {
          throw new PluginValidationError('Invalid job image binding ID.');
        }
        return { bindingId: input.bindingId };
      },
      async resolve(reference, signal) {
        signal.throwIfAborted();
        const record = await current().get(String(reference.bindingId));
        signal.throwIfAborted();
        if (!record)
          throw new ImageSourceNotReadyError(
            'failed',
            'The image attachment does not exist.',
            'mediatools_binding_missing',
            false
          );
        if (record.source) return sources.resolve(record.source, signal);
        if (record.status === 'failed' || record.status === 'superseded') {
          throw new ImageSourceNotReadyError(
            'failed',
            record.error?.message ?? 'This image attachment was replaced or removed.',
            record.error?.code ?? 'mediatools_binding_superseded',
            false
          );
        }
        throw new ImageSourceNotReadyError(
          record.status === 'running' || record.status === 'collected' ? 'running' : 'queued',
          record.error?.message ??
            (record.status === 'running'
              ? 'Generating image…'
              : record.status === 'collected'
                ? 'Attaching image…'
                : 'Waiting for image…'),
          record.error?.code ?? 'mediatools_image_pending',
          true
        );
      }
    });
    host.registerTool({
      name: 'bind',
      title: 'Bind MediaTools image job',
      description:
        'Attach an existing image job to a reserved image frame or carousel item. Reuse bindingId with identical inputs when retrying. Collection saves outputs but never submits generation.',
      inputSchema: bindInputSchema,
      outputSchema: bindOutputSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
      invoke: (input, context) => current().bind(input as unknown as BindInput, context.signal)
    });
    host.registerTool({
      name: 'get-binding',
      title: 'Get image job binding',
      description:
        'Read one image attachment status and its canonical completed source without polling or collecting the job.',
      inputSchema: getInputSchema,
      outputSchema: bindOutputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      async invoke(input) {
        const record = await current().get(String(input.bindingId));
        if (!record) throw new PluginValidationError('The image attachment does not exist.');
        return { binding: publicBinding(record) };
      }
    });
    host.registerTool({
      name: 'list-bindings',
      title: 'List image job bindings',
      description:
        'Read a bounded page of image attachments. Use nextCursor even when a canvas filter returns an empty page.',
      inputSchema: listInputSchema,
      outputSchema: listOutputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      invoke: (input) => current().list(input as { canvasId?: string; cursor?: string; limit?: number })
    });
    return {
      async start(context) {
        const bearerToken = process.env.AGENT_CANVAS_MEDIATOOLS_TOKEN;
        if (!bearerToken) throw new Error('AGENT_CANVAS_MEDIATOOLS_TOKEN is required for the MediaTools extension.');
        const client = new MediaToolsClient({ baseUrl: config.baseUrl, bearerToken, timeoutMs: 10_000 });
        if (!path.isAbsolute(config.outputDirectory) || !(await stat(config.outputDirectory)).isDirectory()) {
          throw new Error('MediaTools outputDirectory must be an existing absolute directory.');
        }
        // Validate the configured root through its owning provider without reading or publishing a file.
        sources.validateReference({
          provider: 'agentcanvas.filesystem-images',
          reference: { rootId: config.filesystemRootId, path: 'configuration-check.png' }
        });
        worker = new BindingWorker(host.kv, gallery, files, client, config, context.signal, host.diagnostics);
        worker.start();
      },
      dispose() {
        worker?.dispose();
        worker = undefined;
      }
    };
  }
};
export default plugin;
