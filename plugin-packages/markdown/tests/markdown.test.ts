import { describe, expect, it } from 'vitest';
import { projectMarkdown, renderSafeMarkdown, safeImageHref, safeLinkHref } from '../src/markdown.js';

describe('safe Markdown rendering', () => {
  it('renders headings, GFM tables, lists, and fenced code', () => {
    const html = renderSafeMarkdown('# Title\n\n- item\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\n```js\nalert(1)\n```');
    expect(html).toContain('<h1>Title</h1>');
    expect(html).toContain('<ul><li>item</li></ul>');
    expect(html).toContain('<table>');
    expect(html).toContain('data-language="js"');
  });

  it('renders safe image URLs by default and rejects unsafe links and image schemes', () => {
    const html = renderSafeMarkdown(
      '<script>alert(1)</script> ![secret](https://example.test/image.png "title") [bad](javascript:alert(1))'
    );
    expect(html).not.toContain('<script>');
    expect(html).toContain('<img src="https://example.test/image.png" alt="secret"');
    expect(html).not.toContain('javascript:');
    expect(html).toContain('&lt;script&gt;');
    expect(safeLinkHref('https://example.test')).toBe('https://example.test');
    expect(safeImageHref('file:///Users/example/image.png')).toBeNull();
    expect(safeImageHref('data:image/png;base64,abc')).toBeNull();
    expect(safeImageHref('//evil.example/image.png')).toBeNull();
    expect(safeImageHref('/images/local.png')).toBe('/images/local.png');
    expect(renderSafeMarkdown('![local](/images/local.png)')).toContain('src="/images/local.png"');
  });

  it('can disable embedded images while preserving their alt text', () => {
    const html = renderSafeMarkdown('![secret](https://example.test/image.png)', { allowImages: false });
    expect(html).not.toContain('<img');
    expect(html).toContain('secret');
  });

  it('renders common Markdown character references without allowing raw HTML', () => {
    const html = renderSafeMarkdown('Research &amp; Planning&nbsp;|&nbsp;&lt;safe&gt;');
    expect(html).toContain('Research &amp; Planning\u00a0|\u00a0&lt;safe&gt;');
    expect(html).not.toContain('<safe>');
  });

  it('creates a deterministic semantic snapshot projection', () => {
    expect(projectMarkdown('# Heading\n\nBody **strong**')).toEqual([
      { text: 'Heading', role: 'heading', depth: 1 },
      { text: 'Body strong', role: 'body', depth: 0 }
    ]);
  });
});
