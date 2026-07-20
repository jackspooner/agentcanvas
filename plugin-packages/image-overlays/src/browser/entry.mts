import type {
  AgentCanvasBrowserPlugin,
  BrowserPluginHost,
  PluginDiagnostic,
  RendererContext
} from '@agentcanvas/plugin-sdk';
import JSZip from 'jszip';
import type { BBox, ResolvedBBoxData } from '../contracts.js';
import { maskFilename, maskFolderName, maskZipFilename, pngFilename } from '../exports.js';
import { overlayAccent, scaleBBox } from '../geometry.js';
import { normalizeInlineBBoxData, normalizePathData } from '../normalize.js';

const SVG = 'http://www.w3.org/2000/svg';
const styles = `:host{display:block;width:100%;height:100%;font:13px/1.35 Inter,Arial,sans-serif;color:#0f172a}.card{box-sizing:border-box;position:relative;width:100%;height:100%;display:flex;flex-direction:column;overflow:hidden;border:1px solid #cbd5e1;border-radius:10px;background:#fff}.stage{position:relative;min-height:0;flex:1;overflow:hidden}.stage svg{display:block;width:100%;height:100%}.actions{position:absolute;z-index:2;top:6px;right:6px;display:flex;gap:5px}.actions button{border:1px solid #94a3b8;border-radius:6px;background:#fff;color:#334155;padding:4px 7px;font:600 11px/1 Inter,Arial,sans-serif;cursor:pointer}.actions button:disabled{opacity:.5}.caption{padding:6px 9px;border-top:1px solid #e2e8f0;font-weight:700}.legend{position:absolute;left:8px;bottom:8px;max-width:calc(100% - 16px);max-height:45%;overflow:auto;margin:0;padding:6px 8px;list-style:none;border-radius:6px;background:#fffffff0}.legend li{display:flex;align-items:center;gap:6px}.swatch{width:9px;height:9px;border-radius:50%}.error{box-sizing:border-box;width:100%;height:100%;padding:14px;border:2px solid #ea580c;background:#fff7ed;color:#9a3412}`;

function svgElement(name: string): SVGElement {
  return document.createElementNS(SVG, name);
}

function attributes(element: Element, values: Record<string, string | number>): void {
  for (const [name, value] of Object.entries(values)) element.setAttribute(name, String(value));
}

function report(context: RendererContext, code: string, message: string): void {
  const diagnostic: PluginDiagnostic = {
    code,
    severity: 'error',
    message,
    retryable: true,
    pluginId: 'agentcanvas.image-overlays',
    elementId: context.element.id
  };
  context.reportDiagnostic(diagnostic);
}

function download(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
  } finally {
    URL.revokeObjectURL(url);
  }
}

function canvasBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('PNG encoder returned no data'))), 'image/png');
  });
}

async function svgPng(svg: SVGSVGElement, width: number, height: number, signal: AbortSignal): Promise<Blob> {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute('width', String(width));
  clone.setAttribute('height', String(height));
  const blob = new Blob([new XMLSerializer().serializeToString(clone)], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('overlay SVG could not be rasterized'));
      image.src = url;
    });
    if (signal.aborted) throw new DOMException('Export aborted', 'AbortError');
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('2D canvas is unavailable');
    context.drawImage(image, 0, 0, width, height);
    return await canvasBlob(canvas);
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function maskZip(
  boxes: BBox[],
  elementId: string,
  width: number,
  height: number,
  signal: AbortSignal
): Promise<Blob> {
  const zip = new JSZip();
  const folder = zip.folder(maskFolderName(elementId, width, height));
  if (!folder) throw new Error('mask ZIP folder could not be created');
  for (const [index, box] of boxes.entries()) {
    if (signal.aborted) throw new DOMException('Export aborted', 'AbortError');
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('2D canvas is unavailable');
    context.fillStyle = '#000000';
    context.fillRect(0, 0, width, height);
    context.fillStyle = '#ffffff';
    context.fillRect(box.x, box.y, box.width, box.height);
    folder.file(maskFilename(index, box.label ?? box.id), await canvasBlob(canvas));
  }
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
}

function cardShell(): { card: HTMLElement; stage: HTMLElement; actions: HTMLElement } {
  const card = document.createElement('figure');
  card.className = 'card';
  const stage = document.createElement('div');
  stage.className = 'stage';
  const actions = document.createElement('div');
  actions.className = 'actions';
  actions.dataset.agentcanvasInteractive = 'true';
  card.append(stage, actions);
  return { card, stage, actions };
}

function action(label: string, run: () => Promise<void>): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = label;
  button.setAttribute('aria-label', label);
  button.dataset.agentcanvasInteractive = 'true';
  button.addEventListener('click', () => {
    button.disabled = true;
    void run().finally(() => {
      button.disabled = false;
    });
  });
  return button;
}

function bboxData(context: RendererContext): ResolvedBBoxData {
  const source = context.runtime?.canvasWidth ? context.runtime : context.element.data;
  return normalizeInlineBBoxData(source) as ResolvedBBoxData;
}

function applyTheme(card: HTMLElement, context: RendererContext): void {
  card.style.background = context.theme.colors.surface;
  card.style.color = context.theme.colors.text;
  card.style.borderColor = context.theme.colors.border;
  card.style.borderRadius = `${context.theme.shape.radius}px`;
  card.style.fontFamily = context.theme.typography.bodyFont;
}

function renderBBox(root: ShadowRoot, context: RendererContext): void {
  const data = bboxData(context);
  const { card, stage, actions } = cardShell();
  applyTheme(card, context);
  stage.style.background = data.background ?? context.theme.colors.surfaceMuted;
  const svg = svgElement('svg') as SVGSVGElement;
  attributes(svg, { viewBox: `0 0 ${data.canvasWidth} ${data.canvasHeight}`, role: 'img' });
  svg.setAttribute('aria-label', data.caption ?? data.alt ?? context.element.id);
  if (data.imageUrl) {
    const image = svgElement('image');
    attributes(image, { href: data.imageUrl, x: 0, y: 0, width: data.canvasWidth, height: data.canvasHeight });
    image.setAttribute('preserveAspectRatio', 'none');
    svg.append(image);
  }
  data.boxes.forEach((box, index) => {
    const scaled = scaleBBox(box, index, data.canvasWidth, data.canvasHeight, data.canvasWidth, data.canvasHeight);
    const rect = svgElement('rect');
    attributes(rect, {
      x: box.x,
      y: box.y,
      width: box.width,
      height: box.height,
      fill: box.fill ?? `${scaled.colorValue}22`,
      stroke: scaled.colorValue,
      'stroke-width': box.strokeWidth ?? Math.max(2, Math.round(data.canvasWidth / 512)),
      'data-bbox-id': box.id
    });
    svg.append(rect);
    if (data.showLabels !== false) {
      const text = svgElement('text');
      attributes(text, {
        x: scaled.labelX,
        y: scaled.labelY,
        fill: scaled.colorValue,
        'font-size': 28,
        'font-weight': 700,
        'text-anchor': scaled.textAnchor,
        'paint-order': 'stroke',
        stroke: context.theme.colors.surface,
        'stroke-width': 5
      });
      text.textContent = box.label ?? box.id;
      svg.append(text);
    }
  });
  stage.append(svg);
  actions.append(
    action('Export bbox masks as ZIP', async () => {
      try {
        download(
          await maskZip(data.boxes, context.element.id, data.canvasWidth, data.canvasHeight, context.signal),
          maskZipFilename(context.element.id, data.canvasWidth, data.canvasHeight)
        );
      } catch (error) {
        report(context, 'mask_zip_export_failed', error instanceof Error ? error.message : 'mask ZIP export failed');
      }
    }),
    action('Export bbox overlay as PNG', async () => {
      try {
        download(
          await svgPng(svg, data.canvasWidth, data.canvasHeight, context.signal),
          pngFilename(context.element.id, data.canvasWidth, data.canvasHeight)
        );
      } catch (error) {
        report(context, 'png_export_failed', error instanceof Error ? error.message : 'PNG export failed');
      }
    })
  );
  if (data.caption) {
    const caption = document.createElement('figcaption');
    caption.className = 'caption';
    caption.textContent = data.caption;
    card.append(caption);
  }
  root.replaceChildren(styleNode(), card);
}

function renderPath(root: ShadowRoot, context: RendererContext): void {
  const data = normalizePathData(context.element.data);
  const { card, stage, actions } = cardShell();
  applyTheme(card, context);
  stage.style.background = data.background ?? context.theme.colors.surfaceMuted;
  const svg = svgElement('svg') as SVGSVGElement;
  attributes(svg, { viewBox: `0 0 ${data.canvasWidth} ${data.canvasHeight}`, role: 'img' });
  svg.setAttribute('aria-label', data.caption ?? data.alt ?? context.element.id);
  data.paths.forEach((overlayPath, index) => {
    const path = svgElement('path');
    attributes(path, {
      d: overlayPath.d,
      fill: overlayPath.fill ?? 'transparent',
      stroke: overlayPath.color ?? (index === 0 ? context.theme.colors.accent : overlayAccent(index)),
      'stroke-width': overlayPath.strokeWidth ?? Math.max(2, Math.round(data.canvasWidth / 512)),
      'stroke-linejoin': 'round',
      'stroke-linecap': 'round',
      'data-path-id': overlayPath.id
    });
    svg.append(path);
  });
  stage.append(svg);
  if (data.showLabels !== false) {
    const legend = document.createElement('ul');
    legend.className = 'legend';
    legend.setAttribute('aria-label', `${data.caption ?? context.element.id} paths`);
    data.paths.forEach((overlayPath, index) => {
      const item = document.createElement('li');
      const swatch = document.createElement('span');
      swatch.className = 'swatch';
      swatch.style.background = overlayPath.color ?? (index === 0 ? context.theme.colors.accent : overlayAccent(index));
      const label = document.createElement('span');
      label.textContent = overlayPath.label ?? overlayPath.id;
      item.append(swatch, label);
      legend.append(item);
    });
    stage.append(legend);
  }
  actions.append(
    action('Export path overlay as PNG', async () => {
      try {
        download(
          await svgPng(svg, data.canvasWidth, data.canvasHeight, context.signal),
          pngFilename(context.element.id, data.canvasWidth, data.canvasHeight)
        );
      } catch (error) {
        report(context, 'png_export_failed', error instanceof Error ? error.message : 'PNG export failed');
      }
    })
  );
  if (data.caption) {
    const caption = document.createElement('figcaption');
    caption.className = 'caption';
    caption.textContent = data.caption;
    card.append(caption);
  }
  root.replaceChildren(styleNode(), card);
}

function styleNode(): HTMLStyleElement {
  const style = document.createElement('style');
  style.textContent = styles;
  return style;
}

function renderer(type: 'bbox' | 'path') {
  return {
    type: `agentcanvas.image-overlays/${type}` as const,
    schemaVersions: [1],
    placement: 'node' as const,
    mount(root: ShadowRoot, initial: RendererContext) {
      const update = (context: RendererContext) => {
        try {
          if (type === 'bbox') renderBBox(root, context);
          else renderPath(root, context);
        } catch (error) {
          const message = error instanceof Error ? error.message : 'overlay rendering failed';
          report(context, `${type}_render_failed`, message);
          const card = document.createElement('div');
          card.className = 'error';
          card.textContent = message;
          root.replaceChildren(styleNode(), card);
        }
      };
      update(initial);
      return {
        update,
        dispose() {
          root.replaceChildren();
        }
      };
    }
  };
}

const plugin: AgentCanvasBrowserPlugin = {
  activate(host: BrowserPluginHost) {
    host.registerRenderer(renderer('bbox'));
    host.registerRenderer(renderer('path'));
  }
};

export default plugin;
