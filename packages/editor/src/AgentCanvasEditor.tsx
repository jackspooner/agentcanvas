import {
  Background,
  BackgroundVariant,
  NodeResizer,
  ReactFlow,
  ReactFlowProvider,
  SelectionMode,
  ViewportPortal,
  applyNodeChanges,
  type NodeChange,
  type NodeProps,
  type OnNodeDrag
} from '@xyflow/react';
import { Grip } from 'lucide-react';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  type AgentCanvasNode,
  type AgentCanvasNodeData,
  elementFrame,
  frameMap,
  nodeFrame,
  projectElement
} from './projection.js';
import type {
  AgentCanvasEditorProps,
  EditorElement,
  EditorFrame,
  EditorFrameChange,
  EditorRenderContext
} from './types.js';
import { flowViewportToWorld, worldViewportToFlow } from './viewport.js';

interface NodeRendererData<TElement extends EditorElement> extends AgentCanvasNodeData<TElement> {
  readOnly: boolean;
  renderElement(context: EditorRenderContext<TElement>): React.ReactNode;
  onResizeStart(elementId: string): void;
  onResizeEnd(elementId: string, frame: EditorFrame): void;
}

type RenderNode<TElement extends EditorElement> = AgentCanvasNode<TElement> & {
  data: NodeRendererData<TElement>;
};

const EMPTY_EDGES: [] = [];
const MULTI_SELECTION_KEYS = ['Meta', 'Control'];
const PRO_OPTIONS = { hideAttribution: true };

function EditorNode<TElement extends EditorElement>({
  id,
  data,
  selected,
  width,
  height
}: NodeProps<RenderNode<TElement>>) {
  const locked = data.element.locked === true;
  return (
    <div
      className={`agentcanvas-editor-node${selected ? ' is-selected' : ''}${locked ? ' is-locked' : ''}`}
      style={{
        width,
        height,
        transform: `rotate(${data.element.rotation ?? 0}deg)`,
        opacity: data.element.opacity ?? 1
      }}
      data-element-id={id}
    >
      <NodeResizer
        isVisible={selected && !data.readOnly && !locked}
        minWidth={24}
        minHeight={24}
        handleClassName="agentcanvas-editor-resize-handle"
        lineClassName="agentcanvas-editor-resize-line"
        onResizeStart={() => data.onResizeStart(id)}
        onResizeEnd={(_event, params) =>
          data.onResizeEnd(id, { x: params.x, y: params.y, width: params.width, height: params.height })
        }
      />
      <div className="agentcanvas-editor-node-content">{data.renderElement({ element: data.element, selected })}</div>
      {!data.readOnly && !locked && (
        <button type="button" className="agentcanvas-editor-drag-handle" aria-label={`Move ${id}`} title={`Move ${id}`}>
          <Grip aria-hidden="true" size={14} strokeWidth={2} />
        </button>
      )}
    </div>
  );
}

function changedFrames(
  before: ReadonlyMap<string, EditorFrame>,
  nodes: readonly AgentCanvasNode[]
): EditorFrameChange[] {
  const result: EditorFrameChange[] = [];
  for (const node of nodes) {
    const previous = before.get(node.id);
    if (!previous) continue;
    const next = nodeFrame(node);
    if (
      previous.x !== next.x ||
      previous.y !== next.y ||
      previous.width !== next.width ||
      previous.height !== next.height
    ) {
      result.push({ elementId: node.id, before: previous, after: next });
    }
  }
  return result;
}

function isEditableKeyboardEvent(event: React.KeyboardEvent): boolean {
  return event.nativeEvent.composedPath().some((entry) => {
    if (!(entry instanceof Element)) return false;
    return (
      entry.matches('input, textarea, select, [contenteditable="true"]') ||
      entry.hasAttribute('data-agentcanvas-interactive')
    );
  });
}

function EditorSurface<TElement extends EditorElement>({
  elements,
  bounds,
  viewport,
  selectedElementIds,
  readOnly = false,
  snapToGrid = true,
  gridSize = 10,
  backgroundColor = '#f8fafc',
  gridColor = '#cbd5e1',
  showGrid = true,
  className,
  worldUnderlay,
  worldOverlay,
  renderElement,
  onViewportChange,
  onSelectionChange,
  onTransientFramesChange,
  onFrameCommit,
  onCommitError
}: AgentCanvasEditorProps<TElement>) {
  const container = useRef<HTMLDivElement | null>(null);
  const gestureStart = useRef<ReadonlyMap<string, EditorFrame> | null>(null);
  const resizeStart = useRef<Map<string, EditorFrame>>(new Map());
  const renderElementRef = useRef(renderElement);
  const onFrameCommitRef = useRef(onFrameCommit);
  const onCommitErrorRef = useRef(onCommitError);
  const onViewportChangeRef = useRef(onViewportChange);
  const onSelectionChangeRef = useRef(onSelectionChange);
  const onTransientFramesChangeRef = useRef(onTransientFramesChange);
  const [size, setSize] = useState({ width: 1, height: 1 });
  const [nodes, setNodes] = useState<AgentCanvasNode<TElement>[]>(() =>
    elements.map((element) => projectElement(element))
  );
  const nodesRef = useRef<AgentCanvasNode<TElement>[]>(nodes);
  const selectedElementIdsRef = useRef(selectedElementIds);
  renderElementRef.current = renderElement;
  onFrameCommitRef.current = onFrameCommit;
  onCommitErrorRef.current = onCommitError;
  onViewportChangeRef.current = onViewportChange;
  onSelectionChangeRef.current = onSelectionChange;
  onTransientFramesChangeRef.current = onTransientFramesChange;
  selectedElementIdsRef.current = selectedElementIds;

  useEffect(() => {
    nodesRef.current = nodes;
    onTransientFramesChangeRef.current?.(frameMap(nodes));
  }, [nodes]);

  useEffect(() => {
    const selection = new Set(
      selectedElementIdsRef.current ?? nodesRef.current.filter((node) => node.selected).map((node) => node.id)
    );
    setNodes(elements.map((element) => projectElement(element, selection.has(element.id))));
  }, [elements]);

  useEffect(() => {
    if (!selectedElementIds) return;
    const selection = new Set(selectedElementIds);
    setNodes((current) =>
      current.map((node) => {
        const selected = selection.has(node.id);
        return node.selected === selected ? node : { ...node, selected };
      })
    );
  }, [selectedElementIds]);

  useEffect(() => {
    if (!container.current) return undefined;
    const update = () => {
      const rect = container.current?.getBoundingClientRect();
      if (rect && rect.width > 0 && rect.height > 0) setSize({ width: rect.width, height: rect.height });
    };
    update();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(update);
    observer.observe(container.current);
    return () => observer.disconnect();
  }, []);

  const nodeTypes = useMemo(
    () => ({
      'agentcanvas-element': EditorNode as React.ComponentType<NodeProps<RenderNode<TElement>>>
    }),
    []
  );

  const commitFrameChanges = useCallback((changes: readonly EditorFrameChange[]) => {
    if (changes.length === 0 || !onFrameCommitRef.current) return;
    void Promise.resolve(onFrameCommitRef.current(changes)).catch((error) => {
      const previous = new Map(changes.map((change) => [change.elementId, change.before]));
      setNodes((current) =>
        current.map((candidate) => {
          const frame = previous.get(candidate.id);
          return frame
            ? {
                ...candidate,
                position: { x: frame.x, y: frame.y },
                width: frame.width,
                height: frame.height
              }
            : candidate;
        })
      );
      onCommitErrorRef.current?.(error);
    });
  }, []);

  const renderNodes = useMemo<RenderNode<TElement>[]>(
    () =>
      nodes.map((node) => ({
        ...node,
        data: {
          ...node.data,
          readOnly,
          renderElement: (context: EditorRenderContext<TElement>) => renderElementRef.current(context),
          onResizeStart(elementId) {
            const current = nodesRef.current.find((candidate) => candidate.id === elementId);
            if (current) resizeStart.current.set(elementId, nodeFrame(current));
          },
          onResizeEnd(elementId, frame) {
            const before = resizeStart.current.get(elementId);
            resizeStart.current.delete(elementId);
            if (!before) return;
            const after = {
              x: Math.round(frame.x),
              y: Math.round(frame.y),
              width: Math.round(frame.width),
              height: Math.round(frame.height)
            };
            setNodes((current) =>
              current.map((candidate) =>
                candidate.id === elementId
                  ? {
                      ...candidate,
                      position: { x: after.x, y: after.y },
                      width: after.width,
                      height: after.height
                    }
                  : candidate
              )
            );
            if (
              before.x !== after.x ||
              before.y !== after.y ||
              before.width !== after.width ||
              before.height !== after.height
            ) {
              commitFrameChanges([{ elementId, before, after }]);
            }
          }
        }
      })),
    [commitFrameChanges, nodes, readOnly]
  );

  const onNodesChange = useCallback((changes: NodeChange<AgentCanvasNode<TElement>>[]) => {
    const allowed = changes.filter((change) => change.type !== 'remove');
    setNodes((current) => applyNodeChanges(allowed, current));
  }, []);

  const onNodeDragStart: OnNodeDrag<AgentCanvasNode<TElement>> = useCallback((_event, _node, draggedNodes) => {
    gestureStart.current = frameMap(draggedNodes);
  }, []);

  const onNodeDragStop: OnNodeDrag<AgentCanvasNode<TElement>> = useCallback(
    (_event, _node, draggedNodes) => {
      const before = gestureStart.current;
      gestureStart.current = null;
      if (!before) return;
      const changes = changedFrames(before, draggedNodes);
      commitFrameChanges(changes);
    },
    [commitFrameChanges]
  );
  const handleViewportMove = useCallback(
    (event: MouseEvent | TouchEvent | null, next: { x: number; y: number; zoom: number }) => {
      if (event) onViewportChangeRef.current(flowViewportToWorld(next, size));
    },
    [size]
  );
  const handleSelectionChange = useCallback(({ nodes: selected }: { nodes: RenderNode<TElement>[] }) => {
    onSelectionChangeRef.current?.(selected.map((node) => node.id));
  }, []);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (readOnly || isEditableKeyboardEvent(event) || !event.key.startsWith('Arrow')) return;
      const selected = nodesRef.current.filter((node) => node.selected && !node.data.element.locked);
      if (selected.length === 0) return;
      event.preventDefault();
      event.stopPropagation();
      const step = event.shiftKey ? 10 : 1;
      const delta = {
        x: event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0,
        y: event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0
      };
      const before = frameMap(selected);
      const selectedIds = new Set(selected.map((node) => node.id));
      const nextNodes = nodesRef.current.map((node) =>
        selectedIds.has(node.id)
          ? { ...node, position: { x: node.position.x + delta.x, y: node.position.y + delta.y } }
          : node
      );
      setNodes(nextNodes);
      commitFrameChanges(
        changedFrames(
          before,
          nextNodes.filter((node) => selectedIds.has(node.id))
        )
      );
    },
    [commitFrameChanges, readOnly]
  );

  const fixedExtent = useMemo(
    () =>
      bounds.mode === 'fixed'
        ? ([
            [0, 0],
            [bounds.width, bounds.height]
          ] as [[number, number], [number, number]])
        : undefined,
    [bounds]
  );
  const snapGrid = useMemo<[number, number]>(() => [gridSize, gridSize], [gridSize]);
  const flowViewport = useMemo(
    () => worldViewportToFlow(viewport, size),
    [size, viewport.centerX, viewport.centerY, viewport.zoom]
  );

  return (
    <div
      ref={container}
      className={`agentcanvas-editor${className ? ` ${className}` : ''}`}
      style={{ background: backgroundColor }}
      // biome-ignore lint/a11y/noNoninteractiveTabindex: The editor must receive focus for arrow-key movement and canvas shortcuts.
      tabIndex={0}
      aria-label="Canvas editor"
      onKeyDownCapture={handleKeyDown}
    >
      <ReactFlow<RenderNode<TElement>>
        nodes={renderNodes}
        edges={EMPTY_EDGES}
        nodeTypes={nodeTypes}
        viewport={flowViewport}
        onMove={handleViewportMove}
        onNodesChange={onNodesChange}
        onNodeDragStart={onNodeDragStart as OnNodeDrag<RenderNode<TElement>>}
        onNodeDragStop={onNodeDragStop as OnNodeDrag<RenderNode<TElement>>}
        onSelectionChange={handleSelectionChange}
        nodeExtent={fixedExtent}
        translateExtent={fixedExtent}
        minZoom={0.05}
        maxZoom={8}
        snapToGrid={snapToGrid}
        snapGrid={snapGrid}
        selectionMode={SelectionMode.Partial}
        selectionOnDrag={false}
        panOnDrag
        panActivationKeyCode="Space"
        selectionKeyCode="Shift"
        multiSelectionKeyCode={MULTI_SELECTION_KEYS}
        deleteKeyCode={null}
        nodesDraggable={!readOnly}
        elementsSelectable
        nodesConnectable={false}
        zoomOnDoubleClick={false}
        noDragClassName="agentcanvas-editor-no-drag"
        noPanClassName="agentcanvas-editor-no-pan"
        noWheelClassName="agentcanvas-editor-no-wheel"
        disableKeyboardA11y
        onlyRenderVisibleElements={elements.length >= 500}
        proOptions={PRO_OPTIONS}
      >
        {showGrid && <Background variant={BackgroundVariant.Dots} gap={gridSize} size={1} color={gridColor} />}
        <ViewportPortal>
          {bounds.mode === 'fixed' && (
            <div
              className="agentcanvas-editor-fixed-board"
              style={{ width: bounds.width, height: bounds.height, background: backgroundColor }}
              aria-hidden="true"
            />
          )}
          <div className="agentcanvas-editor-world-underlay">{worldUnderlay}</div>
          <div className="agentcanvas-editor-world-overlay">{worldOverlay}</div>
        </ViewportPortal>
      </ReactFlow>
    </div>
  );
}

export function AgentCanvasEditor<TElement extends EditorElement>(props: AgentCanvasEditorProps<TElement>) {
  return (
    <ReactFlowProvider>
      <EditorSurface {...props} />
    </ReactFlowProvider>
  );
}

export { changedFrames };
