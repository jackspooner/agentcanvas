import type { MermaidLayout, MermaidPresentation } from '../contracts.js';
import { appearanceFields } from './appearance-fields.js';
import { button } from './erd-forms.js';

export type MermaidSelection = { kind: 'node' | 'edge'; id: string };
export function mermaidVisualForm(
  panel: HTMLElement,
  layout: MermaidLayout,
  presentation: MermaidPresentation,
  selection: MermaidSelection,
  sequence: boolean,
  save: (value: MermaidPresentation) => Promise<void>,
  close: () => void
) {
  const form = document.createElement('form'),
    fields = document.createElement('fieldset'),
    status = document.createElement('p');
  status.setAttribute('role', 'alert');
  const heading = document.createElement('h3');
  heading.textContent = selection.kind === 'node' ? 'Box appearance and position' : 'Connector appearance and position';
  form.append(heading, fields, status);
  panel.replaceChildren(form);
  panel.hidden = false;
  let readOnly = false;
  let dirty = false,
    busy = false;
  form.oninput = form.onchange = () => {
    dirty = true;
  };
  const field = (label: string, value: number | undefined, min = -100000, max = 100000) => {
    const wrapper = document.createElement('label'),
      input = document.createElement('input');
    input.type = 'number';
    input.step = 'any';
    input.min = String(min);
    input.max = String(max);
    input.value = value === undefined ? '' : String(value);
    wrapper.append(label, input);
    fields.append(wrapper);
    return input;
  };
  const value = structuredClone(presentation);
  let collect: () => void;
  if (selection.kind === 'node') {
    const box = layout.nodes.find((item) => item.id === selection.id)!;
    const override = value.nodes.find((item) => item.id === box.id) ?? { id: box.id };
    const x = field('Box X', override.x ?? box.x);
    const y = sequence ? undefined : field('Box Y', override.y ?? box.y);
    const width = field('Box width (blank uses Mermaid layout)', override.width, 16, 4096);
    const height = field('Box height (blank uses Mermaid layout)', override.height, 16, 4096);
    const appearance = appearanceFields(fields, override.appearance, true, false);
    collect = () => {
      value.nodes = value.nodes.filter((item) => item.id !== box.id);
      value.nodes.push({
        id: box.id,
        ...(x.value ? { x: Number(x.value) } : {}),
        ...(y?.value ? { y: Number(y.value) } : {}),
        ...(width.value ? { width: Number(width.value) } : {}),
        ...(height.value ? { height: Number(height.value) } : {}),
        ...(appearance() ? { appearance: appearance() } : {})
      });
    };
  } else {
    const edge = layout.edges.find((item) => item.id === selection.id)!;
    const override = value.edges.find((item) => item.id === edge.id) ?? { id: edge.id };
    const x = field('Label X (blank uses automatic position)', override.labelPosition?.x);
    const y = field('Label Y (blank uses automatic position)', override.labelPosition?.y);
    const label = document.createElement('label'),
      bends = document.createElement('textarea');
    label.append('Connector bends (one x,y pair per line; blank routes automatically)', bends);
    bends.value = override.bends?.map((point) => `${point.x},${point.y}`).join('\n') ?? '';
    fields.append(label);
    const appearance = appearanceFields(fields, override.appearance, false);
    collect = () => {
      if ((x.value === '') !== (y.value === '')) throw new Error('Enter both label coordinates, or leave both blank.');
      const points = bends.value.trim()
        ? bends.value
            .trim()
            .split('\n')
            .map((line) => {
              const pair = line.split(',');
              if (pair.length !== 2 || pair.some((value) => !value.trim() || !Number.isFinite(Number(value))))
                throw new Error('Each bend must be an x,y pair.');
              return { x: Number(pair[0]), y: Number(pair[1]) };
            })
        : undefined;
      value.edges = value.edges.filter((item) => item.id !== edge.id);
      value.edges.push({
        id: edge.id,
        ...(x.value ? { labelPosition: { x: Number(x.value), y: Number(y.value) } } : {}),
        ...(points ? { bends: points } : {}),
        ...(appearance() ? { appearance: appearance() } : {})
      });
    };
  }
  const submit = document.createElement('button');
  submit.type = 'submit';
  submit.textContent = 'Save';
  const requestClose = () => {
    if (busy) return;
    if (!dirty) return close();
    status.replaceChildren(
      'Discard unsaved changes?',
      button('Keep editing', () => status.replaceChildren()),
      button('Discard changes', close)
    );
  };
  const reset = button('Reset selected to Mermaid defaults', () => {
    const next = structuredClone(presentation);
    if (selection.kind === 'node') next.nodes = next.nodes.filter((item) => item.id !== selection.id);
    else next.edges = next.edges.filter((item) => item.id !== selection.id);
    void persist(next);
  });
  const actions = document.createElement('div');
  actions.className = 'erd-form-actions';
  actions.append(submit, reset, button('Cancel', requestClose));
  form.append(actions);
  async function persist(next: MermaidPresentation) {
    if (readOnly || busy) return;
    busy = true;
    fields.disabled = submit.disabled = reset.disabled = true;
    try {
      await save(next);
      dirty = false;
      close();
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : String(error);
    } finally {
      busy = false;
      fields.disabled = submit.disabled = reset.disabled = readOnly;
    }
  }
  form.onsubmit = (event) => {
    event.preventDefault();
    if (readOnly || busy || !form.reportValidity()) return;
    try {
      collect();
      void persist(value);
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : String(error);
    }
  };
  form.querySelector<HTMLInputElement>('input')?.focus();
  return {
    hasUnsavedChanges: () => dirty || busy,
    requestClose,
    setReadOnly: (value: boolean) => {
      readOnly = value;
      fields.disabled = submit.disabled = reset.disabled = value || busy;
    }
  };
}
