import { isDeepStrictEqual } from 'node:util';
import { Ajv2020 } from 'ajv/dist/2020.js';
import type {
  CanvasElement,
  CanvasMutationReceipt,
  GalleryAuthoringCapabilityV1,
  ImageSourcesCapabilityV1,
  JsonObject,
  PluginInvocationContext,
  PluginToolDescriptor
} from '@agentcanvas/plugin-sdk';
import { PluginValidationError } from '@agentcanvas/plugin-sdk';
import { galleryData } from './contracts.js';

/** This capability always writes through Gallery's own permission-scoped operations. */
export function galleryAuthoring(
  context: () => PluginInvocationContext,
  tools: readonly PluginToolDescriptor[],
  sources: ImageSourcesCapabilityV1
): GalleryAuthoringCapabilityV1 {
  const ajv = new Ajv2020({ strict: true, allErrors: true });
  const operations = new Map(tools.map((tool) => [tool.name, { tool, validate: ajv.compile(tool.inputSchema) }]));
  const scoped = (signal: AbortSignal): PluginInvocationContext => {
    const active = context();
    const combined = AbortSignal.any([active.signal, signal]);
    combined.throwIfAborted();
    return { ...active, signal: combined };
  };
  const read = async (canvasId: string, signal: AbortSignal) => {
    const call = scoped(signal);
    const canvas = await call.canvas.get(canvasId);
    call.signal.throwIfAborted();
    return { call, revision: canvas.revision as number, elements: canvas.elements as unknown as CanvasElement[] };
  };
  const invoke = async (name: string, input: JsonObject, call: PluginInvocationContext) => {
    call.signal.throwIfAborted();
    const operation = operations.get(name)!;
    if (!operation.validate(input)) throw new PluginValidationError(`Invalid Gallery ${name} input.`);
    const { canvasId, revision, inspectionSummary } = (await operation.tool.invoke(
      input,
      call
    )) as CanvasMutationReceipt;
    return { canvasId, revision, inspectionSummary };
  };
  return {
    async create(input, signal) {
      const current = await read(String(input.canvasId), signal);
      if (current.elements.some((element) => element.id === input.id)) {
        throw new PluginValidationError('The reserved image element ID is already in use.');
      }
      return invoke('create', { ...input, expectedRevision: input.expectedRevision ?? current.revision }, current.call);
    },
    async append(input, signal) {
      const current = await read(String(input.canvasId), signal);
      return invoke(
        'append-items',
        { ...input, expectedRevision: input.expectedRevision ?? current.revision },
        current.call
      );
    },
    async getItem(canvasId, elementId, itemId, signal) {
      const current = await read(canvasId, signal);
      const element = current.elements.find((entry) => entry.id === elementId);
      if (element && element.type !== 'agentcanvas.gallery/gallery') {
        throw new PluginValidationError('The target element is not a Gallery.');
      }
      const item = element ? galleryData(element.data).items.find((entry) => entry.id === itemId) : null;
      return { source: item?.source ?? null, revision: current.revision };
    },
    async replaceSource(input, signal) {
      const current = await read(input.canvasId, signal);
      const element = current.elements.find((entry) => entry.id === input.elementId);
      if (!element || element.type !== 'agentcanvas.gallery/gallery') return { changed: false };
      const data = structuredClone(galleryData(element.data));
      const item = data.items.find((entry) => entry.id === input.itemId);
      if (!item || !isDeepStrictEqual(item.source, input.expectedSource)) return { changed: false };
      item.source = sources.validateReference(input.source);
      current.call.signal.throwIfAborted();
      const receipt = await current.call.canvas.replaceElementDataReceipt(
        input.canvasId,
        input.elementId,
        data as unknown as JsonObject,
        undefined,
        input.expectedRevision ?? current.revision
      );
      return { changed: true, receipt };
    }
  };
}
