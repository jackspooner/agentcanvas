import type {
  CanvasElement,
  CanvasMutationReceipt,
  JsonObject,
  PluginCanvasOperations,
  PluginPermission
} from '@agentcanvas/plugin-sdk';
import { CanvasError } from '../errors.js';
import type { V2SqliteCanvasStore } from '../store/v2.js';
import { inspectCanvas } from './inspection.js';
import type { FrozenPluginRegistry } from './registry.js';

function json(value: unknown): JsonObject {
  return JSON.parse(JSON.stringify(value)) as JsonObject;
}

/** Creates the supported permission boundary for trusted plugin canvas access. */
export function createPluginCanvasOperations(
  store: V2SqliteCanvasStore,
  pluginId: string,
  declaredPermissions: readonly PluginPermission[],
  registry: FrozenPluginRegistry,
  signal?: AbortSignal
): PluginCanvasOperations {
  const permissions = new Set(declaredPermissions);
  const requirePermission = (permission: PluginPermission): void => {
    signal?.throwIfAborted();
    if (!permissions.has(permission)) {
      throw new CanvasError('plugin_permission_denied', `${pluginId} did not declare ${permission}`, 'permission', 403);
    }
  };
  const requireOwnedElement = (canvasId: string, elementId: string): CanvasElement => {
    const element = store.getCanvas(canvasId).elements.find((candidate) => candidate.id === elementId);
    if (!element) throw new CanvasError('element_not_found', `element not found: ${elementId}`, 'not_found', 404);
    if (!element.type.startsWith(`${pluginId}/`)) {
      throw new CanvasError(
        'plugin_permission_denied',
        `${pluginId} cannot mutate an element owned by ${element.type.slice(0, element.type.lastIndexOf('/'))}`,
        'permission',
        403
      );
    }
    return element;
  };
  const receipt = (canvas: ReturnType<V2SqliteCanvasStore['applyOperations']>): CanvasMutationReceipt => ({
    canvasId: canvas.id,
    revision: canvas.revision,
    inspectionSummary: inspectCanvas(canvas, registry, store.getConfiguration().diagnostics).summary
  });
  const upsertElement = (canvasId: string, element: CanvasElement, expectedRevision?: number) => {
    requirePermission('canvas.mutate-own');
    if (!element.type.startsWith(`${pluginId}/`)) {
      throw new CanvasError('plugin_permission_denied', `${pluginId} cannot upsert ${element.type}`, 'permission', 403);
    }
    return store.applyOperations(canvasId, { expectedRevision, operations: [{ op: 'upsertElement', element }] });
  };
  const replaceElementData = (
    canvasId: string,
    elementId: string,
    data: JsonObject,
    style?: JsonObject | null,
    expectedRevision?: number
  ) => {
    requirePermission('canvas.mutate-own');
    requireOwnedElement(canvasId, elementId);
    return store.applyOperations(canvasId, {
      expectedRevision,
      operations: [{ op: 'replaceElementData', elementId, data, ...(style !== undefined ? { style } : {}) }]
    });
  };
  const deleteElement = (canvasId: string, elementId: string, expectedRevision?: number) => {
    requirePermission('canvas.mutate-own');
    requireOwnedElement(canvasId, elementId);
    return store.applyOperations(canvasId, { expectedRevision, operations: [{ op: 'deleteElement', elementId }] });
  };
  const operations: PluginCanvasOperations = {
    get: async (canvasId) => {
      requirePermission('canvas.read');
      return json(store.getCanvas(canvasId));
    },
    upsertElement: async (canvasId, element, expectedRevision) =>
      json(upsertElement(canvasId, element, expectedRevision)),
    upsertElementReceipt: async (canvasId, element, expectedRevision) =>
      receipt(upsertElement(canvasId, element, expectedRevision)),
    replaceElementData: async (canvasId, elementId, data, style, expectedRevision) =>
      json(replaceElementData(canvasId, elementId, data, style, expectedRevision)),
    replaceElementDataReceipt: async (canvasId, elementId, data, style, expectedRevision) =>
      receipt(replaceElementData(canvasId, elementId, data, style, expectedRevision)),
    deleteElement: async (canvasId, elementId, expectedRevision) =>
      json(deleteElement(canvasId, elementId, expectedRevision)),
    deleteElementReceipt: async (canvasId, elementId, expectedRevision) =>
      receipt(deleteElement(canvasId, elementId, expectedRevision))
  };
  return Object.freeze(operations);
}
