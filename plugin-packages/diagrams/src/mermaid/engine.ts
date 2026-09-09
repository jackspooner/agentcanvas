import { type CanvasThemeV1, DEFAULT_CANVAS_THEME } from '@agentcanvas/extension-sdk';
import mermaid from 'mermaid';
import type { MermaidLayout, MermaidPresentation } from '../contracts.js';
import { presentGraph } from './presentation.js';
import { presentSequence } from './sequence-presentation.js';

export { MermaidSourceError, validateMermaidSource } from './policy.js';

import { MermaidSourceError, validateMermaidSource, validateMermaidData } from './policy.js';

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
  signal?: AbortSignal,
  presentation?: MermaidPresentation,
  includeLayout = false
): Promise<{ svg: string; diagramType: string; width: number; height: number; layout?: MermaidLayout }> {
  return withMermaid(source, theme, signal, async (api) => {
    const issues = validateMermaidData({ title: '', source, ...(presentation ? { presentation } : {}) });
    if (issues.length) throw new MermaidSourceError(issues);
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
      let layout: MermaidLayout | undefined;
      if (presentation || includeLayout) {
        const diagram = await api.mermaidAPI.getDiagramFromText(source);
        const db = diagram.db as unknown as { getData?: () => unknown };
        if (result.diagramType === 'sequence') layout = presentSequence(svg, presentation);
        else {
          if (!db.getData) throw new Error('Mermaid graph data is unavailable.');
          layout = presentGraph(svg, db.getData(), presentation);
        }
        const bounds = svg.getBBox();
        svg.setAttribute('viewBox', `${bounds.x - 16} ${bounds.y - 16} ${bounds.width + 32} ${bounds.height + 32}`);
      }
      return {
        svg: svg.outerHTML,
        diagramType: result.diagramType,
        width: svg.viewBox.baseVal.width,
        height: svg.viewBox.baseVal.height,
        ...(layout ? { layout } : {})
      };
    } finally {
      scratch.remove();
    }
  });
}
