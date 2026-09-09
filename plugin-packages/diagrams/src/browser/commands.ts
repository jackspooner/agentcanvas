import type {
  BrowserCommandContext,
  BrowserPluginHost,
  CanvasElement,
  CanvasThemeV1,
  JsonObject
} from '@agentcanvas/extension-sdk';
import type { ErdData, ErdOperation, MermaidData } from '../contracts.js';
import { applyErdOperations } from '../erd/domain.js';
import { layoutErd } from '../erd/layout.js';
import { extractErd, exportErdMermaid } from '../mermaid/erd.js';
import { renderMermaid, parseMermaidSource } from '../mermaid/engine.js';
import { mountErdEditor } from './erd-editor.js';
import { mountMermaidEditor, errorText } from './mermaid-editor.js';
import { diagramModal } from './modal.js';
import { mountMermaidVisualEditor } from './mermaid-visual-editor.js';

const editors = new Map<string, Set<() => void>>();
const editorClosers = new Map<string, Set<() => void>>();
export function updateDiagramEditors(id: string): void {
  for (const update of editors.get(id) ?? []) update();
}
export function closeDiagramEditors(id: string): void {
  for (const close of editorClosers.get(id) ?? []) close();
}
function observe(id: string, signal: AbortSignal, update: () => void): void {
  const set = editors.get(id) ?? new Set();
  set.add(update);
  editors.set(id, set);
  signal.addEventListener(
    'abort',
    () => {
      set.delete(update);
      if (!set.size) editors.delete(id);
    },
    { once: true }
  );
}
function json(value: unknown): JsonObject {
  return value as JsonObject;
}
function theme(context: BrowserCommandContext): Readonly<CanvasThemeV1> {
  if (!context.theme) throw new Error('Diagrams requires host API 1.2 theme support.');
  return context.theme;
}
function state(context: BrowserCommandContext, id: string) {
  const current = context.getElement?.(id);
  if (!current) throw new Error('The diagram no longer exists.');
  return current;
}
function selected(context: BrowserCommandContext, input?: JsonObject): string {
  const id =
    input?.elementId ?? context.selection.find((element) => element.type.startsWith('agentcanvas.diagrams/'))?.id;
  if (typeof id !== 'string') throw new Error('Select a diagram first.');
  return id;
}
function checkType(element: Readonly<CanvasElement>, type: 'erd' | 'mermaid'): void {
  if (element.type !== `agentcanvas.diagrams/${type}`) throw new Error(`Select a ${type} diagram.`);
}
async function apply(
  context: BrowserCommandContext,
  id: string,
  operations: ErdOperation[],
  revision: number,
  label: string
): Promise<void> {
  const current = state(context, id);
  checkType(current.element, 'erd');
  if (current.revision !== revision)
    throw new Error('The diagram changed. Your draft is preserved; close and reopen to edit the current version.');
  const changed = applyErdOperations(current.element.data as unknown as ErdData, operations);
  await context.transact(label, [{ op: 'replaceElementData', elementId: id, data: json(changed.data) }], {
    expectedRevision: revision
  });
  updateDiagramEditors(id);
}
function historyKeys(root: HTMLElement, context: BrowserCommandContext): void {
  root.addEventListener('keydown', (event) => {
    if (
      !(event.ctrlKey || event.metaKey) ||
      !['z', 'y'].includes(event.key.toLowerCase()) ||
      event.target instanceof HTMLInputElement ||
      event.target instanceof HTMLTextAreaElement
    )
      return;
    event.preventDefault();
    event.stopPropagation();
    void context
      .executeCommand(event.key.toLowerCase() === 'y' || event.shiftKey ? 'agentcanvas.redo' : 'agentcanvas.undo')
      .catch((error) =>
        context.reportDiagnostic({
          code: 'diagram_command_failed',
          severity: 'error',
          retryable: false,
          message: errorText(error)
        })
      );
  });
}
function openEditor(context: BrowserCommandContext, id: string, visual = false): void {
  const current = state(context, id);
  let dirty = () => false;
  let saving = false;
  const modal = diagramModal(
    context.overlays,
    context.signal,
    `Edit ${String(current.element.data.title) || 'diagram'}`,
    () => dirty(),
    () => saving
  );
  const closers = editorClosers.get(id) ?? new Set();
  closers.add(modal.close);
  editorClosers.set(id, closers);
  modal.signal.addEventListener(
    'abort',
    () => {
      closers.delete(modal.close);
      if (!closers.size) editorClosers.delete(id);
    },
    { once: true }
  );
  modal.body.style.color = theme(context).colors.text;
  modal.body.style.background = theme(context).colors.surface;
  const getState = () => {
    const value = state(context, id);
    return {
      data: value.element.data,
      revision: value.revision,
      readOnly: context.readOnly || Boolean(value.element.locked),
      theme: theme(context)
    };
  };
  if (current.element.type === 'agentcanvas.diagrams/erd') {
    const editor = mountErdEditor(modal.body, {
      getState: () => ({ ...getState(), data: getState().data as unknown as ErdData }),
      apply: async (label, operations, revision) => {
        saving = true;
        try {
          await apply(context, id, operations, revision, label);
        } finally {
          saving = false;
        }
      },
      exportMermaid: () =>
        void exportDiagram(context, id).catch((error) =>
          context.reportDiagnostic({
            code: 'diagram_export_failed',
            severity: 'error',
            retryable: false,
            message: errorText(error)
          })
        ),
      expanded: true,
      signal: modal.signal
    });
    dirty = editor.hasUnsavedChanges;
    observe(id, modal.signal, editor.update);
  } else if (visual) {
    const editor = mountMermaidVisualEditor(modal.body, {
      getState: () => ({ ...getState(), data: getState().data as unknown as MermaidData }),
      signal: modal.signal,
      editSource: () => {
        if (editor.hasUnsavedChanges()) return;
        modal.close();
        openEditor(context, id);
      },
      save: async (data, revision) => {
        saving = true;
        try {
          await renderMermaid(data.source, theme(context), modal.signal, data.presentation);
          await context.transact(
            'Edit Mermaid presentation',
            [{ op: 'replaceElementData', elementId: id, data: json(data) }],
            { expectedRevision: revision }
          );
          updateDiagramEditors(id);
        } finally {
          saving = false;
        }
      }
    });
    dirty = editor.hasUnsavedChanges;
    observe(id, modal.signal, editor.update);
  } else {
    const editor = mountMermaidEditor(modal.body, {
      getState: () => ({ ...getState(), data: getState().data as unknown as MermaidData }),
      signal: modal.signal,
      save: async (data, revision) => {
        saving = true;
        try {
          await context.transact(
            'Edit Mermaid diagram',
            [{ op: 'replaceElementData', elementId: id, data: json(data) }],
            { expectedRevision: revision }
          );
          updateDiagramEditors(id);
        } finally {
          saving = false;
        }
      }
    });
    dirty = editor.hasUnsavedChanges;
    observe(id, modal.signal, editor.update);
  }
  historyKeys(modal.body, context);
}
async function exportDiagram(context: BrowserCommandContext, id: string): Promise<void> {
  const current = state(context, id);
  checkType(current.element, 'erd');
  const exported = exportErdMermaid(current.element.data as unknown as ErdData);
  await parseMermaidSource(exported.source, theme(context), context.signal);
  const modal = diagramModal(context.overlays, context.signal, 'Export ERD as Mermaid');
  const label = document.createElement('label');
  label.textContent = 'Mermaid source';
  const source = document.createElement('textarea');
  source.readOnly = true;
  source.value = exported.source;
  source.style.cssText = 'display:block;width:100%;height:65%;min-height:200px';
  label.append(source);
  const warnings = document.createElement('ul');
  for (const issue of exported.warnings) {
    const row = document.createElement('li');
    row.textContent = issue.message;
    warnings.append(row);
  }
  modal.body.append(label, warnings);
}
async function convert(context: BrowserCommandContext, id: string): Promise<void> {
  const current = state(context, id);
  checkType(current.element, 'mermaid');
  const converted = await extractErd(current.element.data.source as string, theme(context), context.signal);
  if (current.element.data.presentation)
    converted.warnings.push({
      path: '/presentation',
      code: 'mermaid.erd.presentation',
      message: 'Saved Mermaid appearance and manual geometry are omitted from the independent native copy.'
    });
  const modal = diagramModal(context.overlays, context.signal, 'Convert Mermaid ERD');
  const heading = document.createElement('p');
  heading.textContent = 'Create an independent editable ERD. The original Mermaid element remains unchanged.';
  const warnings = document.createElement('ul');
  for (const issue of converted.warnings) {
    const item = document.createElement('li');
    item.textContent = issue.message;
    warnings.append(item);
  }
  const label = document.createElement('label'),
    ack = document.createElement('input');
  ack.type = 'checkbox';
  label.append(ack, document.createTextNode('I accept these conversion losses.'));
  label.hidden = !converted.warnings.length;
  const create = document.createElement('button');
  create.type = 'button';
  create.textContent = 'Create editable ERD';
  create.disabled = converted.warnings.length > 0;
  ack.onchange = () => {
    create.disabled = !ack.checked;
  };
  const status = document.createElement('p');
  status.setAttribute('role', 'status');
  create.onclick = async () => {
    create.disabled = true;
    try {
      const element: CanvasElement = {
        id: crypto.randomUUID(),
        type: 'agentcanvas.diagrams/erd',
        schemaVersion: 2,
        x: current.element.x + (current.element.width ?? 720) + 40,
        y: current.element.y,
        width: 960,
        height: 640,
        data: json(layoutErd(converted.data))
      };
      await context.transact('Convert Mermaid ERD', [{ op: 'upsertElement', element }], {
        expectedRevision: current.revision
      });
      modal.close();
      context.reveal({ x: element.x, y: element.y, width: 960, height: 640 });
    } catch (error) {
      status.textContent = errorText(error);
      create.disabled = false;
    }
  };
  modal.body.append(heading, warnings, label, create, status);
}
export function registerDiagramCommands(host: BrowserPluginHost): void {
  if (!host.registerCommand) throw new Error('Diagrams requires host API 1.2 editor commands.');
  for (const kind of ['erd', 'mermaid'] as const)
    host.registerCommand({
      name: `create-${kind}`,
      title: kind === 'erd' ? 'New entity relationship diagram' : 'New Mermaid diagram',
      isEnabled: (context) => !context.readOnly,
      async execute(context) {
        const expectedRevision = context.canvasRevision;
        if (expectedRevision === undefined) throw new Error('Diagrams requires host API 1.2 revision support.');
        const element: CanvasElement = {
          id: crypto.randomUUID(),
          type: `agentcanvas.diagrams/${kind}`,
          schemaVersion: 2,
          x: context.viewport.centerX - 360,
          y: context.viewport.centerY - 240,
          width: kind === 'erd' ? 960 : 720,
          height: kind === 'erd' ? 640 : 480,
          data:
            kind === 'erd'
              ? { title: 'Entity relationship diagram', entities: [], relationships: [] }
              : { title: 'Mermaid diagram', source: 'flowchart LR\n  Start --> Finish' }
        };
        if (kind === 'mermaid') await renderMermaid(element.data.source as string, theme(context), context.signal);
        context.signal.throwIfAborted();
        await context.transact('Create diagram', [{ op: 'upsertElement', element }], { expectedRevision });
        openEditor(context, element.id);
      }
    });
  host.registerCommand({
    name: 'edit',
    title: 'Edit diagram',
    isEnabled: (context) => context.selection.some((element) => element.type.startsWith('agentcanvas.diagrams/')),
    execute: (context, input) => openEditor(context, selected(context, input))
  });
  host.registerCommand({
    name: 'edit-visuals',
    title: 'Edit Mermaid appearance',
    isEnabled: (context) => context.selection.some((element) => element.type === 'agentcanvas.diagrams/mermaid'),
    execute: (context, input) => openEditor(context, selected(context, input), true)
  });
  host.registerCommand({
    name: 'export-mermaid',
    title: 'Export ERD as Mermaid',
    isEnabled: (context) => context.selection.some((element) => element.type === 'agentcanvas.diagrams/erd'),
    execute: (context, input) => exportDiagram(context, selected(context, input))
  });
  host.registerCommand({
    name: 'convert-mermaid-erd',
    title: 'Convert to editable ERD',
    isEnabled: (context) =>
      !context.readOnly && context.selection.some((element) => element.type === 'agentcanvas.diagrams/mermaid'),
    execute: (context, input) => convert(context, selected(context, input))
  });
  host.registerCommand({
    name: 'apply-erd',
    title: 'Apply ERD edit',
    hidden: true,
    execute: async (context, input) => {
      if (!input || !Array.isArray(input.operations) || !Number.isInteger(input.expectedRevision))
        throw new Error('ERD edit requires operations and expectedRevision.');
      await apply(
        context,
        selected(context, input),
        input.operations as unknown as ErdOperation[],
        input.expectedRevision as number,
        typeof input.label === 'string' ? input.label : 'Edit ERD'
      );
    }
  });
  host.registerCommand({
    name: 'apply-mermaid',
    title: 'Save Mermaid source',
    hidden: true,
    execute: async (context, input) => {
      if (!input || !Number.isInteger(input.expectedRevision))
        throw new Error('Mermaid save requires expectedRevision.');
      const id = selected(context, input);
      checkType(state(context, id).element, 'mermaid');
      const data = input.data as unknown as MermaidData;
      await renderMermaid(data.source, theme(context), context.signal, data.presentation);
      await context.transact('Edit Mermaid diagram', [{ op: 'replaceElementData', elementId: id, data: json(data) }], {
        expectedRevision: input.expectedRevision as number
      });
      updateDiagramEditors(id);
    }
  });
}
