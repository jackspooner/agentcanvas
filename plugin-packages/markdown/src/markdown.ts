const HTML_ESCAPE = /[&<>"']/g;
const HTML_ENTITIES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const MARKDOWN_CHARACTER_REFERENCES: Record<string, string> = {
  amp: '&',
  apos: "'",
  gt: '>',
  lt: '<',
  nbsp: '\u00a0',
  quot: '"'
};

export type MarkdownBlock =
  | { type: 'code'; language: string; lines: string[]; sourceLines: string[] }
  | { type: 'table'; headers: string[]; rows: string[][]; sourceLines: string[] }
  | { type: 'heading'; level: number; text: string; sourceLines: string[] }
  | { type: 'list'; ordered: boolean; items: string[]; sourceLines: string[] }
  | { type: 'paragraph'; lines: string[]; sourceLines: string[] };

export interface MarkdownLayoutStyle {
  fontSize?: number | null;
  padding?: number | null;
  borderWidth?: number | null;
  border?: string | null;
}

export function escapeHtml(value: string): string {
  return value.replace(HTML_ESCAPE, (character) => HTML_ENTITIES[character] ?? character);
}

export function safeLinkHref(value: string): string | null {
  const href = value.trim();
  if (/^(?:https?:|mailto:)/i.test(href)) return href;
  if (/^(?:#|\/|\.\/|\.\.\/)/.test(href)) return href;
  return null;
}

/** Returns only browser-loadable HTTP(S) or same-origin relative image URLs. */
export function safeImageHref(value: string): string | null {
  const href = value.trim();
  if (/^\/\//.test(href)) return null;
  if (/^https?:\/\//i.test(href)) {
    try {
      const url = new URL(href);
      if (url.username || url.password) return null;
      return url.href;
    } catch {
      return null;
    }
  }
  if (/^(?:\/|\.\/|\.\.\/)/.test(href)) return href;
  return null;
}

function inlineMarkdown(source: string, allowImages: boolean): string {
  let value = escapeHtml(
    source.replace(
      /&(amp|apos|gt|lt|nbsp|quot);/giu,
      (entity, name: string) => MARKDOWN_CHARACTER_REFERENCES[name.toLowerCase()] ?? entity
    )
  );
  value = value.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+[^)]*)?\)/g, (_match, alt: string, escapedHref: string) => {
    const href = safeImageHref(escapedHref.replaceAll('&amp;', '&'));
    if (!allowImages || !href) return alt;
    return `<img src="${escapeHtml(href)}" alt="${alt}" loading="lazy" decoding="async" referrerpolicy="no-referrer">`;
  });
  value = value.replace(/`([^`]+)`/g, '<code>$1</code>');
  value = value.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_match, label: string, rawHref: string) => {
    const href = safeLinkHref(rawHref.replaceAll('&amp;', '&'));
    return href ? `<a href="${escapeHtml(href)}" target="_blank" rel="noreferrer noopener">${label}</a>` : label;
  });
  return value
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/__([^_]+)__/g, '<strong>$1</strong>')
    .replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '<em>$1</em>');
}

function isTableDivider(line: string): boolean {
  const cells = line
    .trim()
    .replace(/^\||\|$/g, '')
    .split('|');
  return cells.length > 0 && cells.every((cell) => /^\s*:?-{3,}:?\s*$/.test(cell));
}

function tableCells(line: string): string[] {
  return line
    .trim()
    .replace(/^\||\|$/g, '')
    .split('|')
    .map((cell) => cell.trim());
}

/** Parses the Markdown subset shared by rendering, snapshots, and frame estimation. */
export function parseMarkdown(markdown: string): MarkdownBlock[] {
  const lines = markdown.replaceAll('\r\n', '\n').split('\n');
  const blocks: MarkdownBlock[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (line.startsWith('```')) {
      const language = line.slice(3).trim();
      const code: string[] = [];
      index += 1;
      while (index < lines.length && !lines[index].startsWith('```')) code.push(lines[index++]);
      if (index < lines.length) index += 1;
      blocks.push({ type: 'code', language, lines: code, sourceLines: code });
      continue;
    }
    if (index + 1 < lines.length && line.includes('|') && isTableDivider(lines[index + 1])) {
      const headers = tableCells(line);
      const sourceLines = [line, lines[index + 1]];
      index += 2;
      const rows: string[][] = [];
      while (index < lines.length && lines[index].includes('|') && lines[index].trim()) {
        sourceLines.push(lines[index]);
        rows.push(tableCells(lines[index++]));
      }
      blocks.push({ type: 'table', headers, rows, sourceLines });
      continue;
    }
    const heading = /^(#{1,6})\s+(.+)$/.exec(line);
    if (heading) {
      blocks.push({ type: 'heading', level: heading[1].length, text: heading[2], sourceLines: [line] });
      index += 1;
      continue;
    }
    if (/^[-*+]\s+/.test(line)) {
      const items: string[] = [];
      const sourceLines: string[] = [];
      while (index < lines.length && /^[-*+]\s+/.test(lines[index])) {
        sourceLines.push(lines[index]);
        items.push(lines[index++].replace(/^[-*+]\s+/, ''));
      }
      blocks.push({ type: 'list', ordered: false, items, sourceLines });
      continue;
    }
    if (/^\d+[.)]\s+/.test(line)) {
      const items: string[] = [];
      const sourceLines: string[] = [];
      while (index < lines.length && /^\d+[.)]\s+/.test(lines[index])) {
        sourceLines.push(lines[index]);
        items.push(lines[index++].replace(/^\d+[.)]\s+/, ''));
      }
      blocks.push({ type: 'list', ordered: true, items, sourceLines });
      continue;
    }
    if (!line.trim()) {
      index += 1;
      continue;
    }
    const paragraph = [line];
    index += 1;
    while (index < lines.length && lines[index].trim() && !/^(?:#{1,6}\s|```|[-*+]\s+|\d+[.)]\s+)/.test(lines[index])) {
      if (index + 1 < lines.length && isTableDivider(lines[index + 1])) break;
      paragraph.push(lines[index++]);
    }
    blocks.push({ type: 'paragraph', lines: paragraph, sourceLines: paragraph });
  }
  return blocks;
}

export interface MarkdownRenderOptions {
  allowImages?: boolean;
}

export function renderSafeMarkdown(markdown: string, options: MarkdownRenderOptions = {}): string {
  const allowImages = options.allowImages !== false;
  return parseMarkdown(markdown)
    .map((block) => {
      if (block.type === 'code')
        return `<pre><code${block.language ? ` data-language="${escapeHtml(block.language)}"` : ''}>${escapeHtml(block.lines.join('\n'))}</code></pre>`;
      if (block.type === 'table')
        return `<table><thead><tr>${block.headers.map((cell) => `<th>${inlineMarkdown(cell, allowImages)}</th>`).join('')}</tr></thead><tbody>${block.rows.map((row) => `<tr>${block.headers.map((_header, cellIndex) => `<td>${inlineMarkdown(row[cellIndex] ?? '', allowImages)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
      if (block.type === 'heading')
        return `<h${block.level}>${inlineMarkdown(block.text, allowImages)}</h${block.level}>`;
      if (block.type === 'list') {
        const tag = block.ordered ? 'ol' : 'ul';
        return `<${tag}>${block.items.map((item) => `<li>${inlineMarkdown(item, allowImages)}</li>`).join('')}</${tag}>`;
      }
      return `<p>${block.lines.map((line) => inlineMarkdown(line, allowImages)).join('<br>')}</p>`;
    })
    .join('\n');
}

function visibleText(source: string): string {
  return source
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[*_`]/g, '')
    .replace(/<[^>]*>/g, '')
    .trim();
}

function wrappedLines(text: string, width: number, fontSize: number): number {
  const charactersPerLine = Math.max(1, Math.floor(width / (fontSize * 0.62)));
  return Math.max(1, Math.ceil(Array.from(visibleText(text)).length / charactersPerLine));
}

function positive(value: number | null | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback;
}

function resolvedBorderWidth(style: MarkdownLayoutStyle): number {
  const shorthand = typeof style.border === 'string' ? /^\s*(\d+(?:\.\d+)?)px\b/u.exec(style.border) : null;
  return shorthand ? Number(shorthand[1]) : positive(style.borderWidth, 1);
}

/** Returns a conservative, uncapped frame height for the browser renderer's CSS. */
export function requiredMarkdownHeight(markdown: string, width: number, style: MarkdownLayoutStyle = {}): number {
  const fontSize = Math.max(1, positive(style.fontSize, 14));
  const padding = positive(style.padding, 14);
  const border = resolvedBorderWidth(style);
  const contentWidth = Math.max(1, width - 2 * (padding + border));
  const lineHeight = fontSize * 1.5;
  let height = 2 * (padding + border) + lineHeight;

  for (const block of parseMarkdown(markdown)) {
    if (block.type === 'heading') {
      const scale = [2, 1.5, 1.17, 1, 0.83, 0.67][block.level - 1] ?? 1;
      const headingSize = fontSize * scale;
      height += wrappedLines(block.text, contentWidth, headingSize) * headingSize * 1.2 + headingSize * 1.05;
    } else if (block.type === 'paragraph') {
      for (const line of block.lines) {
        const imageCount = line.match(/!\[[^\]]*\]\([^)]*\)/gu)?.length ?? 0;
        if (imageCount) height += imageCount * Math.min(360, Math.max(220, contentWidth * 0.6));
        if (visibleText(line)) height += wrappedLines(line, contentWidth, fontSize) * lineHeight;
      }
      height += fontSize * 1.1;
    } else if (block.type === 'list') {
      const itemWidth = Math.max(1, contentWidth - 24);
      height +=
        block.items.reduce((total, item) => total + wrappedLines(item, itemWidth, fontSize) * lineHeight, 0) +
        fontSize * 2;
    } else if (block.type === 'table') {
      const cellWidth = Math.max(1, contentWidth / Math.max(1, block.headers.length) - 17);
      for (const row of [block.headers, ...block.rows])
        height += Math.max(1, ...row.map((cell) => wrappedLines(cell, cellWidth, fontSize))) * lineHeight + 12.2;
    } else {
      height += Math.max(1, block.lines.length) * lineHeight + 22.4 + fontSize * 2;
    }
  }
  return Math.max(80, Math.ceil(height));
}

export interface MarkdownProjectionLine {
  text: string;
  role: 'heading' | 'body' | 'code' | 'table';
  depth: number;
}

export function projectMarkdown(markdown: string): MarkdownProjectionLine[] {
  const result: MarkdownProjectionLine[] = [];
  for (const block of parseMarkdown(markdown)) {
    for (const rawLine of block.sourceLines) {
      if (!rawLine.trim()) continue;
      const heading = block.type === 'heading' ? /^(#{1,6})\s+(.+)$/.exec(rawLine) : null;
      const text = (heading?.[2] ?? rawLine)
        .replace(/^[-*+]\s+/, '• ')
        .replace(/^\d+[.)]\s+/, '')
        .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
        .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
        .replace(/[*_`]/g, '')
        .replace(/<[^>]*>/g, '')
        .trim();
      if (!text) continue;
      result.push({
        text,
        role:
          block.type === 'code'
            ? 'code'
            : block.type === 'heading'
              ? 'heading'
              : block.type === 'table' || rawLine.includes('|')
                ? 'table'
                : 'body',
        depth: heading?.[1].length ?? 0
      });
      if (result.length >= 200) return result;
    }
  }
  return result;
}
