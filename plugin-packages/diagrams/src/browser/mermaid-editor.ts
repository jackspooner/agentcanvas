import type { CanvasThemeV1 } from '@agentcanvas/extension-sdk';
import type { MermaidData } from '../contracts.js';
import { renderMermaid } from '../mermaid/engine.js';

export function errorText(error: unknown): string {
  if (error && typeof error === 'object' && 'diagnostics' in error && Array.isArray(error.diagnostics))
    return error.diagnostics.map((issue) => `${issue.path} [${issue.code}] ${issue.message}`).join('\n');
  return error instanceof Error ? error.message : 'Diagram rendering failed.';
}

/** Each preview owns one inert image URL; stale async results never replace the current source. */
export function mermaidPreview(root: HTMLElement, signal: AbortSignal) {
  let request = 0,
    url: string | undefined;
  const clear = () => {
    if (url) URL.revokeObjectURL(url);
    url = undefined;
    root.replaceChildren();
  };
  signal.addEventListener(
    'abort',
    () => {
      request++;
      clear();
    },
    { once: true }
  );
  return async (source: string, theme: Readonly<CanvasThemeV1>): Promise<boolean> => {
    const current = ++request;
    clear();
    root.textContent = 'Rendering diagram…';
    try {
      const rendered = await renderMermaid(source, theme, signal);
      if (signal.aborted || current !== request) return false;
      clear();
      url = URL.createObjectURL(new Blob([rendered.svg], { type: 'image/svg+xml' }));
      const image = document.createElement('img');
      image.src = url;
      image.alt = `${rendered.diagramType} diagram`;
      image.style.cssText = 'width:100%;height:100%;object-fit:contain';
      root.append(image);
      return true;
    } catch (error) {
      if (!signal.aborted && current === request) {
        clear();
        root.textContent = errorText(error);
        root.setAttribute('role', 'status');
      }
      return false;
    }
  };
}

export function mountMermaidEditor(
  root: HTMLElement,
  options: {
    getState: () => { data: MermaidData; revision: number; readOnly: boolean; theme: Readonly<CanvasThemeV1> };
    save: (data: MermaidData, revision: number) => Promise<void>;
    signal: AbortSignal;
  }
) {
  let confirmed = options.getState(),
    saved = structuredClone(confirmed.data),
    revision = confirmed.revision,
    validSource: string | null = null,
    pending = false,
    generation = 0;
  const titleLabel = document.createElement('label');
  titleLabel.textContent = 'Diagram title';
  const title = document.createElement('input');
  title.value = saved.title;
  title.maxLength = 200;
  titleLabel.append(title);
  const sourceLabel = document.createElement('label');
  sourceLabel.textContent = 'Mermaid source';
  sourceLabel.style.cssText = 'display:flex;flex-direction:column;height:100%';
  const source = document.createElement('textarea');
  source.value = saved.source;
  source.maxLength = 20_000;
  source.spellcheck = false;
  source.style.cssText = 'width:100%;flex:1;resize:none;box-sizing:border-box;font:14px monospace;min-height:220px';
  sourceLabel.append(source);
  const preview = document.createElement('div');
  preview.setAttribute('aria-label', 'Diagram preview');
  preview.style.cssText = 'min-width:0;min-height:0;overflow:auto';
  const columns = document.createElement('div');
  columns.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:16px;height:calc(100% - 95px)';
  columns.append(sourceLabel, preview);
  const status = document.createElement('p');
  status.setAttribute('role', 'status');
  status.style.whiteSpace = 'pre-wrap';
  const save = document.createElement('button');
  save.type = 'button';
  save.textContent = 'Save';
  root.dataset.agentcanvasInteractive = '';
  root.append(titleLabel, columns, save, status);
  const render = mermaidPreview(preview, options.signal);
  const hasUnsavedChanges = () => pending || title.value !== saved.title || source.value !== saved.source;
  const updateControls = () => {
    const state = options.getState();
    save.disabled = state.readOnly || pending || validSource !== source.value;
    title.disabled = source.disabled = state.readOnly;
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const updatePreview = async () => {
    const own = ++generation,
      text = source.value;
    validSource = null;
    updateControls();
    const okay = await render(text, options.getState().theme);
    if (own === generation && !options.signal.aborted) {
      validSource = okay ? text : null;
      updateControls();
    }
  };
  source.oninput = () => {
    generation++;
    validSource = null;
    updateControls();
    clearTimeout(timer);
    timer = setTimeout(() => void updatePreview(), 300);
  };
  save.onclick = async () => {
    const data = { title: title.value, source: source.value };
    pending = true;
    updateControls();
    status.textContent = 'Saving…';
    try {
      await renderMermaid(data.source, options.getState().theme, options.signal);
      options.signal.throwIfAborted();
      await options.save(data, revision);
      confirmed = options.getState();
      saved = structuredClone(confirmed.data);
      revision = confirmed.revision;
      status.textContent = 'Saved.';
    } catch (error) {
      status.textContent = errorText(error);
    } finally {
      pending = false;
      if (!options.signal.aborted) updateControls();
    }
  };
  options.signal.addEventListener(
    'abort',
    () => {
      generation++;
      clearTimeout(timer);
      root.replaceChildren();
    },
    { once: true }
  );
  updateControls();
  void updatePreview();
  let renderedTheme = JSON.stringify(confirmed.theme);
  const update = () => {
    if (options.signal.aborted) return;
    const next = options.getState(),
      nextTheme = JSON.stringify(next.theme);
    if (next.revision !== revision && !hasUnsavedChanges()) {
      saved = structuredClone(next.data);
      revision = next.revision;
      title.value = saved.title;
      source.value = saved.source;
      status.textContent = '';
      void updatePreview();
    } else if (next.revision !== revision && !pending)
      status.textContent =
        'The diagram changed. Your unsaved draft is preserved; close and reopen to review the current version.';
    if (nextTheme !== renderedTheme) {
      renderedTheme = nextTheme;
      void updatePreview();
    }
    updateControls();
  };
  return { hasUnsavedChanges, update };
}
