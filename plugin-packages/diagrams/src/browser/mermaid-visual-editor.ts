import type { CanvasThemeV1 } from '@agentcanvas/extension-sdk';
import type { MermaidData, MermaidLayout, MermaidPresentation } from '../contracts.js';
import { renderMermaid } from '../mermaid/engine.js';
import { button } from './erd-forms.js';
import { errorText } from './mermaid-editor.js';
import { mermaidVisualForm, type MermaidSelection } from './mermaid-visual-form.js';
import { svgElement, preserveSvgFocus } from './scene-dom.js';
import { erdEditorStyles } from './styles.js';

export interface MermaidVisualEditorOptions {
  getState(): { data: MermaidData; revision: number; readOnly: boolean; theme: Readonly<CanvasThemeV1> };
  save(data: MermaidData, revision: number): Promise<void>;
  editSource(): void;
  expand?(): void;
  signal: AbortSignal;
}
/** SVG contains only an inert image and host-owned hit targets. Every completed gesture saves once. */
export function mountMermaidVisualEditor(root: ShadowRoot | HTMLElement, options: MermaidVisualEditorOptions) {
  const lifetime = new AbortController(),
    signal = lifetime.signal;
  const style = document.createElement('style');
  style.textContent = erdEditorStyles;
  const frame = document.createElement('div');
  frame.className = 'erd-editor';
  frame.dataset.agentcanvasInteractive = 'true';
  const toolbar = document.createElement('div');
  toolbar.className = 'erd-toolbar';
  toolbar.setAttribute('role', 'toolbar');
  toolbar.setAttribute('aria-label', 'Mermaid visual controls');
  const stage = svgElement('svg', { class: 'erd-stage', role: 'group', 'aria-label': 'Mermaid boxes and connectors' });
  stage.dataset.agentcanvasInteractive = 'true';
  const status = document.createElement('div');
  status.className = 'erd-status';
  status.setAttribute('role', 'status');
  const panel = document.createElement('div');
  panel.className = 'erd-form-panel';
  panel.hidden = true;
  frame.append(toolbar, stage, status, panel);
  root.replaceChildren(style, frame);
  let confirmed = options.getState(),
    draft = structuredClone(confirmed.data),
    revision = confirmed.revision;
  let layout: MermaidLayout | undefined,
    sequence = false,
    selection: MermaidSelection | undefined;
  let url: string | undefined,
    view: string | undefined,
    dirty = false,
    saving = false,
    painting = false,
    generation = 0;
  let form: ReturnType<typeof mermaidVisualForm> | undefined;
  let drag:
    | {
        pointer: number;
        start: DOMPoint;
        inverse: DOMMatrix;
        apply: (x: number, y: number) => void;
        original: MermaidData;
        changed: boolean;
      }
    | undefined;
  const presentation = (): MermaidPresentation => draft.presentation ?? { source: draft.source, nodes: [], edges: [] };
  const edit = button('Edit selected', () => openForm());
  const fit = button('Fit', () => {
    view = undefined;
    void paint();
  });
  const openOther = (action: () => void) => {
    if (form?.hasUnsavedChanges()) return form.requestClose();
    if (dirty || saving || drag) {
      status.textContent = 'Save or discard the visual draft before opening another editor.';
      return;
    }
    action();
  };
  toolbar.append(
    button('Edit source', () => openOther(options.editSource)),
    edit,
    fit
  );
  if (options.expand) toolbar.append(button('Expand', () => openOther(options.expand!)));
  const reset = button('Discard visual draft', () => {
    draft = structuredClone(options.getState().data);
    revision = options.getState().revision;
    dirty = false;
    view = undefined;
    form = undefined;
    panel.hidden = true;
    void paint();
  });
  reset.hidden = true;
  toolbar.append(reset);
  function controls() {
    edit.disabled = options.getState().readOnly || saving || !selection;
    form?.setReadOnly(options.getState().readOnly || saving);
    reset.hidden = !dirty || Boolean(drag);
    reset.disabled = saving;
  }
  function closeForm() {
    if (dirty && !saving) {
      const next = options.getState();
      draft = structuredClone(next.data);
      revision = next.revision;
      dirty = false;
      void paint();
    }
    form = undefined;
    panel.hidden = true;
    panel.replaceChildren();
    stage.focus();
  }
  function openForm() {
    if (!layout || !selection || options.getState().readOnly || saving) return;
    if (form?.hasUnsavedChanges()) return form.requestClose();
    const currentRevision = revision;
    form = mermaidVisualForm(
      panel,
      layout,
      presentation(),
      selection,
      sequence,
      async (value) => {
        draft.presentation = value;
        dirty = true;
        await save(currentRevision);
      },
      closeForm
    );
  }
  async function save(expected = revision) {
    if (options.getState().readOnly) throw new Error('This diagram is read-only. Your draft is preserved.');
    saving = true;
    controls();
    try {
      if (draft.presentation && !draft.presentation.nodes.length && !draft.presentation.edges.length)
        delete draft.presentation;
      await options.save(structuredClone(draft), expected);
      confirmed = options.getState();
      revision = confirmed.revision;
      draft = structuredClone(confirmed.data);
      dirty = false;
      status.textContent = 'Visual changes saved.';
    } finally {
      saving = false;
      controls();
      void paint();
    }
  }
  function putNode(id: string, change: object) {
    const next = structuredClone(presentation());
    const original = next.nodes.find((item) => item.id === id) ?? { id };
    next.nodes = next.nodes.filter((item) => item.id !== id);
    next.nodes.push({ ...original, ...change });
    draft.presentation = next;
  }
  function putEdge(id: string, change: object) {
    const next = structuredClone(presentation());
    const original = next.edges.find((item) => item.id === id) ?? { id };
    next.edges = next.edges.filter((item) => item.id !== id);
    next.edges.push({ ...original, ...change });
    draft.presentation = next;
  }
  function handleChange(target: Element): ((dx: number, dy: number) => void) | undefined {
    const handle = target.closest<SVGElement>(
      '[data-visual-node],[data-visual-resize],[data-visual-bend],[data-visual-label]'
    );
    if (!handle || !layout) return;
    const nodeId = handle.dataset.visualNode ?? handle.dataset.visualResize;
    if (nodeId) {
      const box = structuredClone(layout.nodes.find((item) => item.id === nodeId)!);
      selection = { kind: 'node', id: nodeId };
      if (handle.dataset.visualResize)
        return (dx, dy) =>
          putNode(nodeId, {
            width: Math.max(16, Math.min(4096, box.width + dx)),
            height: Math.max(16, Math.min(4096, box.height + dy))
          });
      return (dx, dy) => putNode(nodeId, { x: box.x + dx, ...(sequence ? {} : { y: box.y + dy }) });
    }
    const edgeId = handle.dataset.visualBend ?? handle.dataset.visualLabel;
    const edge = structuredClone(layout.edges.find((item) => item.id === edgeId)!);
    selection = { kind: 'edge', id: edge.id };
    if (handle.dataset.visualLabel)
      return (dx, dy) =>
        putEdge(edge.id, { labelPosition: { x: edge.labelPosition.x + dx, y: edge.labelPosition.y + dy } });
    const points = structuredClone(
      presentation().edges.find((item) => item.id === edge.id)?.bends ?? edge.points.slice(1, -1)
    );
    const index = Number(handle.dataset.bendIndex);
    return (dx, dy) => {
      const bends = structuredClone(points);
      bends[index] = { x: points[index].x + dx, y: points[index].y + dy };
      putEdge(edge.id, { bends });
    };
  }
  function draw(rendered: Awaited<ReturnType<typeof renderMermaid>>) {
    const restoreFocus = preserveSvgFocus(stage);
    layout = rendered.layout;
    sequence = rendered.diagramType === 'sequence';
    if (!layout) throw new Error('Mermaid visual layout is missing.');
    const documentSvg = new DOMParser().parseFromString(rendered.svg, 'image/svg+xml').documentElement;
    const imageView = documentSvg.getAttribute('viewBox')!;
    const [x, y, width, height] = imageView.split(/[ ,]+/).map(Number);
    const nextUrl = URL.createObjectURL(new Blob([rendered.svg], { type: 'image/svg+xml' }));
    if (url) URL.revokeObjectURL(url);
    url = nextUrl;
    view ??= imageView;
    stage.setAttribute('viewBox', view);
    stage.replaceChildren(
      svgElement('image', {
        href: url,
        x,
        y,
        width,
        height,
        role: 'img',
        'aria-label': `${rendered.diagramType} diagram`,
        'pointer-events': 'none'
      })
    );
    const accent = options.getState().theme.colors.accent;
    const handles: SVGElement[] = [];
    for (const edge of layout.edges) {
      const selected = selection?.kind === 'edge' && selection.id === edge.id;
      stage.append(
        svgElement('polyline', {
          points: edge.points.map((point) => `${point.x},${point.y}`).join(' '),
          fill: 'none',
          stroke: selected ? accent : 'transparent',
          'stroke-width': selected ? 2 : 16,
          'data-visual-edge': edge.id,
          tabindex: 0,
          role: 'button',
          'aria-label': `Connector ${edge.label || edge.id}`
        })
      );
      if (selected && !options.getState().readOnly) {
        const bends = presentation().edges.find((item) => item.id === edge.id)?.bends ?? edge.points.slice(1, -1);
        for (const [index, point] of bends.entries())
          handles.push(
            svgElement('circle', {
              cx: point.x,
              cy: point.y,
              r: 7,
              fill: accent,
              tabindex: 0,
              role: 'button',
              'aria-label': `Move bend ${index + 1}`,
              'data-visual-bend': edge.id,
              'data-bend-index': index
            })
          );
        if (edge.label)
          handles.push(
            svgElement('circle', {
              cx: edge.labelPosition.x,
              cy: edge.labelPosition.y,
              r: 8,
              fill: 'transparent',
              stroke: accent,
              tabindex: 0,
              role: 'button',
              'aria-label': 'Move connector label',
              'data-visual-label': edge.id
            })
          );
      }
    }
    for (const node of layout.nodes) {
      const selected = selection?.kind === 'node' && selection.id === node.id;
      stage.append(
        svgElement('rect', {
          x: node.x,
          y: node.y,
          width: node.width,
          height: node.height,
          fill: 'transparent',
          stroke: selected ? accent : 'transparent',
          'stroke-width': 2,
          'data-visual-node': node.id,
          tabindex: 0,
          role: 'button',
          'aria-label': `Box ${node.label}`
        })
      );
      if (selected && !options.getState().readOnly)
        handles.push(
          svgElement('rect', {
            x: node.x + node.width - 8,
            y: node.y + node.height - 8,
            width: 16,
            height: 16,
            fill: accent,
            'data-visual-resize': node.id,
            tabindex: 0,
            role: 'button',
            'aria-label': `Resize ${node.label}`
          })
        );
    }
    stage.append(...handles);
    controls();
    restoreFocus();
  }
  async function paint() {
    generation++;
    if (painting || signal.aborted) return;
    painting = true;
    let own = generation;
    try {
      do {
        own = generation;
        try {
          const rendered = await renderMermaid(
            draft.source,
            options.getState().theme,
            signal,
            draft.presentation,
            true
          );
          if (signal.aborted) return;
          if (own === generation) draw(rendered);
        } catch (error) {
          if (!signal.aborted && own === generation) {
            stage.replaceChildren();
            if (url) URL.revokeObjectURL(url);
            url = undefined;
            layout = undefined;
            status.textContent = errorText(error);
          }
        }
      } while (own !== generation && !signal.aborted);
    } finally {
      painting = false;
    }
  }
  stage.addEventListener(
    'pointerdown',
    (event) => {
      if (
        event.button !== 0 ||
        saving ||
        options.getState().readOnly ||
        !panel.hidden ||
        !(event.target instanceof Element)
      )
        return;
      const apply = handleChange(event.target);
      if (!apply) return;
      const matrix = stage.getScreenCTM();
      if (!matrix) return;
      const inverse = matrix.inverse();
      drag = {
        pointer: event.pointerId,
        start: new DOMPoint(event.clientX, event.clientY).matrixTransform(inverse),
        inverse,
        apply,
        original: structuredClone(draft),
        changed: false
      };
      stage.setPointerCapture(event.pointerId);
      event.preventDefault();
      event.stopPropagation();
      controls();
    },
    { signal }
  );
  stage.addEventListener(
    'pointermove',
    (event) => {
      if (!drag || drag.pointer !== event.pointerId) return;
      const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(drag.inverse);
      drag.apply(point.x - drag.start.x, point.y - drag.start.y);
      drag.changed = true;
      dirty = true;
      void paint();
    },
    { signal }
  );
  function finish(cancel = false) {
    const current = drag;
    if (!current) return;
    drag = undefined;
    if (stage.hasPointerCapture(current.pointer)) stage.releasePointerCapture(current.pointer);
    if (cancel) {
      draft = current.original;
      dirty = JSON.stringify(draft) !== JSON.stringify(confirmed.data);
      void paint();
    } else if (current.changed)
      void save().catch((error) => {
        status.textContent = errorText(error);
      });
    else void paint();
  }
  stage.addEventListener('pointerup', () => finish(), { signal });
  stage.addEventListener('pointercancel', () => finish(true), { signal });
  stage.addEventListener('lostpointercapture', () => finish(true), { signal });
  stage.addEventListener(
    'click',
    (event) => {
      if (!(event.target instanceof Element) || drag) return;
      const target = event.target.closest<SVGElement>('[data-visual-edge],[data-visual-node]');
      if (target?.dataset.visualEdge) selection = { kind: 'edge', id: target.dataset.visualEdge };
      else if (target?.dataset.visualNode) selection = { kind: 'node', id: target.dataset.visualNode };
      controls();
      void paint();
    },
    { signal }
  );
  stage.addEventListener('dblclick', () => openForm(), { signal });
  stage.addEventListener(
    'focusin',
    (event) => {
      if (!(event.target instanceof SVGElement)) return;
      const next: MermaidSelection | undefined = event.target.dataset.visualNode
        ? { kind: 'node', id: event.target.dataset.visualNode }
        : event.target.dataset.visualEdge
          ? { kind: 'edge', id: event.target.dataset.visualEdge }
          : undefined;
      if (next && JSON.stringify(next) !== JSON.stringify(selection)) {
        selection = next;
        controls();
        void paint();
      }
    },
    { signal }
  );
  frame.addEventListener(
    'keydown',
    (event) => {
      if (event.key === 'Escape') {
        if (drag) finish(true);
        else if (form) form.requestClose();
        else return;
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (!(event.target instanceof Element) || event.target.closest('input,textarea,select,form')) {
        event.stopPropagation();
        return;
      }
      if (!event.target.closest('svg')) return;
      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (event.key === 'Enter') {
        event.preventDefault();
        event.stopPropagation();
        openForm();
        return;
      }
      if (
        !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key) ||
        options.getState().readOnly ||
        saving
      )
        return;
      const change = handleChange(event.target);
      if (!change) return;
      event.preventDefault();
      event.stopPropagation();
      const step = event.shiftKey ? 10 : 1;
      change(
        event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0,
        event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0
      );
      dirty = true;
      void save().catch((error) => {
        status.textContent = errorText(error);
      });
    },
    { signal }
  );
  function update() {
    if (signal.aborted) return;
    const next = options.getState();
    if (!drag && !dirty && !form?.hasUnsavedChanges() && !saving) {
      confirmed = next;
      revision = next.revision;
      draft = structuredClone(next.data);
    } else if (next.revision !== revision && !saving)
      status.textContent =
        'The diagram changed. Your visual draft is preserved; discard it to load the current diagram.';
    if (next.readOnly && drag) finish(true);
    for (const [key, value] of Object.entries({
      surface: next.theme.colors.surface,
      text: next.theme.colors.text,
      border: next.theme.colors.border,
      accent: next.theme.colors.accent,
      muted: next.theme.colors.surfaceMuted,
      font: next.theme.typography.bodyFont
    }))
      frame.style.setProperty(`--erd-${key}`, value);
    controls();
    void paint();
  }
  function dispose() {
    if (signal.aborted) return;
    lifetime.abort();
    if (url) URL.revokeObjectURL(url);
    options.signal.removeEventListener('abort', dispose);
    root.replaceChildren();
  }
  options.signal.addEventListener('abort', dispose, { once: true });
  update();
  if (options.signal.aborted) dispose();
  return { update, dispose, hasUnsavedChanges: () => dirty || saving || Boolean(drag || form?.hasUnsavedChanges()) };
}
