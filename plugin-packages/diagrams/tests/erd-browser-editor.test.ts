import { DEFAULT_CANVAS_THEME } from '@agentcanvas/extension-sdk';
import { afterEach, expect, it, vi } from 'vitest';
import { mountErdEditor } from '../src/browser/erd-editor.js';
import type { ErdData } from '../src/contracts.js';

const data: ErdData = {
  title: 'Catalog',
  entities: [
    {
      id: 'a',
      name: 'Authors',
      x: 10,
      y: 15,
      attributes: [{ id: 'id', name: 'id', dataType: 'uuid', keys: ['PK'], nullable: false }]
    },
    { id: 'b', name: 'Books', x: 420, y: 15, attributes: [] }
  ],
  relationships: []
};

afterEach(() => {
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

function mount() {
  const host = document.createElement('div');
  document.body.append(host);
  const root = host.attachShadow({ mode: 'open' });
  const state = { data: structuredClone(data), revision: 4, readOnly: false, theme: DEFAULT_CANVAS_THEME };
  const apply = vi.fn().mockResolvedValue(undefined);
  const expand = vi.fn();
  const abort = new AbortController();
  const editor = mountErdEditor(root, { getState: () => state, apply, expand, expanded: true, signal: abort.signal });
  const click = (text: string) => {
    const control = Array.from(root.querySelectorAll('button')).find((node) => node.textContent === text);
    if (!control) throw new Error(`Missing ${text}`);
    control.click();
  };
  return { root, state, apply, expand, abort, editor, click };
}

function pointer(target: Element, type: string, x: number, y: number) {
  const event = new MouseEvent(type, { clientX: x, clientY: y, button: 0, bubbles: true, cancelable: true });
  Object.defineProperty(event, 'pointerId', { value: 1 });
  target.dispatchEvent(event);
}

function required<T extends Element>(root: ShadowRoot, selector: string): T {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`Missing ${selector}`);
  return element;
}

function pointerGeometry(svg: SVGSVGElement) {
  const inverse = { a: 0.5, d: 0.5, e: -10, f: -20 };
  class Point {
    constructor(
      readonly x: number,
      readonly y: number
    ) {}
    matrixTransform(matrix: typeof inverse) {
      return new Point(this.x * matrix.a + matrix.e, this.y * matrix.d + matrix.f);
    }
  }
  vi.stubGlobal('DOMPoint', Point);
  svg.getScreenCTM = () => ({ inverse: () => inverse }) as unknown as DOMMatrix;
  let captured = false;
  svg.setPointerCapture = () => {
    captured = true;
  };
  svg.hasPointerCapture = () => captured;
  svg.releasePointerCapture = () => {
    captured = false;
  };
}

it('drags with inverse screen coordinates, freezes view bounds and commits once at the captured revision', async () => {
  const { root, apply, state, editor } = mount();
  const svg = required<SVGSVGElement>(root, 'svg');
  pointerGeometry(svg);
  const view = svg.getAttribute('viewBox');
  pointer(required(root, '[data-drag-entity=a]'), 'pointerdown', 60, 80);
  pointer(svg, 'pointermove', 100, 140);
  expect(svg.getAttribute('viewBox')).toBe(view);
  expect(editor.hasUnsavedChanges()).toBe(true);
  expect(apply).not.toHaveBeenCalled();
  state.revision = 5;
  pointer(svg, 'pointerup', 100, 140);
  await vi.waitFor(() => expect(apply).toHaveBeenCalledOnce());
  expect(apply).toHaveBeenCalledWith('Move entity', [{ op: 'move-entity', entityId: 'a', x: 30, y: 45 }], 4);
});

it('cancels a captured drag on Escape and never sends an outer Delete from the editor', () => {
  const { root, apply, editor } = mount();
  const svg = required<SVGSVGElement>(root, 'svg');
  pointerGeometry(svg);
  pointer(required(root, '[data-drag-entity=a]'), 'pointerdown', 60, 80);
  pointer(svg, 'pointermove', 100, 140);
  svg.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  pointer(svg, 'pointerup', 100, 140);
  expect(apply).not.toHaveBeenCalled();
  expect(editor.hasUnsavedChanges()).toBe(false);
  const outerDelete = vi.fn();
  root.addEventListener('keydown', outerDelete);
  root.querySelector('[data-scene-id="entity:a"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  root
    .querySelector('[data-scene-id="entity:a"]')
    ?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
  expect(root.textContent).toContain('Confirm deletion');
  expect(outerDelete).not.toHaveBeenCalled();
  expect(apply).not.toHaveBeenCalled();
});

it('connects an attribute handle to the same entity through an accessible form and honors read-only updates', () => {
  const { root, state, editor, click, expand, abort } = mount();
  click('Connect');
  root
    .querySelector('[data-connect-entity=a][data-connect-attribute=id]')
    ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  root
    .querySelector('[data-connect-entity=a]:not([data-connect-attribute])')
    ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  const labels = Array.from(root.querySelectorAll('label'));
  const value = (label: string) =>
    labels.find((node) => node.firstChild?.textContent === label)?.querySelector('select')?.value;
  expect(value('Source entity')).toBe('a');
  expect(value('Source attribute')).toBe('id');
  expect(value('Target entity')).toBe('a');
  expect(value('Target attribute')).toBe('');
  expect(editor.hasUnsavedChanges()).toBe(true);
  state.readOnly = true;
  editor.update();
  expect(root.querySelector('fieldset')?.disabled).toBe(true);
  expect(root.querySelector('[data-drag-entity]')).toBeNull();
  click('Fit');
  click('Expand');
  expect(expand).toHaveBeenCalledOnce();
  abort.abort();
  expect(root.childElementCount).toBe(0);
});

it('keeps dirty inputs across updates and asks before Escape discards them', () => {
  const { root, state, editor, click } = mount();
  click('Title');
  const input = required<HTMLInputElement>(root, 'input');
  input.value = 'Unsaved title';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  state.revision = 9;
  editor.update();
  expect(root.querySelector('input')).toBe(input);
  expect(editor.hasUnsavedChanges()).toBe(true);
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  expect(root.textContent).toContain('Discard unsaved changes?');
  expect(input.value).toBe('Unsaved title');
  click('Keep editing');
  expect(root.querySelector('input')).toBe(input);
});

it('keeps click targets attached so a real second click can open attribute editing', () => {
  const { root } = mount();
  const attribute = required(root, '[data-scene-id="attribute:a:id"]');
  attribute.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  expect(attribute.isConnected).toBe(true);
  attribute.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
  expect(root.querySelector('input')?.value).toBe('id');
});

it('opens entity editing when pointer capture retargets a header double click to the SVG', () => {
  const { root, apply } = mount();
  const svg = required<SVGSVGElement>(root, 'svg');
  pointerGeometry(svg);
  const header = required(root, '[data-drag-entity=a]');
  for (let click = 0; click < 2; click++) {
    pointer(header, 'pointerdown', 60, 80);
    pointer(svg, 'pointerup', 60, 80);
    svg.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  }
  svg.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
  expect(root.querySelector('input')?.value).toBe('Authors');
  expect(root.textContent).toContain('Add attribute');
  expect(apply).not.toHaveBeenCalled();
});
