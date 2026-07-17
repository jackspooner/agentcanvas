import {
  AgentCanvasEditor,
  CORE_EDITOR_COMMANDS,
  EditorCommandService,
  EditorHistory,
  EditorToolbar,
  EditorViewportToolbar,
  type EditorFrame,
  type EditorFrameChange
} from '@agentcanvas/editor';
import type {
  BrowserElementRenderer,
  BrowserCommandContext,
  BrowserOwnCanvasOperation,
  CanvasElement,
  JsonObject,
  PluginDiagnostic,
  RendererGeometryService
} from '@agentcanvas/plugin-sdk';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { nanoid } from 'nanoid';
import type { CanvasOperation } from '../../contracts';
import type { LoadedBrowserRegistry } from '../plugins/catalog';
import { isPluginInteractiveEvent } from '../plugins/interaction';
import { DomRendererOverlayService } from '../plugins/overlays';
import { ShadowRendererHost, type RendererContextInput } from '../plugins/renderer-host';
import type { CanvasBounds, CanvasDocument, CanvasViewport, CanvasViewportState } from '../v2-types';
import { coerceViewport, DEFAULT_REPORTED_VIEWPORT_HEIGHT, DEFAULT_REPORTED_VIEWPORT_WIDTH } from '../viewport';
import { CanvasBoundsControl } from './CanvasBoundsControl';

interface CanvasViewProps {
  canvas: CanvasDocument;
  elementRuntime: Readonly<Record<string, JsonObject>>;
  diagnostics: readonly PluginDiagnostic[];
  browserRegistry: LoadedBrowserRegistry;
  readOnly?: boolean;
  initialViewport?: CanvasViewport;
  loadViewport?: () => Promise<CanvasViewportState>;
  onViewportChange?: (viewport: CanvasViewport) => void;
  onCanvasOperations?: (operations: readonly CanvasOperation[], expectedRevision: number) => Promise<CanvasDocument>;
  onCanvasBoundsChange?: (bounds: CanvasBounds) => Promise<void> | void;
}

interface PluginRendererSurfaceProps {
  element: CanvasElement;
  runtime: JsonObject | null;
  renderer: BrowserElementRenderer | undefined;
  geometry: RendererGeometryService;
  overlays: DomRendererOverlayService;
  readOnly: boolean;
  selected: boolean;
  reportDiagnostic(diagnostic: PluginDiagnostic): void;
}

const THEME = Object.freeze({
  '--agentcanvas-foreground': '#0f172a',
  '--agentcanvas-background': '#ffffff',
  '--agentcanvas-border': '#cbd5e1',
  '--agentcanvas-accent': '#2563eb'
});

function PluginRendererSurface(props: PluginRendererSurfaceProps) {
  const outer = useRef<HTMLDivElement | null>(null);
  const host = useRef<ShadowRendererHost | null>(null);
  const context: RendererContextInput = useMemo(
    () => ({
      element: props.element,
      runtime: props.runtime,
      readOnly: props.readOnly,
      selected: props.selected,
      theme: THEME,
      geometry: props.geometry,
      overlays: props.overlays,
      reportDiagnostic: props.reportDiagnostic
    }),
    [
      props.element,
      props.geometry,
      props.overlays,
      props.readOnly,
      props.reportDiagnostic,
      props.runtime,
      props.selected
    ]
  );

  useEffect(() => {
    if (!outer.current) return undefined;
    const rendererHost = new ShadowRendererHost(outer.current, { reportDiagnostic: props.reportDiagnostic });
    host.current = rendererHost;
    void rendererHost.mount(props.renderer, context);
    return () => {
      host.current = null;
      void rendererHost.dispose();
    };
  }, [props.element.id, props.element.type, props.renderer]);

  useEffect(() => {
    void host.current?.update(context);
  }, [context]);

  return (
    <div
      ref={outer}
      className="plugin-renderer-surface"
      onPointerDownCapture={(event) => {
        if (isPluginInteractiveEvent(event.nativeEvent)) event.stopPropagation();
      }}
      onWheelCapture={(event) => {
        if (isPluginInteractiveEvent(event.nativeEvent)) event.stopPropagation();
      }}
    />
  );
}

function reportedViewport(viewport: CanvasViewport): CanvasViewport {
  return {
    ...viewport,
    width: DEFAULT_REPORTED_VIEWPORT_WIDTH,
    height: DEFAULT_REPORTED_VIEWPORT_HEIGHT,
    source: 'user',
    updatedAt: viewport.updatedAt ?? new Date().toISOString()
  };
}

function sameSelection(current: readonly string[], next: readonly string[]): boolean {
  return current.length === next.length && current.every((id, index) => id === next[index]);
}

function sameFrames(current: ReadonlyMap<string, EditorFrame>, next: ReadonlyMap<string, EditorFrame>): boolean {
  if (current.size !== next.size) return false;
  for (const [id, frame] of current) {
    const candidate = next.get(id);
    if (
      !candidate ||
      frame.x !== candidate.x ||
      frame.y !== candidate.y ||
      frame.width !== candidate.width ||
      frame.height !== candidate.height
    ) {
      return false;
    }
  }
  return true;
}

interface CanvasClipboardPayload {
  format: 'agentcanvas.elements/v1';
  elements: CanvasElement[];
}

function cloneElement(element: CanvasElement): CanvasElement {
  return JSON.parse(JSON.stringify(element)) as CanvasElement;
}

function parseClipboardPayload(value: string): CanvasClipboardPayload | null {
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    if (parsed.format !== 'agentcanvas.elements/v1' || !Array.isArray(parsed.elements)) return null;
    const elements = parsed.elements.filter((candidate): candidate is CanvasElement => {
      if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return false;
      const element = candidate as Record<string, unknown>;
      return (
        typeof element.id === 'string' &&
        typeof element.type === 'string' &&
        Number.isSafeInteger(element.schemaVersion) &&
        typeof element.x === 'number' &&
        Number.isFinite(element.x) &&
        typeof element.y === 'number' &&
        Number.isFinite(element.y) &&
        Boolean(element.data && typeof element.data === 'object' && !Array.isArray(element.data))
      );
    });
    if (elements.length !== parsed.elements.length) return null;
    return { format: 'agentcanvas.elements/v1', elements: elements.map(cloneElement) };
  } catch {
    return null;
  }
}

function isEditableCommandEvent(event: React.KeyboardEvent): boolean {
  return event.nativeEvent.composedPath().some((entry) => {
    if (!(entry instanceof Element)) return false;
    return (
      entry.matches('input, textarea, select, [contenteditable="true"]') ||
      entry.hasAttribute('data-agentcanvas-interactive')
    );
  });
}

function frameOperations(changes: readonly EditorFrameChange[]): {
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

export function CanvasView({
  canvas,
  elementRuntime,
  diagnostics,
  browserRegistry,
  readOnly = false,
  initialViewport,
  loadViewport,
  onViewportChange,
  onCanvasOperations,
  onCanvasBoundsChange
}: CanvasViewProps) {
  const [viewport, setViewport] = useState(() => coerceViewport(initialViewport));
  const [selectedIds, setSelectedIds] = useState<readonly string[]>([]);
  const [gridSnapEnabled, setGridSnapEnabled] = useState(true);
  const [transientFrames, setTransientFrames] = useState<ReadonlyMap<string, EditorFrame>>(() => new Map());
  const [runtimeDiagnostics, setRuntimeDiagnostics] = useState<PluginDiagnostic[]>([]);
  const [moveError, setMoveError] = useState<string | null>(null);
  const [viewportError, setViewportError] = useState<string | null>(null);
  const [, setHistoryVersion] = useState(0);
  const viewportNode = useRef<HTMLDivElement | null>(null);
  const lastAgentViewport = useRef<string | null>(null);
  const lastLocalRevision = useRef<number | null>(null);
  const pendingLocalMutations = useRef(0);
  const confirmedCanvas = useRef(canvas);
  const mutationQueue = useRef<Promise<void>>(Promise.resolve());
  const clipboardElements = useRef<CanvasElement[]>([]);
  const history = useRef(new EditorHistory<CanvasOperation>(100));
  const commands = useMemo(() => new EditorCommandService(), []);
  const commandState = useRef({
    canvas,
    selectedIds,
    readOnly,
    viewport,
    nodeElementIds: [] as string[]
  });
  const commandActions = useRef<Record<string, () => Promise<void> | void>>({});
  const extensionTransact = useRef<
    (pluginId: string, label: string, operations: readonly BrowserOwnCanvasOperation[]) => Promise<void>
  >(async () => undefined);
  const extensionAbort = useRef(new AbortController());
  const overlays = useMemo(() => new DomRendererOverlayService(), []);
  const elements = useMemo(() => new Map(canvas.elements.map((element) => [element.id, element])), [canvas.elements]);
  const geometry: RendererGeometryService = useMemo(
    () => ({
      getElementFrame(elementId) {
        const transient = transientFrames.get(elementId);
        if (transient) return transient;
        const element = elements.get(elementId);
        if (!element) return null;
        return {
          x: element.x,
          y: element.y,
          width: element.width ?? 240,
          height: element.height ?? 120
        };
      },
      resolveAnchor(elementId, anchor) {
        const frame = this.getElementFrame(elementId);
        if (!frame) return null;
        if (anchor === 'top') return { x: frame.x + frame.width / 2, y: frame.y };
        if (anchor === 'right') return { x: frame.x + frame.width, y: frame.y + frame.height / 2 };
        if (anchor === 'bottom') return { x: frame.x + frame.width / 2, y: frame.y + frame.height };
        if (anchor === 'left') return { x: frame.x, y: frame.y + frame.height / 2 };
        return { x: frame.x + frame.width / 2, y: frame.y + frame.height / 2 };
      }
    }),
    [elements, transientFrames]
  );
  const fixedBounds = canvas.bounds.mode === 'fixed' ? canvas.bounds : null;

  const reportDiagnostic = useCallback((diagnostic: PluginDiagnostic) => {
    setRuntimeDiagnostics((current) => [
      ...current.filter((item) => item.elementId !== diagnostic.elementId || item.code !== diagnostic.code),
      diagnostic
    ]);
  }, []);
  const rendererFor = useCallback(
    (element: CanvasElement) => browserRegistry.renderers.get(element.type),
    [browserRegistry.renderers]
  );
  const nodeElements = useMemo(
    () => canvas.elements.filter((element) => (rendererFor(element)?.placement ?? 'node') === 'node'),
    [canvas.elements, rendererFor]
  );
  const worldUnderlays = useMemo(
    () => canvas.elements.filter((element) => rendererFor(element)?.placement === 'world-underlay'),
    [canvas.elements, rendererFor]
  );
  const worldOverlays = useMemo(
    () => canvas.elements.filter((element) => rendererFor(element)?.placement === 'world-overlay'),
    [canvas.elements, rendererFor]
  );
  commandState.current = {
    canvas,
    selectedIds,
    readOnly,
    viewport,
    nodeElementIds: nodeElements.map((element) => element.id)
  };

  const refreshCommandState = useCallback(() => {
    setHistoryVersion((value) => value + 1);
    commands.notify();
  }, [commands]);

  const runCanvasOperations = useCallback(
    async (operations: readonly CanvasOperation[]): Promise<CanvasDocument> => {
      if (!onCanvasOperations) throw new Error('Canvas mutations are unavailable.');
      let result: CanvasDocument | null = null;
      const task = mutationQueue.current.then(async () => {
        pendingLocalMutations.current += 1;
        try {
          result = await onCanvasOperations(operations, confirmedCanvas.current.revision);
          confirmedCanvas.current = result;
          lastLocalRevision.current = result.revision;
        } finally {
          pendingLocalMutations.current -= 1;
        }
      });
      mutationQueue.current = task.catch(() => undefined);
      await task;
      if (!result) throw new Error('Canvas mutation did not return a document.');
      return result;
    },
    [onCanvasOperations]
  );

  const commitHistory = useCallback(
    async (
      label: string,
      forward: readonly CanvasOperation[],
      inverse: readonly CanvasOperation[],
      affectedElementIds: readonly string[]
    ) => {
      if (forward.length === 0) return;
      await runCanvasOperations(forward);
      history.current.record({
        label,
        forward,
        inverse,
        affectedElementIds,
        timestamp: Date.now()
      });
      refreshCommandState();
    },
    [refreshCommandState, runCanvasOperations]
  );

  useEffect(() => setViewport(coerceViewport(initialViewport)), [canvas.id, initialViewport]);
  useEffect(() => {
    const previous = extensionAbort.current;
    extensionAbort.current = new AbortController();
    previous.abort();
    return () => extensionAbort.current.abort();
  }, [canvas.id]);
  useEffect(() => {
    if (confirmedCanvas.current.id !== canvas.id) {
      confirmedCanvas.current = canvas;
      lastLocalRevision.current = null;
      history.current.clear();
      setSelectedIds([]);
      refreshCommandState();
      return;
    }
    if (confirmedCanvas.current.revision !== canvas.revision) {
      const external = pendingLocalMutations.current === 0 && lastLocalRevision.current !== canvas.revision;
      confirmedCanvas.current = canvas;
      if (external) {
        history.current.clear();
        refreshCommandState();
      }
    }
  }, [canvas, refreshCommandState]);
  useEffect(() => {
    if (!onViewportChange || canvas.id === 'empty') return undefined;
    const timer = window.setTimeout(() => onViewportChange(reportedViewport(viewport)), 250);
    return () => window.clearTimeout(timer);
  }, [canvas.id, onViewportChange, viewport]);
  useEffect(() => {
    if (!loadViewport || canvas.id === 'empty') return undefined;
    const timer = window.setInterval(() => {
      void loadViewport()
        .then((state) => {
          const agent = state.agentViewport;
          if (agent?.updatedAt && agent.updatedAt !== lastAgentViewport.current) {
            lastAgentViewport.current = agent.updatedAt;
            setViewport(coerceViewport(agent));
          }
        })
        .catch((error) => {
          setViewportError(`Viewport polling failed: ${error instanceof Error ? error.message : String(error)}`);
        });
    }, 1_000);
    return () => window.clearInterval(timer);
  }, [canvas.id, loadViewport]);

  function selectedElements(): CanvasElement[] {
    const selected = new Set(commandState.current.selectedIds);
    return commandState.current.canvas.elements.filter((element) => selected.has(element.id));
  }

  async function deleteSelection() {
    const elementsToDelete = selectedElements().filter((element) => !element.locked);
    if (elementsToDelete.length === 0) return;
    await commitHistory(
      `Delete ${elementsToDelete.length === 1 ? 'element' : `${elementsToDelete.length} elements`}`,
      elementsToDelete.map((element) => ({ op: 'deleteElement' as const, elementId: element.id })),
      elementsToDelete.map((element) => ({ op: 'upsertElement' as const, element: cloneElement(element) })),
      elementsToDelete.map((element) => element.id)
    );
    setSelectedIds([]);
  }

  async function duplicateSelection() {
    const source = selectedElements().filter((element) => !element.locked);
    if (source.length === 0) return;
    const copies = source.map((element) => ({
      ...cloneElement(element),
      id: `el_${nanoid(12)}`,
      x: element.x + 20,
      y: element.y + 20
    }));
    await commitHistory(
      `Duplicate ${source.length === 1 ? 'element' : `${source.length} elements`}`,
      copies.map((element) => ({ op: 'upsertElement' as const, element })),
      copies.map((element) => ({ op: 'deleteElement' as const, elementId: element.id })),
      copies.map((element) => element.id)
    );
    setSelectedIds(copies.map((element) => element.id));
  }

  async function copySelection() {
    const copied = selectedElements().map(cloneElement);
    if (copied.length === 0) return;
    clipboardElements.current = copied;
    const payload: CanvasClipboardPayload = { format: 'agentcanvas.elements/v1', elements: copied };
    await navigator.clipboard?.writeText(JSON.stringify(payload)).catch(() => undefined);
  }

  async function pasteSelection() {
    let copied = clipboardElements.current.map(cloneElement);
    const clipboardText = await navigator.clipboard?.readText().catch(() => '');
    if (clipboardText) {
      const payload = parseClipboardPayload(clipboardText);
      if (payload) copied = payload.elements;
    }
    if (copied.length === 0) return;
    const pasted = copied.map((element) => ({
      ...cloneElement(element),
      id: `el_${nanoid(12)}`,
      x: element.x + 20,
      y: element.y + 20
    }));
    await commitHistory(
      `Paste ${pasted.length === 1 ? 'element' : `${pasted.length} elements`}`,
      pasted.map((element) => ({ op: 'upsertElement' as const, element })),
      pasted.map((element) => ({ op: 'deleteElement' as const, elementId: element.id })),
      pasted.map((element) => element.id)
    );
    setSelectedIds(pasted.map((element) => element.id));
  }

  async function undo() {
    const entry = history.current.peekUndo();
    if (!entry) return;
    const next = await runCanvasOperations(entry.inverse);
    history.current.confirmUndo(entry);
    setSelectedIds(entry.affectedElementIds.filter((id) => next.elements.some((element) => element.id === id)));
    refreshCommandState();
  }

  async function redo() {
    const entry = history.current.peekRedo();
    if (!entry) return;
    const next = await runCanvasOperations(entry.forward);
    history.current.confirmRedo(entry);
    setSelectedIds(entry.affectedElementIds.filter((id) => next.elements.some((element) => element.id === id)));
    refreshCommandState();
  }

  function selectAll() {
    setSelectedIds(commandState.current.nodeElementIds);
  }

  function zoomBy(factor: number) {
    setViewport((value) => coerceViewport({ ...value, zoom: value.zoom * factor }));
  }

  function resetViewport() {
    setViewport((value) => coerceViewport({ ...value, centerX: 0, centerY: 0, zoom: 1 }));
  }

  function fitCanvas() {
    const width = viewportNode.current?.clientWidth || DEFAULT_REPORTED_VIEWPORT_WIDTH;
    const height = viewportNode.current?.clientHeight || DEFAULT_REPORTED_VIEWPORT_HEIGHT;
    if (fixedBounds) {
      setViewport((current) =>
        coerceViewport({
          ...current,
          centerX: fixedBounds.width / 2,
          centerY: fixedBounds.height / 2,
          zoom: Math.min(width / fixedBounds.width, height / fixedBounds.height) * 0.9
        })
      );
      return;
    }
    if (nodeElements.length === 0) {
      resetViewport();
      return;
    }
    const frames = nodeElements.map((element) => ({
      x: element.x,
      y: element.y,
      width: element.width ?? 240,
      height: element.height ?? 120
    }));
    const left = Math.min(...frames.map((frame) => frame.x));
    const top = Math.min(...frames.map((frame) => frame.y));
    const right = Math.max(...frames.map((frame) => frame.x + frame.width));
    const bottom = Math.max(...frames.map((frame) => frame.y + frame.height));
    const contentWidth = Math.max(1, right - left);
    const contentHeight = Math.max(1, bottom - top);
    setViewport((current) =>
      coerceViewport({
        ...current,
        centerX: left + contentWidth / 2,
        centerY: top + contentHeight / 2,
        zoom: Math.min(width / contentWidth, height / contentHeight) * 0.85
      })
    );
  }

  async function transactExtensionOperations(
    pluginId: string,
    label: string,
    operations: readonly BrowserOwnCanvasOperation[]
  ) {
    if (commandState.current.readOnly) throw new Error('The canvas is read-only.');
    const currentElements = new Map(confirmedCanvas.current.elements.map((element) => [element.id, element]));
    const forward: CanvasOperation[] = [];
    const inverse: CanvasOperation[] = [];
    const affected: string[] = [];
    const requireOwned = (elementId: string): CanvasElement => {
      const element = currentElements.get(elementId);
      if (!element) throw new Error(`Element not found: ${elementId}`);
      if (!element.type.startsWith(`${pluginId}/`)) {
        throw new Error(`${pluginId} cannot mutate an element owned by ${element.type}`);
      }
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
    await commitHistory(label, forward, inverse, affected);
  }
  extensionTransact.current = transactExtensionOperations;

  commandActions.current = {
    [CORE_EDITOR_COMMANDS.undo]: undo,
    [CORE_EDITOR_COMMANDS.redo]: redo,
    [CORE_EDITOR_COMMANDS.copy]: copySelection,
    [CORE_EDITOR_COMMANDS.paste]: pasteSelection,
    [CORE_EDITOR_COMMANDS.duplicate]: duplicateSelection,
    [CORE_EDITOR_COMMANDS.delete]: deleteSelection,
    [CORE_EDITOR_COMMANDS.selectAll]: selectAll,
    [CORE_EDITOR_COMMANDS.zoomIn]: () => zoomBy(1.2),
    [CORE_EDITOR_COMMANDS.zoomOut]: () => zoomBy(1 / 1.2),
    [CORE_EDITOR_COMMANDS.zoomReset]: resetViewport,
    [CORE_EDITOR_COMMANDS.zoomFit]: fitCanvas,
    [CORE_EDITOR_COMMANDS.toggleGridSnap]: () => setGridSnapEnabled((value) => !value)
  };

  function browserCommandContext(pluginId: string): BrowserCommandContext {
    const state = commandState.current;
    const selection = state.canvas.elements.filter((element) => state.selectedIds.includes(element.id));
    return {
      pluginId,
      readOnly: state.readOnly,
      selection,
      viewport: state.viewport,
      signal: extensionAbort.current.signal,
      overlays,
      executeCommand: (commandId) => commands.execute(commandId),
      reveal: (rect) => {
        const width = viewportNode.current?.clientWidth || DEFAULT_REPORTED_VIEWPORT_WIDTH;
        const height = viewportNode.current?.clientHeight || DEFAULT_REPORTED_VIEWPORT_HEIGHT;
        setViewport((current) =>
          coerceViewport({
            ...current,
            centerX: rect.x + rect.width / 2,
            centerY: rect.y + rect.height / 2,
            zoom: Math.min(width / Math.max(1, rect.width), height / Math.max(1, rect.height)) * 0.85
          })
        );
      },
      transact: (label, operations) => extensionTransact.current(pluginId, label, operations),
      reportDiagnostic
    };
  }

  useEffect(() => {
    const hasSelection = () => commandState.current.selectedIds.length > 0;
    const hasMutableSelection = () => selectedElements().some((element) => !element.locked);
    const registrations = [
      commands.register({
        id: CORE_EDITOR_COMMANDS.undo,
        title: 'Undo',
        execute: () => commandActions.current[CORE_EDITOR_COMMANDS.undo]?.(),
        isEnabled: () => !commandState.current.readOnly && history.current.canUndo
      }),
      commands.register({
        id: CORE_EDITOR_COMMANDS.redo,
        title: 'Redo',
        execute: () => commandActions.current[CORE_EDITOR_COMMANDS.redo]?.(),
        isEnabled: () => !commandState.current.readOnly && history.current.canRedo
      }),
      commands.register({
        id: CORE_EDITOR_COMMANDS.copy,
        title: 'Copy',
        execute: () => commandActions.current[CORE_EDITOR_COMMANDS.copy]?.(),
        isEnabled: hasSelection
      }),
      commands.register({
        id: CORE_EDITOR_COMMANDS.paste,
        title: 'Paste',
        execute: () => commandActions.current[CORE_EDITOR_COMMANDS.paste]?.(),
        isEnabled: () => !commandState.current.readOnly
      }),
      commands.register({
        id: CORE_EDITOR_COMMANDS.duplicate,
        title: 'Duplicate',
        execute: () => commandActions.current[CORE_EDITOR_COMMANDS.duplicate]?.(),
        isEnabled: () => !commandState.current.readOnly && hasMutableSelection()
      }),
      commands.register({
        id: CORE_EDITOR_COMMANDS.delete,
        title: 'Delete',
        execute: () => commandActions.current[CORE_EDITOR_COMMANDS.delete]?.(),
        isEnabled: () => !commandState.current.readOnly && hasMutableSelection()
      }),
      commands.register({
        id: CORE_EDITOR_COMMANDS.selectAll,
        title: 'Select all',
        execute: () => commandActions.current[CORE_EDITOR_COMMANDS.selectAll]?.(),
        isEnabled: () => commandState.current.nodeElementIds.length > 0
      }),
      commands.register({
        id: CORE_EDITOR_COMMANDS.zoomIn,
        title: 'Zoom in',
        execute: () => commandActions.current[CORE_EDITOR_COMMANDS.zoomIn]?.()
      }),
      commands.register({
        id: CORE_EDITOR_COMMANDS.zoomOut,
        title: 'Zoom out',
        execute: () => commandActions.current[CORE_EDITOR_COMMANDS.zoomOut]?.()
      }),
      commands.register({
        id: CORE_EDITOR_COMMANDS.zoomReset,
        title: 'Reset viewport',
        execute: () => commandActions.current[CORE_EDITOR_COMMANDS.zoomReset]?.()
      }),
      commands.register({
        id: CORE_EDITOR_COMMANDS.zoomFit,
        title: 'Fit canvas',
        execute: () => commandActions.current[CORE_EDITOR_COMMANDS.zoomFit]?.()
      }),
      commands.register({
        id: CORE_EDITOR_COMMANDS.toggleGridSnap,
        title: 'Toggle grid snapping',
        execute: () => commandActions.current[CORE_EDITOR_COMMANDS.toggleGridSnap]?.()
      })
    ];
    return () => {
      for (const dispose of registrations) dispose();
    };
  }, [commands]);

  useEffect(() => {
    const registrations = [...browserRegistry.commands.values()].map((command) =>
      commands.register({
        id: command.id,
        title: command.descriptor.title,
        category: command.descriptor.category,
        execute: () => command.descriptor.execute(browserCommandContext(command.pluginId)),
        isEnabled: () => command.descriptor.isEnabled?.(browserCommandContext(command.pluginId)) ?? true
      })
    );
    return () => {
      for (const dispose of registrations) dispose();
    };
  }, [browserRegistry.commands, commands]);

  useEffect(() => {
    commands.notify();
  }, [commands, readOnly, selectedIds, canvas.elements]);

  function handleCommandKeyDown(event: React.KeyboardEvent) {
    if (isEditableCommandEvent(event)) return;
    const modifier = event.ctrlKey || event.metaKey;
    let commandId: string | null = null;
    if (modifier && event.key.toLowerCase() === 'z') {
      commandId = event.shiftKey ? CORE_EDITOR_COMMANDS.redo : CORE_EDITOR_COMMANDS.undo;
    } else if (modifier && event.key.toLowerCase() === 'y') {
      commandId = CORE_EDITOR_COMMANDS.redo;
    } else if (modifier && event.key.toLowerCase() === 'c') {
      commandId = CORE_EDITOR_COMMANDS.copy;
    } else if (modifier && event.key.toLowerCase() === 'v') {
      commandId = CORE_EDITOR_COMMANDS.paste;
    } else if (modifier && event.key.toLowerCase() === 'd') {
      commandId = CORE_EDITOR_COMMANDS.duplicate;
    } else if (modifier && event.key.toLowerCase() === 'a') {
      commandId = CORE_EDITOR_COMMANDS.selectAll;
    } else if (event.key === 'Delete' || event.key === 'Backspace') {
      commandId = CORE_EDITOR_COMMANDS.delete;
    }
    if (!commandId || !commands.isEnabled(commandId)) return;
    event.preventDefault();
    event.stopPropagation();
    void commands
      .execute(commandId)
      .catch((error) => setMoveError(error instanceof Error ? error.message : String(error)));
  }

  function renderWorldElements(worldElements: readonly CanvasElement[]) {
    return worldElements.map((element) => (
      <div
        key={`${element.id}:${element.type}`}
        className="plugin-world-element"
        data-element-id={element.id}
        style={{ zIndex: element.zIndex ?? 0 }}
      >
        <PluginRendererSurface
          element={element}
          runtime={elementRuntime[element.id] ?? null}
          renderer={rendererFor(element)}
          geometry={geometry}
          overlays={overlays}
          readOnly={readOnly}
          selected={selectedIds.includes(element.id)}
          reportDiagnostic={reportDiagnostic}
        />
      </div>
    ));
  }

  const visibleDiagnostics = [
    ...diagnostics,
    ...runtimeDiagnostics,
    ...(viewportError
      ? [{ code: 'viewport_poll_failed', severity: 'warning' as const, message: viewportError, retryable: true }]
      : [])
  ];

  return (
    <div className="canvas-shell" onKeyDown={handleCommandKeyDown}>
      <header className="topbar">
        <div className="topbar-title">
          <strong>{canvas.title}</strong>
          <span>revision {canvas.revision}</span>
          <span className="badge">{readOnly ? 'read-only' : 'extension canvas'}</span>
          {selectedIds.length > 0 && <span>{selectedIds.length} selected</span>}
          <CanvasBoundsControl bounds={canvas.bounds} readOnly={readOnly} onChange={onCanvasBoundsChange} />
        </div>
        <div className="topbar-controls">
          {!readOnly && (
            <EditorToolbar
              commands={commands}
              onCommandError={(error) => setMoveError(error instanceof Error ? error.message : String(error))}
            />
          )}
          <div className="viewport-status">
            center {Math.round(viewport.centerX)}, {Math.round(viewport.centerY)} · zoom{' '}
            {Math.round(viewport.zoom * 100)}%
          </div>
          <EditorViewportToolbar
            commands={commands}
            gridSnapEnabled={gridSnapEnabled}
            onCommandError={(error) => setMoveError(error instanceof Error ? error.message : String(error))}
          />
        </div>
      </header>
      {(moveError || visibleDiagnostics.length > 0) && (
        <aside className="plugin-diagnostics" aria-live="polite">
          {moveError && <div className="node-move-error">{moveError}</div>}
          {visibleDiagnostics.slice(-5).map((diagnostic, index) => (
            <div
              key={`${diagnostic.code}-${diagnostic.elementId ?? diagnostic.pluginId ?? index}`}
              className={`diagnostic-${diagnostic.severity}`}
            >
              {diagnostic.message}
            </div>
          ))}
        </aside>
      )}
      <main ref={viewportNode} className="canvas-viewport">
        <AgentCanvasEditor
          elements={nodeElements}
          bounds={canvas.bounds}
          viewport={viewport}
          selectedElementIds={selectedIds}
          readOnly={readOnly}
          snapToGrid={gridSnapEnabled}
          renderElement={({ element, selected }) => (
            <PluginRendererSurface
              element={element}
              runtime={elementRuntime[element.id] ?? null}
              renderer={rendererFor(element)}
              geometry={geometry}
              overlays={overlays}
              readOnly={readOnly}
              selected={selected}
              reportDiagnostic={reportDiagnostic}
            />
          )}
          worldUnderlay={renderWorldElements(worldUnderlays)}
          worldOverlay={renderWorldElements(worldOverlays)}
          onViewportChange={(next) =>
            setViewport((current) => {
              if (current.centerX === next.centerX && current.centerY === next.centerY && current.zoom === next.zoom) {
                return current;
              }
              return coerceViewport({ ...current, ...next });
            })
          }
          onSelectionChange={(next) => setSelectedIds((current) => (sameSelection(current, next) ? current : next))}
          onTransientFramesChange={(next) =>
            setTransientFrames((current) => (sameFrames(current, next) ? current : next))
          }
          onFrameCommit={async (changes) => {
            setMoveError(null);
            const { forward, inverse } = frameOperations(changes);
            await commitHistory(
              changes.length === 1 ? 'Change element frame' : `Change ${changes.length} element frames`,
              forward,
              inverse,
              changes.map((change) => change.elementId)
            );
          }}
          onCommitError={(error) => setMoveError(error instanceof Error ? error.message : String(error))}
        />
      </main>
    </div>
  );
}
