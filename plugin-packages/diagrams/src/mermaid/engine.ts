import { type CanvasThemeV1, DEFAULT_CANVAS_THEME } from '@agentcanvas/extension-sdk';
import mermaid from 'mermaid';

export { MermaidSourceError, validateMermaidSource } from './policy.js';

import { MermaidSourceError, validateMermaidSource } from './policy.js';

let queue: Promise<unknown> = Promise.resolve();

/** Mermaid owns mutable global configuration; all parse/render/DB reads share this queue. */
export function withMermaid<T>(
  source: string,
  theme: Readonly<CanvasThemeV1>,
  signal: AbortSignal | undefined,
  run: (api: typeof mermaid) => Promise<T>
): Promise<T> {
  const job = queue.then(async () => {
    signal?.throwIfAborted();
    const issues = validateMermaidSource(source);
    if (issues.length) throw new MermaidSourceError(issues);
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      suppressErrorRendering: true,
      htmlLabels: false,
      theme: 'base',
      fontFamily: theme.typography.bodyFont,
      maxTextSize: 20_000,
      maxEdges: 500,
      flowchart: { htmlLabels: false },
      themeVariables: {
        background: theme.colors.canvas,
        primaryColor: theme.colors.surface,
        primaryTextColor: theme.colors.text,
        primaryBorderColor: theme.colors.border,
        lineColor: theme.colors.textMuted,
        secondaryColor: theme.colors.surfaceMuted,
        tertiaryColor: theme.colors.highlight,
        fontFamily: theme.typography.bodyFont
      }
    });
    try {
      const value = await run(mermaid);
      signal?.throwIfAborted();
      return value;
    } catch (error) {
      if (signal?.aborted || error instanceof MermaidSourceError) throw error;
      throw new MermaidSourceError([
        { path: '/source', code: 'mermaid.parse', message: error instanceof Error ? error.message : String(error) }
      ]);
    }
  });
  queue = job.catch(() => undefined);
  return job;
}

export function parseMermaidSource(
  source: string,
  theme: Readonly<CanvasThemeV1> = DEFAULT_CANVAS_THEME,
  signal?: AbortSignal
): Promise<{ diagramType: string }> {
  return withMermaid(source, theme, signal, async (api) => {
    const result = await api.parse(source);
    if (!result) throw new Error('Mermaid did not return a parse result.');
    return { diagramType: result.diagramType };
  });
}

export function renderMermaid(
  source: string,
  theme: Readonly<CanvasThemeV1>,
  signal?: AbortSignal
): Promise<{ svg: string; diagramType: string; width: number; height: number }> {
  return withMermaid(source, theme, signal, async (api) => {
    const scratch = document.createElement('div');
    scratch.style.cssText = 'position:fixed;left:-100000px;top:0;width:4096px;visibility:hidden';
    document.body.append(scratch);
    try {
      const result = await api.render(
        `diagram-${crypto.getRandomValues(new Uint32Array(4)).join('-')}`,
        source,
        scratch
      );
      scratch.innerHTML = result.svg;
      const svg = scratch.querySelector('svg');
      if (!svg) throw new Error('Mermaid returned no SVG.');
      for (const element of svg.querySelectorAll('script,foreignObject,image,a')) element.remove();
      for (const element of [svg, ...svg.querySelectorAll('*')]) {
        for (const attribute of [...element.attributes]) {
          if (/^on/i.test(attribute.name) || (/href$/i.test(attribute.name) && !attribute.value.startsWith('#')))
            element.removeAttribute(attribute.name);
        }
      }
      const box = svg.viewBox.baseVal;
      if (!(box.width > 0 && box.height > 0)) throw new Error('Mermaid returned invalid SVG bounds.');
      return { svg: svg.outerHTML, diagramType: result.diagramType, width: box.width, height: box.height };
    } finally {
      scratch.remove();
    }
  });
}
