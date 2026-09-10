import type {
  CanvasElement,
  ImageSourcesCapabilityV1,
  JsonObject,
  PluginInvocationContext,
  PluginToolDescriptor
} from '@agentcanvas/plugin-sdk';
import type { GalleryData, GalleryItem } from './contracts.js';
import { galleryData } from './contracts.js';
import {
  appendItemsInputSchema,
  createGalleryInputSchema,
  mutationOutputSchema,
  removeItemInputSchema,
  reorderItemsInputSchema,
  setCoverInputSchema,
  updateSettingsInputSchema
} from './schemas.js';

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} must be an object`);
  return value as Record<string, unknown>;
}

function optionalNumber(input: JsonObject, key: string): number | null | undefined {
  const value = input[key];
  return typeof value === 'number' || value === null ? value : undefined;
}

function normalizeItems(value: unknown, imageSources: ImageSourcesCapabilityV1): GalleryItem[] {
  if (!Array.isArray(value) || value.length === 0) throw new TypeError('gallery items must be a non-empty array');
  const items = value.map((entry) => {
    const input = object(entry, 'gallery item');
    return {
      id: typeof input.id === 'string' ? input.id : crypto.randomUUID(),
      source: imageSources.validateReference(input.source),
      ...(input.caption === null || typeof input.caption === 'string' ? { caption: input.caption } : {}),
      ...(input.alt === null || typeof input.alt === 'string' ? { alt: input.alt } : {})
    } satisfies GalleryItem;
  });
  if (items.length > 50) throw new RangeError('gallery supports at most 50 items');
  if (new Set(items.map((item) => item.id)).size !== items.length) throw new Error('gallery item IDs must be unique');
  return items;
}

async function ownedGallery(
  context: PluginInvocationContext,
  canvasId: string,
  elementId: string
): Promise<CanvasElement> {
  const canvas = await context.canvas.get(canvasId);
  if (!Array.isArray(canvas.elements)) throw new Error('canvas projection does not contain elements');
  const element = canvas.elements.find(
    (candidate) =>
      candidate &&
      typeof candidate === 'object' &&
      !Array.isArray(candidate) &&
      (candidate as Record<string, unknown>).id === elementId
  ) as CanvasElement | undefined;
  if (!element) throw new Error(`gallery element was not found: ${elementId}`);
  if (element.type !== 'agentcanvas.gallery/gallery') throw new Error(`${elementId} is not a gallery element`);
  return element;
}

function output(canvasId: string, elementId: string, result: JsonObject): JsonObject {
  return { ok: true, canvasId, elementId, result };
}

async function replaceData(
  context: PluginInvocationContext,
  input: JsonObject,
  transform: (data: GalleryData) => GalleryData
): Promise<JsonObject> {
  const canvasId = input.canvasId as string;
  const elementId = input.elementId as string;
  const element = await ownedGallery(context, canvasId, elementId);
  const next = transform(structuredClone(galleryData(element.data)));
  const result = await context.canvas.replaceElementDataReceipt(
    canvasId,
    elementId,
    next as unknown as JsonObject,
    undefined,
    input.expectedRevision as number | undefined
  );
  return output(canvasId, elementId, result);
}

const annotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false
} as const;

export function galleryTools(imageSources: ImageSourcesCapabilityV1): readonly PluginToolDescriptor[] {
  return [
    {
      name: 'create',
      title: 'Create gallery',
      description: 'Create a provider-neutral image gallery on a canvas.',
      inputSchema: createGalleryInputSchema,
      outputSchema: mutationOutputSchema,
      annotations,
      async invoke(input, context) {
        const canvasId = input.canvasId as string;
        const elementId = typeof input.id === 'string' ? input.id : crypto.randomUUID();
        const data: GalleryData = {
          items: normalizeItems(input.items, imageSources),
          presentation: 'carousel',
          fit: input.fit === 'cover' || input.fit === 'stretch' || input.fit === 'original' ? input.fit : 'contain',
          initialIndex: 0,
          autoplay: input.autoplay === true,
          intervalMs: typeof input.intervalMs === 'number' ? input.intervalMs : 5_000,
          showControls: input.showControls !== false,
          showIndicators: input.showIndicators !== false
        };
        const element: CanvasElement = {
          id: elementId,
          type: 'agentcanvas.gallery/gallery',
          schemaVersion: 1,
          x: input.x as number,
          y: input.y as number,
          width: optionalNumber(input, 'width') ?? 480,
          height: optionalNumber(input, 'height') ?? 320,
          data: data as unknown as JsonObject
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
        return output(
          canvasId,
          elementId,
          await context.canvas.upsertElementReceipt(canvasId, element, input.expectedRevision as number | undefined)
        );
      }
    },
    {
      name: 'append-items',
      title: 'Append gallery items',
      description: 'Append images to an existing gallery.',
      inputSchema: appendItemsInputSchema,
      outputSchema: mutationOutputSchema,
      annotations,
      invoke: (input, context) =>
        replaceData(context, input, (data) => {
          const appended = normalizeItems(input.items, imageSources);
          if (data.items.length + appended.length > 50) throw new RangeError('gallery supports at most 50 items');
          const ids = new Set(data.items.map((item) => item.id));
          if (appended.some((item) => ids.has(item.id))) throw new Error('gallery item IDs must be unique');
          return { ...data, items: [...data.items, ...appended] };
        })
    },
    {
      name: 'remove-item',
      title: 'Remove gallery item',
      description: 'Remove one image from a gallery while preserving a valid cover image.',
      inputSchema: removeItemInputSchema,
      outputSchema: mutationOutputSchema,
      annotations: { ...annotations, destructiveHint: true },
      invoke: (input, context) =>
        replaceData(context, input, (data) => {
          if (data.items.length === 1) throw new Error('a gallery must contain at least one item');
          const index = data.items.findIndex((item) => item.id === input.itemId);
          if (index < 0) throw new Error(`gallery item was not found: ${String(input.itemId)}`);
          const coverId = data.items[data.initialIndex]?.id;
          const items = data.items.filter((_, candidate) => candidate !== index);
          const retainedCover = coverId ? items.findIndex((item) => item.id === coverId) : -1;
          return {
            ...data,
            items,
            initialIndex: retainedCover >= 0 ? retainedCover : Math.min(index, items.length - 1)
          };
        })
    },
    {
      name: 'reorder-items',
      title: 'Reorder gallery items',
      description: 'Replace the gallery item order while keeping the same items and cover.',
      inputSchema: reorderItemsInputSchema,
      outputSchema: mutationOutputSchema,
      annotations,
      invoke: (input, context) =>
        replaceData(context, input, (data) => {
          const requested = input.itemIds as unknown as string[];
          const current = new Map(data.items.map((item) => [item.id, item]));
          if (requested.length !== data.items.length || requested.some((id) => !current.has(id))) {
            throw new Error('itemIds must contain every gallery item exactly once');
          }
          const coverId = data.items[data.initialIndex]?.id;
          const items = requested.map((id) => current.get(id) as GalleryItem);
          return {
            ...data,
            items,
            initialIndex: Math.max(
              0,
              items.findIndex((item) => item.id === coverId)
            )
          };
        })
    },
    {
      name: 'set-cover',
      title: 'Set gallery cover',
      description: 'Choose the deterministic initial and snapshot image for a gallery.',
      inputSchema: setCoverInputSchema,
      outputSchema: mutationOutputSchema,
      annotations,
      invoke: (input, context) =>
        replaceData(context, input, (data) => {
          const initialIndex = data.items.findIndex((item) => item.id === input.itemId);
          if (initialIndex < 0) throw new Error(`gallery item was not found: ${String(input.itemId)}`);
          return { ...data, initialIndex };
        })
    },
    {
      name: 'update-settings',
      title: 'Update gallery settings',
      description: 'Update gallery fit, autoplay interval, controls, or indicators.',
      inputSchema: updateSettingsInputSchema,
      outputSchema: mutationOutputSchema,
      annotations,
      invoke: (input, context) =>
        replaceData(context, input, (data) => {
          const next = { ...data };
          let changed = false;
          for (const key of ['fit', 'autoplay', 'intervalMs', 'showControls', 'showIndicators'] as const) {
            if (input[key] !== undefined) {
              (next as unknown as Record<string, unknown>)[key] = input[key];
              changed = true;
            }
          }
          if (!changed) throw new Error('at least one gallery setting is required');
          return next;
        })
    }
  ];
}
