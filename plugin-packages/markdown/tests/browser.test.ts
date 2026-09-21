import type {
  BrowserCommandContext,
  BrowserCommandDescriptor,
  CanvasElement,
  RendererContext
} from '@agentcanvas/plugin-sdk';
import { DEFAULT_CANVAS_THEME } from '@agentcanvas/plugin-sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerMarkdownCommands } from '../src/browser/commands.js';
import { createMarkdownCarouselRenderer } from '../src/browser/entry.mjs';

function carouselElement(): CanvasElement {
  return {
    id: 'carousel',
    type: 'agentcanvas.markdown/carousel',
    schemaVersion: 1,
    x: 100,
    y: 200,
    width: 390,
    height: 967,
    data: {
      slides: [
        {
          id: 'first',
          schemaVersion: 1,
          data: { markdown: '# First card' },
          style: { background: '#ffffff' },
          frame: { x: 0, y: 0, width: 390, height: 923 }
        },
        {
          id: 'second',
          schemaVersion: 1,
          data: { markdown: '# Second card' },
          frame: { x: 430, y: 0, width: 390, height: 923 }
        }
      ],
      initialIndex: 0
    }
  };
}

function rendererContext(element = carouselElement()): RendererContext {
  return {
    element,
    runtime: null,
    readOnly: false,
    selected: false,
    signal: new AbortController().signal,
    lifecycle: { signal: new AbortController().signal, active: true, reducedMotion: false },
    frames: { subscribe: () => () => {} },
    theme: DEFAULT_CANVAS_THEME,
    geometry: { getElementFrame: () => null, resolveAnchor: () => null },
    overlays: { open: () => ({ update() {}, close() {} }) },
    reportDiagnostic: vi.fn()
  };
}

function commandHarness(selection: CanvasElement[]) {
  const commands = new Map<string, BrowserCommandDescriptor>();
  registerMarkdownCommands({
    registerRenderer() {},
    registerCommand(command) {
      commands.set(command.name, command);
    }
  });
  const elements = new Map(selection.map((element) => [element.id, element]));
  const transact = vi.fn<BrowserCommandContext['transact']>();
  const reveal = vi.fn();
  const context: BrowserCommandContext = {
    pluginId: 'agentcanvas.markdown',
    canvasRevision: 7,
    readOnly: false,
    selection,
    viewport: { centerX: 0, centerY: 0, zoom: 1 },
    signal: new AbortController().signal,
    overlays: { open: () => ({ update() {}, close() {} }) },
    executeCommand: async () => true,
    getElement: (id) => {
      const element = elements.get(id);
      return element ? { element, revision: 7 } : null;
    },
    reveal,
    transact,
    reportDiagnostic() {}
  };
  return { commands, context, elements, reveal, transact };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('Markdown carousel browser renderer', () => {
  it('navigates accessibly, wraps, retains the active slide, and creates no autoplay timer', async () => {
    vi.useFakeTimers();
    const context = rendererContext();
    const root = document.createElement('div').attachShadow({ mode: 'open' });
    const mounted = createMarkdownCarouselRenderer().mount(root, context);
    const frame = root.querySelector<HTMLElement>('.carousel');
    const next = root.querySelector<HTMLButtonElement>('[aria-label="Next card"]');
    expect(frame?.getAttribute('aria-roledescription')).toBe('carousel');
    expect(root.querySelector('[aria-roledescription="slide"]')?.getAttribute('aria-label')).toBe('1 of 2: First card');
    expect(root.querySelector('.carousel-position')?.textContent).toBe('1 / 2');
    expect(vi.getTimerCount()).toBe(0);

    next?.click();
    expect(root.querySelector('.carousel-position')?.textContent).toBe('2 / 2');
    expect(root.querySelector('.document')?.textContent).toContain('Second card');
    next?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(root.querySelector('.carousel-position')?.textContent).toBe('2 / 2');

    await mounted.update({ ...context, element: { ...context.element, opacity: 0.9 } });
    expect(root.querySelector('.carousel-position')?.textContent).toBe('2 / 2');
    frame?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(root.querySelector('.carousel-position')?.textContent).toBe('1 / 2');
    await mounted.dispose();
    expect(root.childNodes).toHaveLength(0);
  });
});

describe('Markdown carousel commands', () => {
  it('combines sorted documents atomically and unpacks them losslessly from the moved anchor', async () => {
    const left: CanvasElement = {
      id: 'left',
      type: 'agentcanvas.markdown/document',
      schemaVersion: 1,
      x: 10,
      y: 20,
      width: 390,
      height: 500,
      data: { markdown: '# Left' },
      style: { background: '#fff' },
      metadata: { source: 'test' }
    };
    const right: CanvasElement = {
      id: 'right',
      type: 'agentcanvas.markdown/document',
      schemaVersion: 1,
      x: 440,
      y: 20,
      width: 420,
      height: 520,
      zIndex: 4,
      data: { markdown: '# Right', allowScroll: true }
    };
    const combined = commandHarness([right, left]);
    const combine = combined.commands.get('combine-as-carousel') as BrowserCommandDescriptor;
    expect(combine.isEnabled?.(combined.context)).toBe(true);
    await combine.execute(combined.context);
    const operations = combined.transact.mock.calls[0]?.[1] ?? [];
    const carousel = operations[0]?.op === 'upsertElement' ? operations[0].element : null;
    expect(carousel).toMatchObject({
      type: 'agentcanvas.markdown/carousel',
      x: 10,
      y: 20,
      width: 420,
      height: 564,
      zIndex: 4,
      data: { slides: [{ id: 'left' }, { id: 'right' }], initialIndex: 0 }
    });
    expect(operations.slice(1)).toEqual([
      { op: 'deleteElement', elementId: 'left' },
      { op: 'deleteElement', elementId: 'right' }
    ]);
    expect(combined.transact).toHaveBeenCalledWith(expect.any(String), operations, { expectedRevision: 7 });

    const moved = { ...(carousel as CanvasElement), x: 100, y: 200 };
    const unpacked = commandHarness([moved]);
    const unpack = unpacked.commands.get('unpack-carousel') as BrowserCommandDescriptor;
    expect(unpack.isEnabled?.(unpacked.context)).toBe(true);
    await unpack.execute(unpacked.context);
    const unpackOperations = unpacked.transact.mock.calls[0]?.[1] ?? [];
    expect(unpackOperations[0]).toEqual({ op: 'upsertElement', element: { ...left, x: 100, y: 200 } });
    expect(unpackOperations[1]).toEqual({ op: 'upsertElement', element: { ...right, x: 530, y: 200 } });
    expect(unpackOperations[2]).toEqual({ op: 'deleteElement', elementId: moved.id });
  });

  it('rejects unpacking when a stored source ID has been reused', async () => {
    const carousel = carouselElement();
    const harness = commandHarness([carousel]);
    harness.elements.set('first', {
      id: 'first',
      type: 'agentcanvas.markdown/document',
      schemaVersion: 1,
      x: 0,
      y: 0,
      data: { markdown: '# Collision' }
    });
    const unpack = harness.commands.get('unpack-carousel') as BrowserCommandDescriptor;
    await expect(unpack.execute(harness.context)).rejects.toThrow('element ID already exists: first');
    expect(harness.transact).not.toHaveBeenCalled();
  });
});
