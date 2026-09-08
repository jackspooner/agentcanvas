import type {
  BrowserCommandContext,
  BrowserCommandDescriptor,
  CanvasElement,
  RendererOverlayService
} from '@agentcanvas/extension-sdk';
import { DEFAULT_CANVAS_THEME } from '@agentcanvas/extension-sdk';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { closeDiagramEditors, registerDiagramCommands, updateDiagramEditors } from '../src/browser/commands.js';
import { diagramModal } from '../src/browser/modal.js';
import { renderMermaid } from '../src/mermaid/engine.js';

vi.mock('../src/mermaid/engine.js', () => ({
  renderMermaid: vi.fn(),
  parseMermaidSource: vi.fn(),
  withMermaid: vi.fn()
}));
const rendered = { svg: '<svg/>', diagramType: 'flowchart', width: 100, height: 100 };
const lifetimes: AbortController[] = [];
function lifetime() {
  const controller = new AbortController();
  lifetimes.push(controller);
  return controller;
}
function overlay() {
  const close = vi.fn();
  const open = vi.fn<RendererOverlayService['open']>((content) => {
    const layer = document.createElement('div');
    layer.append(content);
    document.body.append(layer);
    return {
      update() {},
      close() {
        close();
        layer.remove();
      }
    };
  });
  return { service: { open }, open, close };
}
function button(label: string): HTMLButtonElement {
  const control = [...document.querySelectorAll('button')].find((candidate) => candidate.textContent === label);
  if (!control) throw new Error(`Button missing: ${label}`);
  return control;
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function settle() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}
function commands() {
  const registered = new Map<string, BrowserCommandDescriptor>();
  registerDiagramCommands({
    registerRenderer() {},
    registerCommand(command) {
      registered.set(command.name, command);
    }
  });
  const current = {
    element: {
      id: 'diagram',
      type: 'agentcanvas.diagrams/mermaid',
      schemaVersion: 1,
      x: 0,
      y: 0,
      data: { title: 'Example', source: 'flowchart LR\n A-->B' }
    } as CanvasElement,
    revision: 1,
    readOnly: false
  };
  const overlays = overlay(),
    controller = lifetime();
  const transact = vi.fn<BrowserCommandContext['transact']>(async (_label, _operations, options) => {
    if (options?.expectedRevision !== current.revision) throw new Error('Canvas revision conflict');
  });
  const context: BrowserCommandContext = {
    pluginId: 'agentcanvas.diagrams',
    get readOnly() {
      return current.readOnly;
    },
    get canvasRevision() {
      return current.revision;
    },
    theme: DEFAULT_CANVAS_THEME,
    get selection() {
      return [current.element];
    },
    viewport: { centerX: 0, centerY: 0, zoom: 1 },
    signal: controller.signal,
    overlays: overlays.service,
    executeCommand: async () => true,
    getElement: () => ({ element: current.element, revision: current.revision }),
    reveal() {},
    transact,
    reportDiagnostic() {}
  };
  const run = (name: string) => {
    const command = registered.get(name);
    if (!command) throw new Error(`Command missing: ${name}`);
    return command.execute(context, { elementId: current.element.id });
  };
  return { registered, current, overlays, controller, transact, context, run };
}
beforeEach(() => {
  vi.mocked(renderMermaid).mockReset().mockResolvedValue(rendered);
  // jsdom lacks native dialog top-layer methods; native focus trapping requires browser verification.
  Object.defineProperties(HTMLDialogElement.prototype, {
    showModal: {
      configurable: true,
      value(this: HTMLDialogElement) {
        this.open = true;
      }
    },
    close: {
      configurable: true,
      value(this: HTMLDialogElement) {
        this.open = false;
      }
    }
  });
  vi.stubGlobal(
    'URL',
    class extends URL {
      static createObjectURL = () => 'blob:diagram';
      static revokeObjectURL = vi.fn();
    }
  );
});
afterEach(() => {
  for (const controller of lifetimes.splice(0)) controller.abort();
  document.body.replaceChildren();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(HTMLDialogElement.prototype, 'showModal');
  Reflect.deleteProperty(HTMLDialogElement.prototype, 'close');
});

it('requires explicit dirty discard, blocks close while persisting, and restores focus once', () => {
  const previous = document.createElement('button');
  document.body.append(previous);
  previous.focus();
  const overlays = overlay(),
    controller = lifetime();
  let dirty = true,
    busy = false;
  const modal = diagramModal(
    overlays.service,
    controller.signal,
    'Diagram',
    () => dirty,
    () => busy
  );
  button('Close').click();
  expect(document.querySelector('[role="alert"]')?.hasAttribute('hidden')).toBe(false);
  button('Keep editing').click();
  expect(modal.signal.aborted).toBe(false);
  button('Close').click();
  busy = true;
  button('Discard and close').click();
  expect(modal.signal.aborted).toBe(false);
  button('Close').click();
  expect(button('Saving… wait before closing')).toBeDefined();
  busy = false;
  dirty = false;
  button('Saving… wait before closing').click();
  expect(modal.signal.aborted).toBe(true);
  expect(overlays.close).toHaveBeenCalledTimes(1);
  expect(document.activeElement).toBe(previous);
  controller.abort();
  modal.close();
  expect(overlays.close).toHaveBeenCalledTimes(1);
});

it('closes on host disposal and refuses an already-aborted modal before opening an overlay', () => {
  const overlays = overlay(),
    controller = lifetime();
  const modal = diagramModal(
    overlays.service,
    controller.signal,
    'Diagram',
    () => true,
    () => true
  );
  controller.abort();
  expect(modal.signal.aborted).toBe(true);
  expect(overlays.close).toHaveBeenCalledTimes(1);
  expect(() => diagramModal(overlays.service, controller.signal, 'Late diagram')).toThrow();
  expect(overlays.open).toHaveBeenCalledTimes(1);
});

it('keeps menu editing available read-only and removes menu dialogs when their source renderer is disposed', async () => {
  const h = commands();
  h.current.readOnly = true;
  expect(h.registered.get('edit')?.isEnabled?.(h.context)).toBe(true);
  await h.run('edit');
  await settle();
  expect(document.querySelector('textarea')?.disabled).toBe(true);
  expect(button('Save').disabled).toBe(true);
  closeDiagramEditors('diagram');
  expect(h.overlays.close).toHaveBeenCalledTimes(1);
  expect(h.controller.signal.aborted).toBe(false);
  h.context.getElement = () => {
    throw new Error('Disposed source must not be read');
  };
  expect(() => updateDiagramEditors('diagram')).not.toThrow();
});

it('captures the creation revision before asynchronous Mermaid validation', async () => {
  const h = commands(),
    validation = deferred<typeof rendered>();
  vi.mocked(renderMermaid).mockReturnValueOnce(validation.promise);
  const creating = Promise.resolve(h.run('create-mermaid'));
  h.current.revision = 2;
  validation.resolve(rendered);
  await expect(creating).rejects.toThrow('Canvas revision conflict');
  expect(h.transact).toHaveBeenCalledWith('Create diagram', [expect.objectContaining({ op: 'upsertElement' })], {
    expectedRevision: 1
  });
  expect(h.overlays.open).not.toHaveBeenCalled();
});

it('keeps an open editor until its queued save finishes instead of claiming to discard the save', async () => {
  const h = commands();
  await h.run('edit');
  await settle();
  const saving = deferred<void>();
  h.transact.mockReturnValueOnce(saving.promise);
  button('Save').click();
  await settle();
  expect(h.transact).toHaveBeenCalledTimes(1);
  button('Close').click();
  expect(h.overlays.close).not.toHaveBeenCalled();
  saving.resolve();
  await settle();
  button('Saving… wait before closing').click();
  expect(h.overlays.close).toHaveBeenCalledTimes(1);
});
