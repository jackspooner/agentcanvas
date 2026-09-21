import type { BrowserCommandContext, BrowserPluginHost, CanvasElement, JsonObject } from '@agentcanvas/plugin-sdk';
import {
  CAROUSEL_CONTROL_HEIGHT,
  CAROUSEL_MAX_SLIDES,
  MARKDOWN_DEFAULT_HEIGHT,
  MARKDOWN_DEFAULT_WIDTH,
  carouselData,
  elementFromSlide,
  slideFromElement,
  type MarkdownCarouselData
} from './carousel.js';

function elementFrame(element: Pick<CanvasElement, 'x' | 'y' | 'width' | 'height'>) {
  return {
    x: element.x,
    y: element.y,
    width: element.width ?? MARKDOWN_DEFAULT_WIDTH,
    height: element.height ?? MARKDOWN_DEFAULT_HEIGHT
  };
}

function documents(context: BrowserCommandContext): readonly Readonly<CanvasElement>[] | null {
  const selection = context.selection;
  return selection.length >= 2 &&
    selection.length <= CAROUSEL_MAX_SLIDES &&
    selection.every((element) => element.type === 'agentcanvas.markdown/document' && !element.locked)
    ? selection
    : null;
}

function selectedCarousel(context: BrowserCommandContext): Readonly<CanvasElement> | null {
  const [element] = context.selection;
  return context.selection.length === 1 && element?.type === 'agentcanvas.markdown/carousel' && !element.locked
    ? element
    : null;
}

async function combine(context: BrowserCommandContext): Promise<void> {
  const selected = documents(context);
  const expectedRevision = context.canvasRevision;
  if (!selected || expectedRevision === undefined) throw new Error('Select 2–50 unlocked Markdown cards.');
  const ordered = [...selected].sort(
    (left, right) => left.y - right.y || left.x - right.x || left.id.localeCompare(right.id)
  );
  const origin = {
    x: Math.min(...ordered.map((element) => element.x)),
    y: Math.min(...ordered.map((element) => element.y))
  };
  const frames = ordered.map(elementFrame);
  const zIndexes = ordered.flatMap((element) => (typeof element.zIndex === 'number' ? [element.zIndex] : []));
  const data: MarkdownCarouselData = {
    slides: ordered.map((element) => slideFromElement(element, origin)),
    initialIndex: 0
  };
  const carousel: CanvasElement = {
    id: crypto.randomUUID(),
    type: 'agentcanvas.markdown/carousel',
    schemaVersion: 1,
    x: origin.x,
    y: origin.y,
    width: Math.max(...frames.map((frame) => frame.width)),
    height: Math.max(...frames.map((frame) => frame.height)) + CAROUSEL_CONTROL_HEIGHT,
    ...(zIndexes.length > 0 ? { zIndex: Math.max(...zIndexes) } : {}),
    data: data as unknown as JsonObject
  };
  await context.transact(
    `Combine ${ordered.length} Markdown cards as carousel`,
    [
      { op: 'upsertElement', element: carousel },
      ...ordered.map((element) => ({ op: 'deleteElement' as const, elementId: element.id }))
    ],
    { expectedRevision }
  );
  context.reveal(elementFrame(carousel));
}

async function unpack(context: BrowserCommandContext): Promise<void> {
  const selected = selectedCarousel(context);
  if (!selected || !context.getElement) throw new Error('Select one unlocked Markdown carousel.');
  const current = context.getElement(selected.id);
  if (!current || current.element.type !== 'agentcanvas.markdown/carousel') {
    throw new Error('The selected Markdown carousel no longer exists.');
  }
  const data = carouselData(current.element.data);
  for (const slide of data.slides) {
    if (context.getElement(slide.id)) throw new Error(`Cannot unpack because element ID already exists: ${slide.id}`);
  }
  const restored = data.slides.map((slide) => elementFromSlide(slide, current.element));
  await context.transact(
    `Unpack ${restored.length} Markdown cards`,
    [
      ...restored.map((element) => ({ op: 'upsertElement' as const, element })),
      { op: 'deleteElement', elementId: current.element.id }
    ],
    { expectedRevision: current.revision }
  );
  const frames = restored.map(elementFrame);
  const minX = Math.min(...frames.map((frame) => frame.x));
  const minY = Math.min(...frames.map((frame) => frame.y));
  context.reveal({
    x: minX,
    y: minY,
    width: Math.max(...frames.map((frame) => frame.x + frame.width)) - minX,
    height: Math.max(...frames.map((frame) => frame.y + frame.height)) - minY
  });
}

export function registerMarkdownCommands(host: BrowserPluginHost): void {
  if (!host.registerCommand) throw new Error('Markdown carousels require host API 1.2 editor commands.');
  host.registerCommand({
    name: 'combine-as-carousel',
    title: 'Combine as Markdown carousel',
    category: 'Markdown',
    isEnabled: (context) => !context.readOnly && documents(context) !== null,
    execute: combine
  });
  host.registerCommand({
    name: 'unpack-carousel',
    title: 'Unpack Markdown carousel',
    category: 'Markdown',
    isEnabled: (context) => !context.readOnly && selectedCarousel(context) !== null,
    execute: unpack
  });
}
