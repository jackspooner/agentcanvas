import type { AgentCanvasBrowserPlugin, JsonObject, RendererContext } from '@agentcanvas/extension-sdk';
import type { ErdData, MermaidData } from '../contracts.js';
import { closeDiagramEditors, registerDiagramCommands, updateDiagramEditors } from './commands.js';
import { mountErdEditor } from './erd-editor.js';
import { errorText } from './mermaid-editor.js';
import { mountMermaidVisualEditor } from './mermaid-visual-editor.js';

function dispatch(context: RendererContext, name: string, input?: JsonObject): Promise<boolean> {
  if (!context.executeCommand) throw new Error('Diagrams requires host API 1.2 renderer commands.');
  return context.executeCommand(`agentcanvas.diagrams.${name}`, input).then((okay) => {
    if (!okay) throw new Error('The diagram command is unavailable.');
    return okay;
  });
}
const extension: AgentCanvasBrowserPlugin = {
  activate(host) {
    registerDiagramCommands(host);
    host.registerRenderer({
      type: 'agentcanvas.diagrams/erd',
      schemaVersions: [1, 2],
      placement: 'node',
      mount(root, initial) {
        let context = initial;
        const editor = mountErdEditor(root, {
          getState: () => ({
            data: context.element.data as unknown as ErdData,
            revision: context.canvasRevision ?? -1,
            readOnly: context.readOnly || Boolean(context.element.locked),
            theme: context.theme
          }),
          apply: async (label, operations, expectedRevision) => {
            await dispatch(context, 'apply-erd', {
              label,
              operations: operations as unknown as JsonObject[],
              expectedRevision
            });
          },
          expand: () => {
            void dispatch(context, 'edit').catch((error) =>
              context.reportDiagnostic({
                code: 'diagram_command_failed',
                severity: 'error',
                retryable: false,
                message: errorText(error)
              })
            );
          },
          exportMermaid: () => {
            void dispatch(context, 'export-mermaid').catch((error) =>
              context.reportDiagnostic({
                code: 'diagram_export_failed',
                severity: 'error',
                retryable: false,
                message: errorText(error)
              })
            );
          },
          signal: initial.lifecycle.signal
        });
        root.addEventListener(
          'keydown',
          (event) => {
            if (
              !(event instanceof KeyboardEvent) ||
              !(event.ctrlKey || event.metaKey) ||
              !['z', 'y'].includes(event.key.toLowerCase()) ||
              event.target instanceof HTMLInputElement ||
              event.target instanceof HTMLTextAreaElement
            )
              return;
            event.preventDefault();
            event.stopPropagation();
            void context
              .executeCommand?.(
                event.key.toLowerCase() === 'y' || event.shiftKey ? 'agentcanvas.redo' : 'agentcanvas.undo'
              )
              .catch((error) =>
                context.reportDiagnostic({
                  code: 'diagram_command_failed',
                  severity: 'error',
                  retryable: false,
                  message: errorText(error)
                })
              );
          },
          { signal: initial.lifecycle.signal }
        );
        return {
          update(next) {
            context = next;
            editor.update();
            updateDiagramEditors(next.element.id);
          },
          dispose() {
            closeDiagramEditors(context.element.id);
            editor.dispose();
          }
        };
      }
    });
    host.registerRenderer({
      type: 'agentcanvas.diagrams/mermaid',
      schemaVersions: [1, 2],
      placement: 'node',
      mount(root, initial) {
        let context = initial;
        const command = (name: string) =>
          void dispatch(context, name).catch((error) =>
            context.reportDiagnostic({
              code: 'diagram_command_failed',
              severity: 'error',
              retryable: false,
              message: errorText(error)
            })
          );
        const editor = mountMermaidVisualEditor(root, {
          getState: () => ({
            data: context.element.data as unknown as MermaidData,
            revision: context.canvasRevision ?? -1,
            readOnly: context.readOnly || Boolean(context.element.locked),
            theme: context.theme
          }),
          save: async (data, expectedRevision) => {
            await dispatch(context, 'apply-mermaid', { data: data as unknown as JsonObject, expectedRevision });
          },
          editSource: () => command('edit'),
          expand: () => command('edit-visuals'),
          signal: initial.lifecycle.signal
        });
        root.addEventListener(
          'keydown',
          (event) => {
            if (
              !(event instanceof KeyboardEvent) ||
              !(event.ctrlKey || event.metaKey) ||
              !['z', 'y'].includes(event.key.toLowerCase())
            )
              return;
            const target = event.composedPath()[0];
            if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return;
            event.preventDefault();
            event.stopPropagation();
            void context
              .executeCommand?.(
                event.key.toLowerCase() === 'y' || event.shiftKey ? 'agentcanvas.redo' : 'agentcanvas.undo'
              )
              .catch((error) =>
                context.reportDiagnostic({
                  code: 'diagram_command_failed',
                  severity: 'error',
                  retryable: false,
                  message: errorText(error)
                })
              );
          },
          { signal: initial.lifecycle.signal }
        );
        return {
          update(next) {
            context = next;
            editor.update();
            updateDiagramEditors(next.element.id);
          },
          dispose() {
            closeDiagramEditors(context.element.id);
            editor.dispose();
          }
        };
      }
    });
  }
};
export default extension;
