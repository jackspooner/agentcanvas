import type {
  AgentCanvasBrowserPlugin,
  BrowserElementRenderer,
  BrowserPluginHost,
  JsonObject,
  RendererContext
} from '@agentcanvas/plugin-sdk';
import { carouselData, carouselTitle } from './carousel.js';
import { registerMarkdownCommands } from './commands.js';
import { renderSafeMarkdown } from './markdown.js';

const styles = `:host{display:block;width:100%;height:100%;box-sizing:border-box}.document{box-sizing:border-box;width:100%;height:100%;overflow:auto;padding:var(--ac-padding,14px);color:var(--ac-color,#0f172a);background:var(--ac-background,#fff);border:var(--ac-border-shorthand,var(--ac-border-width,1px) solid var(--ac-border,#d0d7de));border-radius:var(--ac-radius,10px);font:var(--ac-font-size,14px)/1.5 var(--ac-font-family,Inter,Arial,sans-serif);font-weight:var(--ac-font-weight,400)}h1,h2,h3,h4,h5,h6{line-height:1.2;margin:.7em 0 .35em;font-family:var(--ac-heading-font,var(--ac-font-family))}h1:first-child,h2:first-child,h3:first-child{margin-top:0}p{margin:.55em 0}ul,ol{padding-left:1.5rem}pre{overflow:auto;padding:.7rem;border-radius:6px;background:var(--ac-highlight,#dbeafe);color:var(--ac-highlight-text,#1e3a8a)}code{font-family:var(--ac-mono-font,ui-monospace,Consolas,monospace);background:var(--ac-muted,#f1f5f9);padding:.1em .25em;border-radius:3px}pre code{background:transparent;padding:0}img{display:block;max-width:100%;height:auto}table{width:100%;border-collapse:collapse}th,td{padding:.35rem .5rem;border:1px solid var(--ac-border,#cbd5e1);text-align:left}th{background:var(--ac-highlight,#dbeafe);color:var(--ac-highlight-text,#1e3a8a)}a{color:var(--ac-accent,#2563eb);text-decoration:underline}.carousel{display:grid;grid-template-rows:minmax(0,1fr) 44px;width:100%;height:100%;outline:none}.carousel:focus-visible{outline:2px solid var(--ac-accent,#2563eb);outline-offset:2px}.carousel .document{border-radius:var(--ac-radius,10px) var(--ac-radius,10px) 0 0}.carousel-footer{display:grid;grid-template-columns:36px minmax(0,1fr) auto 36px;align-items:center;gap:8px;box-sizing:border-box;padding:4px 6px;border:var(--ac-border-width,1px) solid var(--ac-border,#d0d7de);border-top:0;border-radius:0 0 var(--ac-radius,10px) var(--ac-radius,10px);background:var(--ac-surface,#fff);color:var(--ac-color,#0f172a);font:12px/1.2 var(--ac-font-family,Inter,Arial,sans-serif)}.carousel-title{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:650}.carousel-position{color:var(--ac-text-muted,#64748b);font-weight:650;font-variant-numeric:tabular-nums}.carousel-button{display:grid;width:30px;height:30px;place-items:center;border:1px solid var(--ac-border,#cbd5e1);border-radius:50%;background:var(--ac-surface,#fff);color:var(--ac-accent,#2563eb);padding:0;font:700 21px/1 var(--ac-font-family,Inter,Arial,sans-serif);cursor:pointer}.carousel-button:focus-visible{outline:2px solid var(--ac-accent,#2563eb);outline-offset:1px}`;

function styleValue(style: Readonly<JsonObject> | null | undefined, key: string, fallback: string): string {
  const setting = style?.[key];
  return typeof setting === 'string' || typeof setting === 'number' ? String(setting) : fallback;
}

function applyMarkdownStyles(
  target: HTMLElement,
  style: Readonly<JsonObject> | null | undefined,
  context: RendererContext
): void {
  const { colors, typography, shape } = context.theme;
  target.style.setProperty('--ac-color', styleValue(style, 'color', colors.text));
  target.style.setProperty('--ac-background', styleValue(style, 'background', colors.surface));
  target.style.setProperty('--ac-border', styleValue(style, 'borderColor', colors.border));
  target.style.setProperty('--ac-border-width', `${styleValue(style, 'borderWidth', String(shape.borderWidth))}px`);
  const border = style?.border;
  if (typeof border === 'string') target.style.setProperty('--ac-border-shorthand', border);
  else target.style.removeProperty('--ac-border-shorthand');
  target.style.setProperty('--ac-radius', `${styleValue(style, 'borderRadius', String(shape.radius))}px`);
  target.style.setProperty('--ac-padding', `${styleValue(style, 'padding', '14')}px`);
  target.style.setProperty('--ac-font-size', `${styleValue(style, 'fontSize', '14')}px`);
  target.style.setProperty('--ac-font-weight', styleValue(style, 'fontWeight', '400'));
  target.style.setProperty('--ac-font-family', styleValue(style, 'fontFamily', typography.bodyFont));
  target.style.setProperty('--ac-heading-font', typography.headingFont);
  target.style.setProperty('--ac-mono-font', typography.monoFont);
  target.style.setProperty('--ac-muted', colors.surfaceMuted);
  target.style.setProperty('--ac-highlight', colors.highlight);
  target.style.setProperty('--ac-highlight-text', colors.highlightText);
  target.style.setProperty('--ac-accent', colors.accent);
  target.style.setProperty('--ac-surface', colors.surface);
  target.style.setProperty('--ac-text-muted', colors.textMuted);
}

export function createMarkdownDocumentRenderer(): BrowserElementRenderer {
  return {
    type: 'agentcanvas.markdown/document',
    schemaVersions: [1],
    placement: 'node',
    mount(root, initial) {
      const style = document.createElement('style');
      style.textContent = styles;
      const documentElement = document.createElement('article');
      documentElement.className = 'document';
      root.replaceChildren(style, documentElement);
      const update = (context: RendererContext) => {
        applyMarkdownStyles(documentElement, context.element.style, context);
        documentElement.innerHTML = renderSafeMarkdown(
          typeof context.element.data.markdown === 'string' ? context.element.data.markdown : '',
          { allowImages: context.element.data.allowImages !== false }
        );
      };
      update(initial);
      return { update, dispose: () => root.replaceChildren() };
    }
  };
}

export function createMarkdownCarouselRenderer(): BrowserElementRenderer {
  return {
    type: 'agentcanvas.markdown/carousel',
    schemaVersions: [1],
    placement: 'node',
    mount(root, initial) {
      const style = document.createElement('style');
      style.textContent = styles;
      const frame = document.createElement('section');
      frame.className = 'carousel';
      frame.tabIndex = 0;
      frame.dataset.agentcanvasInteractive = '';
      frame.setAttribute('role', 'region');
      frame.setAttribute('aria-roledescription', 'carousel');
      frame.setAttribute('aria-label', 'Markdown card carousel');
      const slide = document.createElement('article');
      slide.className = 'document';
      slide.setAttribute('role', 'group');
      slide.setAttribute('aria-roledescription', 'slide');
      const footer = document.createElement('footer');
      footer.className = 'carousel-footer';
      const previous = document.createElement('button');
      previous.type = 'button';
      previous.className = 'carousel-button';
      previous.dataset.agentcanvasInteractive = '';
      previous.setAttribute('aria-label', 'Previous card');
      previous.textContent = '\u2039';
      const title = document.createElement('span');
      title.className = 'carousel-title';
      const position = document.createElement('span');
      position.className = 'carousel-position';
      position.setAttribute('aria-live', 'polite');
      const next = document.createElement('button');
      next.type = 'button';
      next.className = 'carousel-button';
      next.dataset.agentcanvasInteractive = '';
      next.setAttribute('aria-label', 'Next card');
      next.textContent = '\u203a';
      footer.append(previous, title, position, next);
      frame.append(slide, footer);
      root.replaceChildren(style, frame);

      let context = initial;
      let data = carouselData(initial.element.data);
      let activeIndex = Math.min(data.initialIndex, data.slides.length - 1);
      let activeId = data.slides[activeIndex]?.id ?? null;

      const render = () => {
        const active = data.slides[activeIndex] ?? data.slides[0];
        const activeTitle = carouselTitle(data, activeIndex);
        applyMarkdownStyles(frame, active.style, context);
        applyMarkdownStyles(slide, active.style, context);
        slide.innerHTML = renderSafeMarkdown(String(active.data.markdown ?? ''), {
          allowImages: active.data.allowImages !== false
        });
        slide.setAttribute('aria-label', `${activeIndex + 1} of ${data.slides.length}: ${activeTitle}`);
        title.textContent = activeTitle;
        position.textContent = `${activeIndex + 1} / ${data.slides.length}`;
      };
      const move = (delta: number) => {
        activeIndex = (activeIndex + delta + data.slides.length) % data.slides.length;
        activeId = data.slides[activeIndex]?.id ?? null;
        render();
      };
      const onPrevious = () => move(-1);
      const onNext = () => move(1);
      const onKeyDown = (event: KeyboardEvent) => {
        if (event.target !== frame || (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')) return;
        event.preventDefault();
        move(event.key === 'ArrowLeft' ? -1 : 1);
      };
      previous.addEventListener('click', onPrevious);
      next.addEventListener('click', onNext);
      frame.addEventListener('keydown', onKeyDown);
      const update = (nextContext: RendererContext) => {
        context = nextContext;
        const nextData = carouselData(nextContext.element.data);
        const retained = activeId ? nextData.slides.findIndex((candidate) => candidate.id === activeId) : -1;
        data = nextData;
        activeIndex = retained >= 0 ? retained : Math.min(data.initialIndex, data.slides.length - 1);
        activeId = data.slides[activeIndex]?.id ?? null;
        render();
      };
      update(initial);
      return {
        update,
        dispose() {
          previous.removeEventListener('click', onPrevious);
          next.removeEventListener('click', onNext);
          frame.removeEventListener('keydown', onKeyDown);
          root.replaceChildren();
        }
      };
    }
  };
}

const plugin: AgentCanvasBrowserPlugin = {
  activate(host: BrowserPluginHost) {
    host.registerRenderer(createMarkdownDocumentRenderer());
    host.registerRenderer(createMarkdownCarouselRenderer());
    registerMarkdownCommands(host);
  }
};

export default plugin;
