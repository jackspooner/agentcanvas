import { DEFAULT_CANVAS_THEME } from '@agentcanvas/extension-sdk';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mermaidPreview, mountMermaidEditor } from '../src/browser/mermaid-editor.js';
import { renderMermaid } from '../src/mermaid/engine.js';

vi.mock('../src/mermaid/engine.js', () => ({ renderMermaid: vi.fn() }));
const rendered = { svg: '<svg/>', diagramType: 'flowchart', width: 100, height: 100 };
const render = vi.mocked(renderMermaid);
const lifetimes: AbortController[] = [];
const createObjectURL = vi.fn(() => `blob:diagram-${createObjectURL.mock.calls.length}`);
const revokeObjectURL = vi.fn();

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
function lifetime() {
  const controller = new AbortController();
  lifetimes.push(controller);
  return controller;
}
function editor() {
  const root = document.createElement('div');
  document.body.append(root);
  let current = {
    data: { title: 'Diagram', source: 'flowchart LR\n A-->B' },
    revision: 1,
    readOnly: false,
    theme: DEFAULT_CANVAS_THEME
  };
  const controller = lifetime();
  const save = vi.fn(async () => {});
  const mounted = mountMermaidEditor(root, { getState: () => current, signal: controller.signal, save });
  const title = root.querySelector('input'),
    source = root.querySelector('textarea'),
    button = root.querySelector('button');
  if (!title || !source || !button) throw new Error('Mermaid editor controls are missing');
  return {
    root,
    controller,
    save,
    mounted,
    state: () => current,
    setState: (next: typeof current) => {
      current = next;
    },
    title,
    source,
    button
  };
}
beforeEach(() => {
  vi.useFakeTimers();
  render.mockReset().mockResolvedValue(rendered);
  createObjectURL.mockClear();
  revokeObjectURL.mockClear();
  vi.stubGlobal(
    'URL',
    class extends URL {
      static createObjectURL = createObjectURL;
      static revokeObjectURL = revokeObjectURL;
    }
  );
});
afterEach(() => {
  for (const controller of lifetimes.splice(0)) controller.abort();
  document.body.replaceChildren();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it('ignores out-of-order preview results and releases the displayed image on disposal', async () => {
  const first = deferred<typeof rendered>(),
    second = deferred<typeof rendered>();
  render.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  const root = document.createElement('div'),
    controller = lifetime();
  const preview = mermaidPreview(root, controller.signal);
  const old = preview('flowchart LR\n Old-->Source', DEFAULT_CANVAS_THEME);
  const latest = preview('flowchart LR\n Current-->Source', DEFAULT_CANVAS_THEME);
  second.resolve({ ...rendered, diagramType: 'current' });
  expect(await latest).toBe(true);
  const image = root.querySelector('img');
  first.resolve({ ...rendered, diagramType: 'old' });
  expect(await old).toBe(false);
  expect(root.querySelector('img')).toBe(image);
  expect(image?.alt).toBe('current diagram');
  expect(createObjectURL).toHaveBeenCalledTimes(1);
  controller.abort();
  expect(root.childNodes).toHaveLength(0);
  expect(revokeObjectURL).toHaveBeenCalledWith(image?.src);
});

it('keeps Save disabled until the latest edited source has a valid preview', async () => {
  const h = editor();
  await settle();
  expect(h.button.disabled).toBe(false);
  const old = deferred<typeof rendered>(),
    latest = deferred<typeof rendered>();
  render.mockReturnValueOnce(old.promise).mockReturnValueOnce(latest.promise);
  h.source.value = 'flowchart LR\n One-->Two';
  h.source.dispatchEvent(new Event('input'));
  await vi.advanceTimersByTimeAsync(300);
  h.source.value = 'flowchart LR\n Latest-->Draft';
  h.source.dispatchEvent(new Event('input'));
  await vi.advanceTimersByTimeAsync(300);
  old.resolve(rendered);
  await settle();
  expect(h.button.disabled).toBe(true);
  latest.resolve(rendered);
  await settle();
  expect(h.button.disabled).toBe(false);
  expect(render).toHaveBeenLastCalledWith(h.source.value, DEFAULT_CANVAS_THEME, h.controller.signal, undefined);
});

it('refreshes a clean editor after history changes while preserving and flagging a stale draft', async () => {
  const h = editor();
  await settle();
  h.setState({ ...h.state(), revision: 2, data: { title: 'Undone', source: 'flowchart LR\n Before-->Edit' } });
  h.mounted.update();
  await settle();
  expect(h.title.value).toBe('Undone');
  expect(h.source.value).toBe(h.state().data.source);
  expect(h.mounted.hasUnsavedChanges()).toBe(false);
  h.title.value = 'Unsaved title';
  h.setState({
    ...h.state(),
    revision: 3,
    data: { title: 'Remote', source: 'flowchart LR\n Remote-->Edit' },
    readOnly: true
  });
  h.mounted.update();
  expect(h.title.value).toBe('Unsaved title');
  expect(h.source.value).toContain('Before');
  expect(h.mounted.hasUnsavedChanges()).toBe(true);
  expect(h.root.textContent).toContain('unsaved draft is preserved');
  expect(h.title.disabled).toBe(true);
  expect(h.source.disabled).toBe(true);
  expect(h.button.disabled).toBe(true);
});

it('does not save after closing the editor during asynchronous validation', async () => {
  const h = editor();
  await settle();
  const validation = deferred<typeof rendered>();
  render.mockReturnValueOnce(validation.promise);
  const saving = h.button.onclick?.call(h.button, new PointerEvent('click'));
  h.controller.abort();
  validation.resolve(rendered);
  await saving;
  expect(h.save).not.toHaveBeenCalled();
  expect(h.root.childNodes).toHaveLength(0);
});

it('keeps a failed stale save as a draft with its original revision', async () => {
  const h = editor();
  await settle();
  h.title.value = 'My draft';
  h.save.mockRejectedValueOnce(new Error('Canvas revision conflict'));
  await h.button.onclick?.call(h.button, new PointerEvent('click'));
  expect(h.save).toHaveBeenCalledWith({ title: 'My draft', source: h.source.value }, 1);
  expect(h.title.value).toBe('My draft');
  expect(h.mounted.hasUnsavedChanges()).toBe(true);
  expect(h.root.textContent).toContain('Canvas revision conflict');
});
