import { describe, expect, it } from 'vitest';
import { projectMarkdown, renderSafeMarkdown, safeLinkHref } from '../src/markdown.js';

describe('safe Markdown rendering', () => {
  it('renders headings, GFM tables, lists, and fenced code', () => {
    const html = renderSafeMarkdown('# Title\n\n- item\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\n```js\nalert(1)\n```');
    expect(html).toContain('<h1>Title</h1>');
    expect(html).toContain('<ul><li>item</li></ul>');
    expect(html).toContain('<table>');
    expect(html).toContain('data-language="js"');
  });

  it('escapes raw HTML, removes image sources, and rejects unsafe links', () => {
    const html = renderSafeMarkdown(
      '<script>alert(1)</script> ![secret](https://example.test/image.png) [bad](javascript:alert(1))'
    );
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('javascript:');
    expect(html).toContain('&lt;script&gt;');
    expect(safeLinkHref('https://example.test')).toBe('https://example.test');
  });

  it('creates a deterministic semantic snapshot projection', () => {
    expect(projectMarkdown('# Heading\n\nBody **strong**')).toEqual([
      { text: 'Heading', role: 'heading', depth: 1 },
      { text: 'Body strong', role: 'body', depth: 0 }
    ]);
  });
});
