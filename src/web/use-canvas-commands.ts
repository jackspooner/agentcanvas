import { CORE_EDITOR_COMMANDS, EditorCommandService } from '@agentcanvas/editor';
import type {
  BrowserCommandContext,
  BrowserOwnCanvasOperation,
  CanvasElement,
  PluginDiagnostic
} from '@agentcanvas/plugin-sdk';
import { nanoid } from 'nanoid';
import type React from 'react';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { type CanvasClipboardPayload, cloneElement, parseClipboardPayload } from './canvas-clipboard';
import { extensionOperations } from './canvas-operations';
import type { LoadedBrowserRegistry } from './plugins/catalog';
import type { DomRendererOverlayService } from './plugins/overlays';
import type { useCanvasHistory } from './use-canvas-history';
import type { CanvasDocument, CanvasViewport } from './v2-types';
import { coerceViewport, DEFAULT_REPORTED_VIEWPORT_HEIGHT, DEFAULT_REPORTED_VIEWPORT_WIDTH } from './viewport';

function isEditableCommandEvent(event: React.KeyboardEvent): boolean {
  return event.nativeEvent.composedPath().some((entry) => {
    if (!(entry instanceof Element)) return false;
    return (
      entry.matches('input, textarea, select, [contenteditable="true"]') ||
      entry.hasAttribute('data-agentcanvas-interactive')
    );
  });
}

interface CanvasCommandsOptions {
  canvas: CanvasDocument;
  selectedIds: readonly string[];
  readOnly: boolean;
  viewport: CanvasViewport;
  nodeElements: readonly CanvasElement[];
  browserRegistry: LoadedBrowserRegistry;
  overlays: DomRendererOverlayService;
  history: ReturnType<typeof useCanvasHistory>;
  viewportNode: React.RefObject<HTMLDivElement | null>;
  setSelectedIds: React.Dispatch<React.SetStateAction<readonly string[]>>;
  setViewport: React.Dispatch<React.SetStateAction<CanvasViewport>>;
  setGridSnapEnabled: React.Dispatch<React.SetStateAction<boolean>>;
  fitCanvas: () => void;
  resetViewport: () => void;
  reportDiagnostic: (diagnostic: PluginDiagnostic) => void;
  setMoveError: React.Dispatch<React.SetStateAction<string | null>>;
}
export function useCanvasCommands(options: CanvasCommandsOptions) {
  const {
    canvas,
    selectedIds,
    readOnly,
    viewport,
    nodeElements,
    browserRegistry,
    overlays,
    history,
    viewportNode,
    setSelectedIds,
    setViewport,
    setGridSnapEnabled,
    fitCanvas,
    resetViewport,
    reportDiagnostic,
    setMoveError
  } = options;
  const { commitHistory } = history;
  const clipboardElements = useRef<CanvasElement[]>([]);
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
  commandState.current = {
    canvas,
    selectedIds,
    readOnly,
    viewport,
    nodeElementIds: nodeElements.map((element) => element.id)
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: Extension command lifetimes belong to the canvas identity.
  useEffect(() => {
    const previous = extensionAbort.current;
    extensionAbort.current = new AbortController();
    previous.abort();
    return () => extensionAbort.current.abort();
  }, [canvas.id]);
  const selectedElements = useCallback((): CanvasElement[] => {
    const selected = new Set(commandState.current.selectedIds);
    return commandState.current.canvas.elements.filter((element) => selected.has(element.id));
  }, []);

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
    const selection = await history.undo();
    if (selection) setSelectedIds(selection);
  }
  async function redo() {
    const selection = await history.redo();
    if (selection) setSelectedIds(selection);
  }
  function selectAll() {
    setSelectedIds(commandState.current.nodeElementIds);
  }

  function zoomBy(factor: number) {
    setViewport((value) => coerceViewport({ ...value, zoom: value.zoom * factor }));
  }

  async function transactExtensionOperations(
    pluginId: string,
    label: string,
    operations: readonly BrowserOwnCanvasOperation[]
  ) {
    if (commandState.current.readOnly) throw new Error('The canvas is read-only.');
    const { forward, inverse, affected } = extensionOperations(history.getConfirmedDocument(), pluginId, operations);
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

  const currentHistory = useRef(history);
  currentHistory.current = history;
  const contextFactory = useRef(browserCommandContext);
  contextFactory.current = browserCommandContext;

  useEffect(() => {
    const hasSelection = () => commandState.current.selectedIds.length > 0;
    const hasMutableSelection = () => selectedElements().some((element) => !element.locked);
    const registrations = [
      commands.register({
        id: CORE_EDITOR_COMMANDS.undo,
        title: 'Undo',
        execute: () => commandActions.current[CORE_EDITOR_COMMANDS.undo]?.(),
        isEnabled: () => !commandState.current.readOnly && currentHistory.current.canUndo
      }),
      commands.register({
        id: CORE_EDITOR_COMMANDS.redo,
        title: 'Redo',
        execute: () => commandActions.current[CORE_EDITOR_COMMANDS.redo]?.(),
        isEnabled: () => !commandState.current.readOnly && currentHistory.current.canRedo
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
  }, [commands, selectedElements]);

  useEffect(() => {
    const registrations = [...browserRegistry.commands.values()].map((command) =>
      commands.register({
        id: command.id,
        title: command.descriptor.title,
        category: command.descriptor.category,
        execute: () => command.descriptor.execute(contextFactory.current(command.pluginId)),
        isEnabled: () => command.descriptor.isEnabled?.(contextFactory.current(command.pluginId)) ?? true
      })
    );
    return () => {
      for (const dispose of registrations) dispose();
    };
  }, [browserRegistry.commands, commands]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: Notify subscribers when availability or command context changes.
  useEffect(() => {
    commands.notify();
  }, [commands, readOnly, selectedIds, canvas.elements, viewport, history.version]);

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

  // biome-ignore lint/correctness/useExhaustiveDependencies: Selection and local clipboard belong to one canvas.
  useEffect(() => {
    setSelectedIds([]);
    clipboardElements.current = [];
  }, [canvas.id, setSelectedIds]);
  return { commands, handleCommandKeyDown };
}
