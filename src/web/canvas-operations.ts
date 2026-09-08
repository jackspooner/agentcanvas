import type { EditorFrameChange } from '@agentcanvas/editor';
import type { BrowserOwnCanvasOperation, CanvasElement } from '@agentcanvas/plugin-sdk';
import type { CanvasOperation } from '../contracts';
import { cloneElement } from './canvas-clipboard';
import type { CanvasDocument } from './v2-types';
export function frameOperations(changes: readonly EditorFrameChange[]): {
  forward: CanvasOperation[];
  inverse: CanvasOperation[];
} {
  const forward: CanvasOperation[] = [];
  const inverse: CanvasOperation[] = [];
  for (const change of changes) {
    const next: Record<string, number> = {};
    const previous: Record<string, number> = {};
    for (const field of ['x', 'y', 'width', 'height'] as const) {
      if (change.before[field] !== change.after[field]) {
        next[field] = change.after[field];
        previous[field] = change.before[field];
      }
    }
    if (Object.keys(next).length === 0) continue;
    forward.push({ op: 'patchElementFrame', elementId: change.elementId, frame: next });
    inverse.push({ op: 'patchElementFrame', elementId: change.elementId, frame: previous });
  }
  return { forward, inverse };
}

export function extensionOperations(
  canvas: Pick<CanvasDocument, 'elements'>,
  pluginId: string,
  operations: readonly BrowserOwnCanvasOperation[]
) {
  const currentElements = new Map(canvas.elements.map((element) => [element.id, element]));
  const forward: CanvasOperation[] = [];
  const inverse: CanvasOperation[] = [];
  const affected: string[] = [];
  const requireOwned = (elementId: string): CanvasElement => {
    const element = currentElements.get(elementId);
    if (!element) throw new Error(`Element not found: ${elementId}`);
    if (!element.type.startsWith(`${pluginId}/`)) {
      throw new Error(`${pluginId} cannot mutate an element owned by ${element.type}`);
    }
    if (element.locked) throw new Error(`Element is locked: ${elementId}`);
    return element;
  };
  for (const operation of operations) {
    if (operation.op === 'upsertElement') {
      if (!operation.element.type.startsWith(`${pluginId}/`)) {
        throw new Error(`${pluginId} cannot upsert ${operation.element.type}`);
      }
      const previous = currentElements.get(operation.element.id);
      if (previous && !previous.type.startsWith(`${pluginId}/`)) {
        throw new Error(`${pluginId} cannot replace an element owned by ${previous.type}`);
      }
      if (previous?.locked) throw new Error(`Element is locked: ${previous.id}`);
      forward.push(operation);
      inverse.unshift(
        previous
          ? { op: 'upsertElement', element: cloneElement(previous) }
          : { op: 'deleteElement', elementId: operation.element.id }
      );
      currentElements.set(operation.element.id, operation.element);
      affected.push(operation.element.id);
    } else if (operation.op === 'replaceElementData') {
      const previous = requireOwned(operation.elementId);
      forward.push(operation);
      inverse.unshift({
        op: 'replaceElementData',
        elementId: previous.id,
        data: previous.data,
        style: previous.style ?? null
      });
      currentElements.set(previous.id, {
        ...previous,
        data: operation.data,
        ...(operation.style !== undefined ? { style: operation.style } : {})
      });
      affected.push(previous.id);
    } else {
      const previous = requireOwned(operation.elementId);
      forward.push(operation);
      inverse.unshift({ op: 'upsertElement', element: cloneElement(previous) });
      currentElements.delete(previous.id);
      affected.push(previous.id);
    }
  }
  return { forward, inverse, affected };
}
