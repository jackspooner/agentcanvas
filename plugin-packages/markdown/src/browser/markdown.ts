const HTML_ESCAPE = /[&<>"']/g;
const HTML_ENTITIES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

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
  let value = escapeHtml(source);
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
  value = value
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/__([^_]+)__/g, '<strong>$1</strong>')
    .replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '<em>$1</em>');
  return value;
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

export interface MarkdownRenderOptions {
  allowImages?: boolean;
}

export function renderSafeMarkdown(markdown: string, options: MarkdownRenderOptions = {}): string {
  const allowImages = options.allowImages !== false;
  const lines = markdown.replaceAll('\r\n', '\n').split('\n');
  const output: string[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (line.startsWith('```')) {
      const language = line.slice(3).trim();
      const code: string[] = [];
      index += 1;
      while (index < lines.length && !lines[index].startsWith('```')) code.push(lines[index++]);
      if (index < lines.length) index += 1;
      output.push(
        `<pre><code${language ? ` data-language="${escapeHtml(language)}"` : ''}>${escapeHtml(code.join('\n'))}</code></pre>`
      );
      continue;
    }
    if (index + 1 < lines.length && line.includes('|') && isTableDivider(lines[index + 1])) {
      const headers = tableCells(line);
      index += 2;
      const rows: string[][] = [];
      while (index < lines.length && lines[index].includes('|') && lines[index].trim())
        rows.push(tableCells(lines[index++]));
      output.push(
        `<table><thead><tr>${headers.map((cell) => `<th>${inlineMarkdown(cell, allowImages)}</th>`).join('')}</tr></thead><tbody>${rows.map((row) => `<tr>${headers.map((_header, cellIndex) => `<td>${inlineMarkdown(row[cellIndex] ?? '', allowImages)}</td>`).join('')}</tr>`).join('')}</tbody></table>`
      );
      continue;
    }
    const heading = /^(#{1,6})\s+(.+)$/.exec(line);
    if (heading) {
      const level = heading[1].length;
      output.push(`<h${level}>${inlineMarkdown(heading[2], allowImages)}</h${level}>`);
      index += 1;
      continue;
    }
    if (/^[-*+]\s+/.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^[-*+]\s+/.test(lines[index]))
        items.push(lines[index++].replace(/^[-*+]\s+/, ''));
      output.push(`<ul>${items.map((item) => `<li>${inlineMarkdown(item, allowImages)}</li>`).join('')}</ul>`);
      continue;
    }
    if (/^\d+[.)]\s+/.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^\d+[.)]\s+/.test(lines[index]))
        items.push(lines[index++].replace(/^\d+[.)]\s+/, ''));
      output.push(`<ol>${items.map((item) => `<li>${inlineMarkdown(item, allowImages)}</li>`).join('')}</ol>`);
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
    output.push(`<p>${paragraph.map((line) => inlineMarkdown(line, allowImages)).join('<br>')}</p>`);
  }
  return output.join('\n');
}

export interface MarkdownProjectionLine {
  text: string;
  role: 'heading' | 'body' | 'code' | 'table';
  depth: number;
}

export function projectMarkdown(markdown: string): MarkdownProjectionLine[] {
  const result: MarkdownProjectionLine[] = [];
  let inCode = false;
  for (const rawLine of markdown.replaceAll('\r\n', '\n').split('\n')) {
    if (rawLine.startsWith('```')) {
      inCode = !inCode;
      continue;
    }
    if (!rawLine.trim()) continue;
    const heading = /^(#{1,6})\s+(.+)$/.exec(rawLine);
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
      role: inCode ? 'code' : heading ? 'heading' : rawLine.includes('|') ? 'table' : 'body',
      depth: heading?.[1].length ?? 0
    });
    if (result.length >= 200) break;
  }
  return result;
}
