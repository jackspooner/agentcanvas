import type { Node } from '@xyflow/react';
import type { EditorElement, EditorFrame } from './types.js';
import { resolveElementFrame } from '@agentcanvas/plugin-sdk';
export { DEFAULT_ELEMENT_WIDTH, DEFAULT_ELEMENT_HEIGHT } from '@agentcanvas/plugin-sdk';

export interface AgentCanvasNodeData<TElement extends EditorElement> extends Record<string, unknown> {
  element: TElement;
}

export type AgentCanvasNode<TElement extends EditorElement = EditorElement> = Node<
  AgentCanvasNodeData<TElement>,
  'agentcanvas-element'
>;

export const elementFrame = resolveElementFrame;

export function projectElement<TElement extends EditorElement>(
  element: TElement,
  selected = false
): AgentCanvasNode<TElement> {
  const frame = elementFrame(element);
  return {
    id: element.id,
    type: 'agentcanvas-element',
    position: { x: frame.x, y: frame.y },
    width: frame.width,
    height: frame.height,
    initialWidth: frame.width,
    initialHeight: frame.height,
    selected,
    draggable: !element.locked,
    selectable: true,
    deletable: false,
    connectable: false,
    dragHandle: '.agentcanvas-editor-drag-handle',
    zIndex: element.zIndex ?? 0,
    ariaLabel: element.id,
    data: { element }
  };
}

export function nodeFrame(node: AgentCanvasNode): EditorFrame {
  return resolveElementFrame({
    x: node.position.x,
    y: node.position.y,
    width: node.width ?? node.measured?.width,
    height: node.height ?? node.measured?.height
  });
}

export function frameMap(nodes: readonly AgentCanvasNode[]): ReadonlyMap<string, EditorFrame> {
  return new Map(nodes.map((node) => [node.id, nodeFrame(node)]));
}
