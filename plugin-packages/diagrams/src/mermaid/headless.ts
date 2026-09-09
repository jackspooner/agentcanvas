import { readFile } from 'node:fs/promises';
import type { CanvasThemeV1 } from '@agentcanvas/extension-sdk';
import { chromium } from 'playwright';
import type { DiagramIssue, ErdData, MermaidLayout, MermaidPresentation } from '../contracts.js';
import { MermaidSourceError, validateMermaidSource } from './policy.js';

export interface MermaidPng {
  bytes: Uint8Array;
  width: number;
  height: number;
  diagnostics: DiagramIssue[];
}
type Result =
  | { diagramType: string; layout?: MermaidLayout }
  | { data: ErdData; warnings: DiagramIssue[] }
  | MermaidPng;
type Request =
  | { operation: 'parse'; source: string }
  | { operation: 'convert'; source: string }
  | {
      operation: 'layout' | 'validate-render';
      source: string;
      theme: Readonly<CanvasThemeV1>;
      presentation?: MermaidPresentation;
    }
  | {
      operation: 'png';
      source: string;
      theme: Readonly<CanvasThemeV1>;
      width: number;
      height: number;
      presentation?: MermaidPresentation;
    };
type Job = {
  key: string;
  request: Request;
  controller: AbortController;
  promise: Promise<Result>;
  resolve: (result: Result) => void;
  reject: (error: unknown) => void;
  subscribers: number;
  started: boolean;
  deadline: number;
  timer: ReturnType<typeof setTimeout>;
};
const pending: Job[] = [];
const jobs = new Map<string, Job>();
const cache = new Map<string, { result: Result; bytes: number }>();
let active = 0;
let cacheBytes = 0;

function error(code: string, message: string): MermaidSourceError {
  return new MermaidSourceError([{ path: '/source', code, message }]);
}

function drain(): void {
  while (active < 2 && pending.length) {
    const job = pending.shift();
    if (!job || job.controller.signal.aborted) continue;
    if (Date.now() >= job.deadline) {
      job.controller.abort(error('mermaid.headless.timeout', 'Mermaid job exceeded its 20 second deadline.'));
      continue;
    }
    active++;
    job.started = true;
    void execute(job.request, job.controller.signal, job.deadline)
      .then((result) => {
        job.controller.signal.throwIfAborted();
        const bytes = 'bytes' in result ? result.bytes.byteLength : JSON.stringify(result).length * 2;
        if (bytes <= 64 * 1024 * 1024) {
          cache.set(job.key, { result, bytes });
          cacheBytes += bytes;
          while (cache.size > 32 || cacheBytes > 64 * 1024 * 1024) {
            const oldest = cache.entries().next().value;
            if (!oldest) break;
            cacheBytes -= oldest[1].bytes;
            cache.delete(oldest[0]);
          }
        }
        job.resolve(result);
      })
      .catch(job.reject)
      .finally(() => {
        clearTimeout(job.timer);
        jobs.delete(job.key);
        active--;
        drain();
      });
  }
}

function request<T extends Result>(input: Request, signal?: AbortSignal): Promise<T> {
  signal?.throwIfAborted();
  const diagnostics = validateMermaidSource(input.source);
  if (diagnostics.length) return Promise.reject(new MermaidSourceError(diagnostics));
  const key = JSON.stringify({ engineVersion: '11.17.2', ...input });
  const hit = cache.get(key);
  if (hit) {
    cache.delete(key);
    cache.set(key, hit);
    return Promise.resolve(structuredClone(hit.result) as T);
  }
  let job = jobs.get(key);
  if (!job) {
    if (active >= 2 && pending.length >= 8)
      return Promise.reject(error('mermaid.headless.busy', 'Mermaid renderer queue is full.'));
    let resolve!: Job['resolve'];
    let reject!: Job['reject'];
    const promise = new Promise<Result>((ok, fail) => {
      resolve = ok;
      reject = fail;
    });
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(error('mermaid.headless.timeout', 'Mermaid job exceeded its 20 second deadline.')),
      20_000
    );
    job = {
      key,
      request: input,
      controller,
      promise,
      resolve,
      reject,
      subscribers: 0,
      started: false,
      timer,
      deadline: Date.now() + 20_000
    };
    const created = job;
    controller.signal.addEventListener(
      'abort',
      () => {
        created.reject(controller.signal.reason);
        if (!created.started) {
          const index = pending.indexOf(created);
          if (index >= 0) pending.splice(index, 1);
          jobs.delete(key);
          clearTimeout(timer);
        }
      },
      { once: true }
    );
    jobs.set(key, job);
    pending.push(job);
  }
  const current = job;
  current.subscribers++;
  const result = new Promise<T>((resolve, reject) => {
    let settled = false;
    const finish = (value?: Result, failure?: unknown) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener('abort', abort);
      current.subscribers--;
      if (failure !== undefined) reject(failure);
      else resolve(structuredClone(value) as T);
      if (!current.subscribers && jobs.has(key))
        current.controller.abort(error('mermaid.headless.cancelled', 'Mermaid job has no remaining callers.'));
    };
    const abort = () => finish(undefined, signal?.reason);
    signal?.addEventListener('abort', abort, { once: true });
    current.promise.then(
      (value) => finish(value),
      (failure) => finish(undefined, failure)
    );
  });
  drain();
  return result;
}

async function execute(input: Request, signal: AbortSignal, deadline: number): Promise<Result> {
  try {
    return await executeInChromium(input, signal, deadline);
  } catch (caught) {
    if (signal.aborted) throw signal.reason;
    if (caught instanceof MermaidSourceError) throw caught;
    if (caught instanceof Error && caught.name === 'TimeoutError')
      throw error('mermaid.headless.timeout', 'Mermaid job exceeded its 20 second deadline.');
    throw error(
      'mermaid.headless.failed',
      'Mermaid rendering failed. Verify the extension build and Chromium runtime, then retry.'
    );
  }
}

async function executeInChromium(input: Request, signal: AbortSignal, deadline: number): Promise<Result> {
  signal.throwIfAborted();
  const bundle = await readFile(new URL('./headless/engine.js', import.meta.url), 'utf8');
  signal.throwIfAborted();
  const browser = await chromium
    .launch({ headless: true, timeout: Math.max(1, deadline - Date.now()) })
    .catch((caught: unknown) => {
      if (signal.aborted) throw signal.reason;
      if (caught instanceof MermaidSourceError || (caught instanceof Error && caught.name === 'TimeoutError'))
        throw caught;
      throw error(
        'mermaid.headless.browser-unavailable',
        'Chromium could not start. Verify the pinned Playwright Chromium installation and process permissions, then retry.'
      );
    });
  let closing: Promise<void> | undefined;
  const close = () => (closing ??= browser.close());
  const abort = () => {
    // The finally boundary awaits this same promise and handles any cleanup failure.
    void close().catch(() => undefined);
  };
  signal.addEventListener('abort', abort, { once: true });
  try {
    signal.throwIfAborted();
    const context = await browser.newContext({
      acceptDownloads: false,
      deviceScaleFactor: 2,
      viewport: { width: 2048, height: 2048 },
      serviceWorkers: 'block'
    });
    await context.route('**/*', (route) => route.abort());
    const page = await context.newPage();
    await page.setContent('<!doctype html><html><body style="margin:0"></body></html>');
    await page.addScriptTag({ content: bundle });
    const value = await page.evaluate(async (request) => {
      type Engine = typeof import('./headless-entry.js') & {
        parseMermaidSource: typeof import('./engine.js')['parseMermaidSource'];
        extractErd: typeof import('./erd.js')['extractErd'];
        renderMermaid: typeof import('./engine.js')['renderMermaid'];
      };
      const engine = (globalThis as unknown as { AgentCanvasDiagramsEngine: Engine }).AgentCanvasDiagramsEngine;
      try {
        if (request.operation === 'parse') return { value: await engine.parseMermaidSource(request.source) };
        if (request.operation === 'convert') return { value: await engine.extractErd(request.source) };
        const rendered = await engine.renderMermaid(
          request.source,
          request.theme,
          undefined,
          request.presentation,
          request.operation === 'layout'
        );
        if (request.operation !== 'png')
          return {
            value: { diagramType: rendered.diagramType, ...(rendered.layout ? { layout: rendered.layout } : {}) }
          };
        const requestedScale = Math.min(request.width / rendered.width, request.height / rendered.height);
        const scale = Math.min(
          requestedScale,
          2048 / rendered.width,
          2048 / rendered.height,
          Math.sqrt(4_000_000 / (rendered.width * rendered.height))
        );
        const width = Math.max(1, Math.floor(rendered.width * scale));
        const height = Math.max(1, Math.floor(rendered.height * scale));
        const diagnostics: DiagramIssue[] =
          scale < requestedScale
            ? [
                {
                  path: '/dimensions',
                  code: 'mermaid.render.resolution-limit',
                  message: 'PNG resolution was reduced to stay within 4,096 pixels per side and 16 million pixels.'
                }
              ]
            : [];
        document.body.innerHTML = rendered.svg;
        document.body.style.background = request.theme.colors.canvas;
        const svg = document.querySelector('svg');
        if (!svg) throw new Error('Rendered SVG is missing.');
        svg.style.cssText = `display:block;width:${width}px;height:${height}px;max-width:none`;
        svg.setAttribute('width', String(width));
        svg.setAttribute('height', String(height));
        await document.fonts.ready;
        return { value: { width, height, diagnostics } };
      } catch (caught) {
        return {
          diagnostics: (caught as { diagnostics?: DiagramIssue[] }).diagnostics ?? [
            {
              path: '/source',
              code: 'mermaid.headless.failed',
              message: 'Mermaid rendering failed. Check the source and retry.'
            }
          ]
        };
      }
    }, input);
    if (value.diagnostics) throw new MermaidSourceError(value.diagnostics);
    if (input.operation !== 'png') return value.value as Result;
    const dimensions = value.value as { width: number; height: number; diagnostics: DiagramIssue[] };
    const bytes = await page.screenshot({
      type: 'png',
      clip: { x: 0, y: 0, width: dimensions.width, height: dimensions.height },
      animations: 'disabled'
    });
    return {
      bytes: new Uint8Array(bytes),
      width: dimensions.width * 2,
      height: dimensions.height * 2,
      diagnostics: dimensions.diagnostics
    };
  } finally {
    signal.removeEventListener('abort', abort);
    await close();
  }
}

export function validateMermaid(source: string, signal?: AbortSignal): Promise<{ diagramType: string }> {
  return request({ operation: 'parse', source }, signal);
}

export function convertMermaidErd(
  source: string,
  signal?: AbortSignal
): Promise<{ data: ErdData; warnings: DiagramIssue[] }> {
  return request({ operation: 'convert', source }, signal);
}

export function renderMermaidPng(
  source: string,
  theme: Readonly<CanvasThemeV1>,
  width: number,
  height: number,
  signal?: AbortSignal,
  presentation?: MermaidPresentation
): Promise<MermaidPng> {
  if (![width, height].every((value) => Number.isFinite(value) && value > 0))
    return Promise.reject(error('mermaid.render.dimensions', 'Snapshot dimensions must be positive finite numbers.'));
  return request({ operation: 'png', source, theme, width, height, ...(presentation ? { presentation } : {}) }, signal);
}
export function inspectMermaidLayout(
  source: string,
  theme: Readonly<CanvasThemeV1>,
  signal?: AbortSignal,
  presentation?: MermaidPresentation
): Promise<{ diagramType: string; layout: MermaidLayout }> {
  return request({ operation: 'layout', source, theme, ...(presentation ? { presentation } : {}) }, signal);
}
export function validateMermaidRender(
  source: string,
  theme: Readonly<CanvasThemeV1>,
  signal?: AbortSignal,
  presentation?: MermaidPresentation
): Promise<{ diagramType: string }> {
  return request({ operation: 'validate-render', source, theme, ...(presentation ? { presentation } : {}) }, signal);
}
