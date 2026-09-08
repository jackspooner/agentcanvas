import type { AgentCanvasBrowserPlugin, JsonObject, RendererContext } from '@agentcanvas/extension-sdk';
import type { ErdData } from '../contracts.js';
import { closeDiagramEditors, registerDiagramCommands, updateDiagramEditors } from './commands.js';
import { mountErdEditor } from './erd-editor.js';
import { errorText, mermaidPreview } from './mermaid-editor.js';

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
      schemaVersions: [1],
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
      schemaVersions: [1],
      placement: 'node',
      mount(root, initial) {
        let context = initial,
          last = '';
        const frame = document.createElement('div');
        frame.dataset.agentcanvasInteractive = '';
        frame.style.cssText =
          'height:100%;display:flex;flex-direction:column;border:1px solid;border-radius:8px;overflow:hidden';
        const header = document.createElement('div');
        header.style.cssText = 'display:flex;justify-content:space-between;padding:8px';
        const title = document.createElement('strong');
        const edit = document.createElement('button');
        edit.type = 'button';
        edit.textContent = 'Edit source';
        edit.onclick = () =>
          void dispatch(context, 'edit').catch((error) => {
            preview.textContent = errorText(error);
          });
        header.append(title, edit);
        const preview = document.createElement('div');
        preview.style.cssText = 'flex:1;min-height:0;padding:8px;overflow:auto';
        frame.append(header, preview);
        root.append(frame);
        const render = mermaidPreview(preview, initial.lifecycle.signal);
        const update = (next: RendererContext) => {
          context = next;
          title.textContent = String(next.element.data.title);
          frame.style.background = next.theme.colors.surface;
          frame.style.color = next.theme.colors.text;
          frame.style.borderColor = next.theme.colors.border;
          const key = JSON.stringify([next.element.data.source, next.theme]);
          if (key !== last) {
            last = key;
            void render(next.element.data.source as string, next.theme);
          }
          updateDiagramEditors(next.element.id);
        };
        update(initial);
        return {
          update,
          dispose() {
            closeDiagramEditors(context.element.id);
            root.replaceChildren();
          }
        };
      }
    });
  }
};
export default extension;
