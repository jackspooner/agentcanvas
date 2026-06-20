import type { BBoxOverlayElement, CanvasElement, CanvasRecord, CanvasViewportInput, LineElement, PathOverlayElement } from './contracts';
import { elementHeight, elementWidth } from './geometry';

export interface CanvasScreenshotOptions {
  width?: number;
  height?: number;
  centerX?: number;
  centerY?: number;
  zoom?: number;
  fullCanvas?: boolean;
  overlayNodeIds?: boolean;
  padding?: number;
}

export interface RenderedCanvasScreenshot {
  svg: string;
  width: number;
  height: number;
  viewBox: { x: number; y: number; width: number; height: number };
  overlayNodeIds: boolean;
}

const DEFAULT_WIDTH = 1280;
const DEFAULT_HEIGHT = 720;
const DEFAULT_PADDING = 80;

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function escapeXml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function overlayAccent(index: number): string {
  return ['#2563eb', '#9333ea', '#0891b2', '#db2777', '#ea580c', '#16a34a'][index % 6];
}

function cardElements(canvas: CanvasRecord): CanvasElement[] {
  return canvas.elements.filter((el) => el.type !== 'line' && el.type !== 'arrow');
}

function elementById(canvas: CanvasRecord, id: string | null | undefined): CanvasElement | undefined {
  if (!id) return undefined;
  return canvas.elements.find((el) => el.id === id);
}

function anchorPoint(el: CanvasElement, anchor: string | null | undefined = 'center'): { x: number; y: number } {
  const w = elementWidth(el);
  const h = elementHeight(el);
  switch (anchor) {
    case 'top': return { x: el.x + w / 2, y: el.y };
    case 'right': return { x: el.x + w, y: el.y + h / 2 };
    case 'bottom': return { x: el.x + w / 2, y: el.y + h };
    case 'left': return { x: el.x, y: el.y + h / 2 };
    case 'center':
    default: return { x: el.x + w / 2, y: el.y + h / 2 };
  }
}

function endpointPoint(canvas: CanvasRecord, endpoint: LineElement['from']): { x: number; y: number } {
  const linked = elementById(canvas, endpoint.elementId);
  if (linked) return anchorPoint(linked, endpoint.anchor);
  return { x: finiteNumber(endpoint.x, 0), y: finiteNumber(endpoint.y, 0) };
}

function computeFullViewBox(canvas: CanvasRecord, padding: number): { x: number; y: number; width: number; height: number } {
  const cards = cardElements(canvas);
  if (cards.length === 0) return { x: -padding, y: -padding, width: canvas.width + padding * 2, height: canvas.height + padding * 2 };

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const el of cards) {
    minX = Math.min(minX, el.x);
    minY = Math.min(minY, el.y);
    maxX = Math.max(maxX, el.x + elementWidth(el));
    maxY = Math.max(maxY, el.y + elementHeight(el));
  }
  return {
    x: minX - padding,
    y: minY - padding,
    width: Math.max(1, maxX - minX + padding * 2),
    height: Math.max(1, maxY - minY + padding * 2)
  };
}

function computeViewportViewBox(options: CanvasScreenshotOptions): { x: number; y: number; width: number; height: number } {
  const width = finiteNumber(options.width, DEFAULT_WIDTH);
  const height = finiteNumber(options.height, DEFAULT_HEIGHT);
  const zoom = clamp(finiteNumber(options.zoom, 1), 0.05, 8);
  const worldWidth = width / zoom;
  const worldHeight = height / zoom;
  const centerX = finiteNumber(options.centerX, 0);
  const centerY = finiteNumber(options.centerY, 0);
  return { x: centerX - worldWidth / 2, y: centerY - worldHeight / 2, width: worldWidth, height: worldHeight };
}

function stripMarkdownLine(line: string): string {
  return line
    .replace(/^#{1,6}\s+/, '')
    .replace(/^[-*+]\s+/, '• ')
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/__(.*?)__/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .trim();
}

function wrapText(text: string, maxChars: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (candidate.length > maxChars && line) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [''];
}

function textLinesForElement(el: CanvasElement): string[] {
  if (el.type === 'text') return String(el.text).split('\n');
  if (el.type === 'markdown') {
    return el.markdown
      .split('\n')
      .map(stripMarkdownLine)
      .filter(Boolean);
  }
  if (el.type === 'table') {
    return [el.caption ?? '', el.columns.join(' | '), ...el.rows.map((row) => row.join(' | '))].filter(Boolean);
  }
  if (el.type === 'asset') return [el.caption ?? el.alt ?? `Asset ${el.assetRef.assetId}`];
  if (el.type === 'glbViewer') return [el.caption ?? el.alt ?? `GLB ${el.assetRef.assetId}`];
  if (el.type === 'video') return [el.caption ?? el.alt ?? `Video ${el.assetRef.assetId}`];
  if (el.type === 'bboxOverlay') return [el.caption ?? el.alt ?? `BBox overlay ${el.id}`];
  if (el.type === 'pathOverlay') return [el.caption ?? el.alt ?? `Path overlay ${el.id}`];
  if (el.type === 'shape') return [el.label ?? el.id];
  if (el.type === 'group') return [`Group ${el.id}`];
  return [el.id];
}

function renderBBoxOverlayCard(el: BBoxOverlayElement): string {
  if (typeof el.canvasWidth !== 'number' || typeof el.canvasHeight !== 'number' || !Array.isArray(el.boxes)) {
    const w = elementWidth(el);
    const h = elementHeight(el);
    const label = escapeXml(el.caption ?? el.alt ?? el.id);
    const error = escapeXml(el.layoutResolutionError ?? 'BBox layout asset is unresolved.');
    return `<g data-node-id="${escapeXml(el.id)}">
      <rect x="${el.x}" y="${el.y}" width="${w}" height="${h}" rx="10" fill="#fff7ed" stroke="#f97316" />
      <text x="${el.x + 14}" y="${el.y + 28}" font-family="Inter, Arial, sans-serif" font-size="15" font-weight="700" fill="#9a3412">${label}</text>
      <text x="${el.x + 14}" y="${el.y + 52}" font-family="Inter, Arial, sans-serif" font-size="12" fill="#9a3412">${error}</text>
    </g>`;
  }
  const w = elementWidth(el);
  const h = elementHeight(el);
  const sx = w / el.canvasWidth;
  const sy = h / el.canvasHeight;
  const label = escapeXml(el.caption ?? el.alt ?? el.id);
  const background = escapeXml(el.background ?? '#f8fafc');
  const boxes = el.boxes.map((box, index) => {
    const color = escapeXml(box.color ?? overlayAccent(index));
    const x = el.x + box.x * sx;
    const y = el.y + box.y * sy;
    const bw = box.width * sx;
    const bh = box.height * sy;
    const text = escapeXml(box.label ?? box.id);
    const align = box.labelAlign ?? 'left';
    const verticalAlign = box.labelVerticalAlign ?? 'top';
    const padding = box.labelPadding ?? 8;
    const scaledPaddingX = padding * sx;
    const scaledPaddingY = padding * sy;
    const textAnchor = align === 'center' ? 'middle' : align === 'right' ? 'end' : 'start';
    const textX = align === 'center' ? x + bw / 2 : align === 'right' ? x + bw - scaledPaddingX : x + scaledPaddingX;
    const dominantBaseline = verticalAlign === 'middle' ? 'middle' : verticalAlign === 'bottom' ? 'text-after-edge' : 'hanging';
    const textY = verticalAlign === 'middle' ? y + bh / 2 : verticalAlign === 'bottom' ? y + bh - scaledPaddingY : y + scaledPaddingY;
    return `<g>
      <rect data-bbox-id="${escapeXml(box.id)}" x="${x}" y="${y}" width="${bw}" height="${bh}" fill="${escapeXml(box.fill ?? `${color}22`)}" stroke="${color}" stroke-width="${box.strokeWidth ?? 2}" />
      ${el.showLabels === false ? '' : `<text x="${textX}" y="${textY}" text-anchor="${textAnchor}" dominant-baseline="${dominantBaseline}" font-family="Inter, Arial, sans-serif" font-size="13" font-weight="700" fill="${color}" stroke="#ffffff" stroke-width="3" paint-order="stroke">${text}</text>`}
    </g>`;
  }).join('\n');
  return `<g data-node-id="${escapeXml(el.id)}">
    <rect x="${el.x}" y="${el.y}" width="${w}" height="${h}" rx="10" fill="${background}" stroke="#d0d7de" />
    ${el.imageAssetRef ? `<text x="${el.x + 14}" y="${el.y + 24}" font-family="Inter, Arial, sans-serif" font-size="13" fill="#64748b">image: ${escapeXml(el.imageAssetRef.project)}/${escapeXml(el.imageAssetRef.assetId)}</text>` : ''}
    ${boxes}
    <text x="${el.x + 14}" y="${el.y + h - 12}" font-family="Inter, Arial, sans-serif" font-size="13" font-weight="700" fill="#0f172a">${label}</text>
  </g>`;
}

function renderPathOverlayCard(el: PathOverlayElement): string {
  const w = elementWidth(el);
  const h = elementHeight(el);
  const label = escapeXml(el.caption ?? el.alt ?? el.id);
  const background = escapeXml(el.background ?? '#f8fafc');
  const legend = el.showLabels === false ? '' : el.paths.map((path, index) => {
    const color = escapeXml(path.color ?? overlayAccent(index));
    const text = escapeXml(path.label ?? path.id);
    const x = el.x + 14;
    const y = el.y + h - 16 - (el.paths.length - index - 1) * 16;
    return `<g data-legend-for="${escapeXml(path.id)}">
      <circle cx="${x + 6}" cy="${y - 4}" r="5" fill="${color}" />
      <text x="${x + 18}" y="${y}" font-family="Inter, Arial, sans-serif" font-size="12" fill="#475569">${text}</text>
    </g>`;
  }).join('\n');
  const paths = el.paths.map((path, index) => {
    const color = escapeXml(path.color ?? overlayAccent(index));
    return `<path data-path-id="${escapeXml(path.id)}" d="${escapeXml(path.d)}" fill="${escapeXml(path.fill ?? 'transparent')}" stroke="${color}" stroke-width="${path.strokeWidth ?? 2}" stroke-linejoin="round" stroke-linecap="round" />`;
  }).join('\n');
  const scaleX = w / el.canvasWidth;
  const scaleY = h / el.canvasHeight;
  return `<g data-node-id="${escapeXml(el.id)}">
    <rect x="${el.x}" y="${el.y}" width="${w}" height="${h}" rx="10" fill="${background}" stroke="#d0d7de" />
    <g transform="translate(${el.x} ${el.y}) scale(${scaleX} ${scaleY})">
      ${paths}
    </g>
    ${legend}
    <text x="${el.x + 14}" y="${el.y + 24}" font-family="Inter, Arial, sans-serif" font-size="13" font-weight="700" fill="#0f172a">${label}</text>
  </g>`;
}

function renderCard(el: CanvasElement): string {
  if (el.type === 'bboxOverlay') return renderBBoxOverlayCard(el);
  if (el.type === 'pathOverlay') return renderPathOverlayCard(el);
  const w = elementWidth(el);
  const h = elementHeight(el);
  const radius = el.type === 'shape' && el.shape === 'ellipse' ? Math.min(w, h) / 2 : 10;
  const fill = el.type === 'asset' || el.type === 'glbViewer' || el.type === 'video' ? '#f8fafc' : '#ffffff';
  const stroke = el.type === 'shape' ? '#64748b' : '#d0d7de';
  const titleSize = 18;
  const bodySize = 13;
  const maxChars = Math.max(12, Math.floor(w / 7.2));
  const rawLines = textLinesForElement(el);
  const lines = rawLines.flatMap((line, idx) => wrapText(line, idx === 0 ? Math.max(8, Math.floor(w / 10)) : maxChars)).slice(0, Math.max(3, Math.floor((h - 36) / 17)));
  const body = lines.map((line, idx) => {
    const y = el.y + 24 + idx * 17;
    const size = idx === 0 && (el.type === 'markdown' || el.type === 'text') ? titleSize : bodySize;
    const weight = idx === 0 ? 700 : 400;
    return `<text x="${el.x + 14}" y="${y}" font-family="Inter, Arial, sans-serif" font-size="${size}" font-weight="${weight}" fill="#0f172a">${escapeXml(line)}</text>`;
  }).join('\n');

  return `<g data-node-id="${escapeXml(el.id)}">
    <rect x="${el.x}" y="${el.y}" width="${w}" height="${h}" rx="${radius}" fill="${fill}" stroke="${stroke}" />
    ${body}
  </g>`;
}

function renderConnector(canvas: CanvasRecord, el: LineElement): string {
  const from = endpointPoint(canvas, el.from);
  const to = endpointPoint(canvas, el.to);
  const marker = el.type === 'arrow' ? ' marker-end="url(#arrowhead)"' : '';
  return `<line data-node-id="${escapeXml(el.id)}" x1="${from.x}" y1="${from.y}" x2="${to.x}" y2="${to.y}" stroke="${escapeXml(el.stroke ?? '#4f46e5')}" stroke-width="${finiteNumber(el.strokeWidth, 2)}"${marker} />`;
}

function renderNodeIdOverlay(el: CanvasElement): string {
  const w = elementWidth(el);
  const label = escapeXml(el.id);
  const x = el.x + Math.min(10, Math.max(4, w - 40));
  const y = el.y - 8;
  const labelWidth = Math.max(36, el.id.length * 7 + 14);
  return `<g class="node-id-overlay" data-overlay-for="${label}">
    <rect x="${x}" y="${y - 16}" width="${labelWidth}" height="20" rx="6" fill="#111827" opacity="0.9" />
    <text x="${x + 7}" y="${y - 2}" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="12" fill="#ffffff">${label}</text>
  </g>`;
}

export function renderCanvasScreenshotSvg(canvas: CanvasRecord, options: CanvasScreenshotOptions = {}): RenderedCanvasScreenshot {
  const width = Math.round(clamp(finiteNumber(options.width, DEFAULT_WIDTH), 320, 4096));
  const height = Math.round(clamp(finiteNumber(options.height, DEFAULT_HEIGHT), 240, 4096));
  const padding = finiteNumber(options.padding, DEFAULT_PADDING);
  const viewBox = options.fullCanvas ? computeFullViewBox(canvas, padding) : computeViewportViewBox({ ...options, width, height });
  const connectors = canvas.elements.filter((el): el is LineElement => el.type === 'line' || el.type === 'arrow');
  const cards = cardElements(canvas);
  const overlayNodeIds = Boolean(options.overlayNodeIds);

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}">
  <defs>
    <filter id="cardShadow" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="8" stdDeviation="10" flood-color="#0f172a" flood-opacity="0.12" /></filter>
    <marker id="arrowhead" markerWidth="10" markerHeight="7" refX="10" refY="3.5" orient="auto"><polygon points="0 0, 10 3.5, 0 7" fill="#4f46e5" /></marker>
  </defs>
  <rect x="${viewBox.x}" y="${viewBox.y}" width="${viewBox.width}" height="${viewBox.height}" fill="#f8fafc" />
  <g opacity="0.35" stroke="#e2e8f0" stroke-width="1">
    <path d="M ${viewBox.x} 0 H ${viewBox.x + viewBox.width}" />
    <path d="M 0 ${viewBox.y} V ${viewBox.y + viewBox.height}" />
  </g>
  <g class="connectors">${connectors.map((el) => renderConnector(canvas, el)).join('\n')}</g>
  <g class="cards" filter="url(#cardShadow)">${cards.map(renderCard).join('\n')}</g>
  ${overlayNodeIds ? `<g class="node-id-overlays">${cards.map(renderNodeIdOverlay).join('\n')}</g>` : ''}
</svg>`;

  return { svg, width, height, viewBox, overlayNodeIds };
}

export function screenshotDataUrl(svg: string): string {
  return `data:image/svg+xml;base64,${Buffer.from(svg, 'utf-8').toString('base64')}`;
}

export function coerceScreenshotOptions(input: Partial<CanvasScreenshotOptions & CanvasViewportInput> | null | undefined): CanvasScreenshotOptions {
  return {
    width: finiteNumber(input?.width, DEFAULT_WIDTH),
    height: finiteNumber(input?.height, DEFAULT_HEIGHT),
    centerX: finiteNumber(input?.centerX, 0),
    centerY: finiteNumber(input?.centerY, 0),
    zoom: clamp(finiteNumber(input?.zoom, 1), 0.05, 8),
    fullCanvas: Boolean(input?.fullCanvas),
    overlayNodeIds: Boolean(input?.overlayNodeIds),
    padding: finiteNumber(input?.padding, DEFAULT_PADDING)
  };
}
