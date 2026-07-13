import type { CanvasElement, JsonObject, PluginCanvasOperations, PluginPermission } from '@agentcanvas/plugin-sdk';
import { CanvasError } from '../errors.js';
import type { V2SqliteCanvasStore } from '../store/v2.js';

function json(value: unknown): JsonObject {
  return JSON.parse(JSON.stringify(value)) as JsonObject;
}

/** Creates the supported permission boundary for trusted plugin canvas access. */
export function createPluginCanvasOperations(
  store: V2SqliteCanvasStore,
  pluginId: string,
  declaredPermissions: readonly PluginPermission[]
): PluginCanvasOperations {
  const permissions = new Set(declaredPermissions);
  const requirePermission = (permission: PluginPermission): void => {
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
  const operations: PluginCanvasOperations = {
    get: async (canvasId) => {
      requirePermission('canvas.read');
      return json(store.getCanvas(canvasId));
    },
    upsertElement: async (canvasId, element, expectedRevision) => {
      requirePermission('canvas.mutate-own');
      if (!element.type.startsWith(`${pluginId}/`)) {
        throw new CanvasError(
          'plugin_permission_denied',
          `${pluginId} cannot upsert ${element.type}`,
          'permission',
          403
        );
      }
      return json(
        store.applyOperations(canvasId, { expectedRevision, operations: [{ op: 'upsertElement', element }] })
      );
    },
    replaceElementData: async (canvasId, elementId, data, style, expectedRevision) => {
      requirePermission('canvas.mutate-own');
      requireOwnedElement(canvasId, elementId);
      return json(
        store.applyOperations(canvasId, {
          expectedRevision,
          operations: [{ op: 'replaceElementData', elementId, data, ...(style !== undefined ? { style } : {}) }]
        })
      );
    },
    deleteElement: async (canvasId, elementId, expectedRevision) => {
      requirePermission('canvas.mutate-own');
      requireOwnedElement(canvasId, elementId);
      return json(
        store.applyOperations(canvasId, { expectedRevision, operations: [{ op: 'deleteElement', elementId }] })
      );
    }
  };
  return Object.freeze(operations);
}
