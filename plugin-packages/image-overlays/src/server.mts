import { createHash } from 'node:crypto';
import type {
  AgentCanvasServerPlugin,
  AssetsCapabilityV1,
  CanvasElement,
  CapabilityHandle,
  JsonObject,
  OpaqueResourceHandle,
  PluginDiagnostic,
  PluginInvocationContext,
  PluginProcedureDescriptor,
  PluginToolDescriptor,
  ServerPluginHost,
  SnapshotResourcesCapabilityV1
} from '@agentcanvas/plugin-sdk';
import type { AssetReference, BBoxData, PathData, ResolvedBBoxData } from './contracts.js';
import { maskZipFilename, pngFilename } from './exports.js';
import { importLegacyImageOverlay } from './legacy.js';
import { normalizeInlineBBoxData, normalizeLayoutDocument, normalizePathData } from './normalize.js';
import {
  addBBoxInputSchema,
  addPathInputSchema,
  bboxDataSchema,
  exportInputSchema,
  exportOutputSchema,
  mutationOutputSchema,
  pathDataSchema
} from './schemas.js';
import { renderBBoxPng, renderMaskZip, renderPathPng } from './server-export.js';
import { renderBBoxSnapshot, renderPathSnapshot } from './snapshot.js';

const PLUGIN_ID = 'agentcanvas.image-overlays';

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function optionalNumber(input: JsonObject, key: string): number | null | undefined {
  const value = input[key];
  return typeof value === 'number' || value === null ? value : undefined;
}

function completeElement(input: JsonObject, type: CanvasElement['type'], data: JsonObject): CanvasElement {
  const element: CanvasElement = {
    id: typeof input.id === 'string' ? input.id : crypto.randomUUID(),
    type,
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
  if (input.metadata && typeof input.metadata === 'object' && !Array.isArray(input.metadata))
    element.metadata = input.metadata;
  return element;
}

function pick(input: JsonObject, keys: readonly string[]): JsonObject {
  const result: JsonObject = {};
  for (const key of keys) if (input[key] !== undefined) result[key] = input[key];
  return result;
}

function addTool(
  name: string,
  title: string,
  description: string,
  inputSchema: JsonObject,
  type: CanvasElement['type'],
  makeData: (input: JsonObject) => JsonObject
): PluginToolDescriptor {
  return {
    name,
    title,
    description,
    inputSchema,
    outputSchema: mutationOutputSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    async invoke(input, context) {
      const canvasId = input.canvasId as string;
      const element = completeElement(input, type, makeData(input));
      const result = await context.canvas.upsertElement(
        canvasId,
        element,
        input.expectedRevision as number | undefined
      );
      return { ok: true, canvasId, elementId: element.id, result };
    }
  };
}

async function resolveBBoxData(
  data: Readonly<JsonObject>,
  assets: AssetsCapabilityV1,
  signal: AbortSignal
): Promise<ResolvedBBoxData & { imageAssetRef?: AssetReference | null }> {
  let resolved: ResolvedBBoxData & { imageAssetRef?: AssetReference | null };
  if (data.layoutAssetRef) {
    const reference = assets.validateReference(data.layoutAssetRef);
    const layout = normalizeLayoutDocument(await assets.boundedJson(reference, signal));
    resolved = {
      canvasWidth: layout.canvasWidth,
      canvasHeight: layout.canvasHeight,
      boxes: layout.boxes,
      showLabels: (data.showLabels ?? layout.showLabels ?? true) as boolean,
      ...((data.imageAssetRef ?? layout.imageAssetRef) !== undefined
        ? { imageAssetRef: (data.imageAssetRef ?? layout.imageAssetRef) as AssetReference | null }
        : {}),
      ...((data.caption ?? layout.caption) !== undefined
        ? { caption: (data.caption ?? layout.caption) as string | null }
        : {}),
      ...((data.alt ?? layout.alt) !== undefined ? { alt: (data.alt ?? layout.alt) as string | null } : {}),
      ...((data.background ?? layout.background) !== undefined
        ? { background: (data.background ?? layout.background) as string | null }
        : {})
    };
  } else {
    resolved = normalizeInlineBBoxData(data) as ResolvedBBoxData & { imageAssetRef?: AssetReference | null };
  }
  return resolved;
}

async function resolveBBox(
  data: Readonly<JsonObject>,
  assets: AssetsCapabilityV1,
  signal: AbortSignal
): Promise<JsonObject> {
  const resolved = await resolveBBoxData(data, assets, signal);
  const runtime: JsonObject = {
    canvasWidth: resolved.canvasWidth as number,
    canvasHeight: resolved.canvasHeight as number,
    boxes: resolved.boxes as unknown as JsonObject[],
    ...(resolved.caption !== undefined ? { caption: resolved.caption } : {}),
    ...(resolved.alt !== undefined ? { alt: resolved.alt } : {}),
    ...(resolved.showLabels !== undefined ? { showLabels: resolved.showLabels } : {}),
    ...(resolved.background !== undefined ? { background: resolved.background } : {})
  };
  if (resolved.imageAssetRef) {
    const resource = await assets.contentHandle(assets.validateReference(resolved.imageAssetRef), signal);
    runtime.imageHandle = resource.handle;
    runtime.imageUrl = resource.url;
  }
  return runtime;
}

function diagnostic(
  elementId: string,
  code: string,
  severity: 'info' | 'warning' | 'error',
  message: string,
  retryable: boolean
): PluginDiagnostic {
  return { code, severity, message, retryable, pluginId: PLUGIN_ID, elementId };
}

function exportInvocation(
  kind: 'png' | 'mask-zip',
  assets: CapabilityHandle<AssetsCapabilityV1>,
  resources: CapabilityHandle<SnapshotResourcesCapabilityV1>,
  host: ServerPluginHost
): (input: JsonObject, context: PluginInvocationContext) => Promise<JsonObject> {
  return async (input, context) => {
    const canvasId = input.canvasId as string;
    const elementId = input.elementId as string;
    try {
      const projection = await context.canvas.get(canvasId);
      const canvas = record(projection.canvas) ?? projection;
      const elements = Array.isArray(canvas.elements) ? canvas.elements : [];
      const element = elements.map(record).find((candidate) => candidate?.id === elementId);
      if (!element) throw new Error(`overlay element was not found: ${elementId}`);
      const type = element.type;
      if (type !== `${PLUGIN_ID}/bbox` && type !== `${PLUGIN_ID}/path`)
        throw new Error(`${elementId} is not an image overlay`);
      if (kind === 'mask-zip' && type !== `${PLUGIN_ID}/bbox`)
        throw new Error('mask ZIP export requires a bbox overlay');
      const persistedData = record(element.data);
      if (!persistedData) throw new Error('overlay data is invalid');
      const resolved =
        type === `${PLUGIN_ID}/bbox`
          ? await resolveBBoxData(persistedData as JsonObject, assets.get(), context.signal)
          : normalizePathData(persistedData);
      const width = resolved.canvasWidth as number;
      const height = resolved.canvasHeight as number;
      const bytes =
        kind === 'mask-zip'
          ? await renderMaskZip(resolved as BBoxData, elementId, context.signal)
          : type === `${PLUGIN_ID}/bbox`
            ? renderBBoxPng(resolved as BBoxData, context.signal)
            : renderPathPng(resolved as PathData, context.signal);
      context.signal.throwIfAborted();
      const mimeType = kind === 'png' ? 'image/png' : 'application/zip';
      const sha256 = createHash('sha256').update(bytes).digest('hex');
      const resource = resources.get().register({
        mimeType,
        byteLength: bytes.byteLength,
        ...(kind === 'png' ? { width, height } : {}),
        sha256,
        ttlMs: 60 * 60 * 1000,
        async load(signal) {
          signal.throwIfAborted();
          return {
            bytes: bytes.slice(),
            mimeType,
            ...(kind === 'png' ? { width, height } : {})
          };
        }
      });
      const safeResource = resourceOutput(resource);
      const diagnostics: JsonObject[] = [];
      if (
        type === `${PLUGIN_ID}/bbox` &&
        (resolved as ResolvedBBoxData & { imageAssetRef?: AssetReference }).imageAssetRef
      ) {
        diagnostics.push({
          code: 'image_background_not_embedded',
          severity: 'warning',
          message: 'The server PNG contains the overlay geometry but does not decode the referenced background image.',
          retryable: false,
          pluginId: PLUGIN_ID,
          elementId
        });
      }
      return {
        ok: true,
        export: {
          kind,
          elementId,
          filename: kind === 'png' ? pngFilename(elementId, width, height) : maskZipFilename(elementId, width, height),
          resource: safeResource
        },
        diagnostics
      };
    } catch (error) {
      const failure = diagnostic(
        elementId,
        `${kind.replace('-', '_')}_export_failed`,
        'error',
        error instanceof Error ? error.message : `${kind} export failed`,
        true
      );
      host.diagnostics.emit(failure);
      throw error;
    }
  };
}

function exportProcedure(
  name: 'export-png' | 'export-mask-zip',
  assets: CapabilityHandle<AssetsCapabilityV1>,
  resources: CapabilityHandle<SnapshotResourcesCapabilityV1>,
  host: ServerPluginHost
): PluginProcedureDescriptor {
  const kind = name === 'export-png' ? 'png' : 'mask-zip';
  return {
    name,
    description: `Render a deterministic ${kind} export and return an opaque resource handle.`,
    inputSchema: exportInputSchema,
    outputSchema: exportOutputSchema,
    invoke: exportInvocation(kind, assets, resources, host)
  };
}

function resourceOutput(resource: OpaqueResourceHandle): JsonObject {
  return {
    handle: resource.handle,
    url: resource.url,
    mimeType: resource.mimeType,
    ...(resource.byteLength !== undefined ? { byteLength: resource.byteLength } : {}),
    ...(resource.width !== undefined ? { width: resource.width } : {}),
    ...(resource.height !== undefined ? { height: resource.height } : {}),
    ...(resource.sha256 !== undefined ? { sha256: resource.sha256 } : {})
  };
}

const plugin: AgentCanvasServerPlugin = {
  activate(host: ServerPluginHost) {
    const assets = host.consumeCapability<AssetsCapabilityV1>('agentcanvas.assets', '^1.0.0');
    const resources = host.consumeCapability<SnapshotResourcesCapabilityV1>('agentcanvas.snapshot-resources', '^1.0.0');
    host.registerElementType({
      name: 'bbox',
      schemaVersion: 1,
      dataSchema: bboxDataSchema,
      defaultFrame: { width: 320, height: 240 },
      browser: true,
      snapshot: 'supported',
      validate(element) {
        try {
          if (element.data.layoutAssetRef) assets.get().validateReference(element.data.layoutAssetRef);
          else normalizeInlineBBoxData(element.data);
          if (element.data.imageAssetRef) assets.get().validateReference(element.data.imageAssetRef);
          const boxes = Array.isArray(element.data.boxes) ? element.data.boxes : [];
          const ids = boxes.map((box) => record(box)?.id).filter((id): id is string => typeof id === 'string');
          return ids.length === new Set(ids).size
            ? []
            : [{ path: '/data/boxes', code: 'duplicate_bbox_id', message: 'bbox ids must be unique' }];
        } catch (error) {
          return [
            { path: '/data', code: 'bbox_invalid', message: error instanceof Error ? error.message : 'bbox is invalid' }
          ];
        }
      },
      summarize: (element) => ({
        title: typeof element.data.caption === 'string' ? element.data.caption : 'Bounding boxes',
        detail: element.data.layoutAssetRef
          ? 'Asset-backed layout'
          : `${Array.isArray(element.data.boxes) ? element.data.boxes.length : 0} boxes`
      }),
      async resolve(element, context) {
        try {
          return { runtime: await resolveBBox(element.data, assets.get(), context.signal) };
        } catch (error) {
          const issue = diagnostic(
            element.id,
            'bbox_layout_resolution_failed',
            'error',
            error instanceof Error ? error.message : 'bbox layout resolution failed',
            true
          );
          host.diagnostics.emit(issue);
          return { runtime: {}, diagnostics: [issue] };
        }
      },
      renderSnapshot: (element, context) => renderBBoxSnapshot(element, context.runtime, context.theme)
    });
    host.registerElementType({
      name: 'path',
      schemaVersion: 1,
      dataSchema: pathDataSchema,
      defaultFrame: { width: 320, height: 240 },
      browser: true,
      snapshot: 'supported',
      validate(element) {
        try {
          const data = normalizePathData(element.data);
          const ids = data.paths.map((path) => path.id);
          return ids.length === new Set(ids).size
            ? []
            : [{ path: '/data/paths', code: 'duplicate_path_id', message: 'path ids must be unique' }];
        } catch (error) {
          return [
            { path: '/data', code: 'path_invalid', message: error instanceof Error ? error.message : 'path is invalid' }
          ];
        }
      },
      summarize: (element) => ({
        title: typeof element.data.caption === 'string' ? element.data.caption : 'Path overlay',
        detail: `${Array.isArray(element.data.paths) ? element.data.paths.length : 0} paths`
      }),
      renderSnapshot: (element, context) => renderPathSnapshot(element, context.theme)
    });

    host.registerTool(
      addTool(
        'add-bbox',
        'Add bounding-box overlay',
        'Add an inline or Assets-backed bounding-box overlay.',
        addBBoxInputSchema as JsonObject,
        `${PLUGIN_ID}/bbox`,
        (input) =>
          pick(input, [
            'canvasWidth',
            'canvasHeight',
            'boxes',
            'layoutAssetRef',
            'imageAssetRef',
            'caption',
            'alt',
            'showLabels',
            'background'
          ])
      )
    );
    host.registerTool(
      addTool(
        'add-path',
        'Add path overlay',
        'Add an SVG path overlay with labels and a legend.',
        addPathInputSchema as JsonObject,
        `${PLUGIN_ID}/path`,
        (input) => pick(input, ['canvasWidth', 'canvasHeight', 'paths', 'caption', 'alt', 'showLabels', 'background'])
      )
    );
    for (const name of ['export-png', 'export-mask-zip'] as const) {
      const procedure = exportProcedure(name, assets, resources, host);
      host.registerProcedure(procedure);
      host.registerTool({
        name,
        title: name === 'export-png' ? 'Export overlay PNG' : 'Export bbox mask ZIP',
        description: procedure.description,
        inputSchema: procedure.inputSchema,
        outputSchema: procedure.outputSchema,
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        invoke: procedure.invoke
      });
    }
    host.registerMigration({
      name: 'legacy-image-overlays-v1',
      legacyTypes: ['bboxOverlay', 'pathOverlay'],
      importLegacy: (element) => importLegacyImageOverlay(element)
    });
  }
};

export default plugin;
