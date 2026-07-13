import type {
  BrowserElementRenderer,
  MountedBrowserElementRenderer,
  PluginDiagnostic,
  RendererContext
} from '@agentcanvas/plugin-sdk';
import { browserRendererDiagnostic, renderBrowserDiagnosticCard } from './diagnostics.js';

export type RendererContextInput = Omit<RendererContext, 'signal'>;

export interface ShadowRendererHostOptions {
  reportDiagnostic?(diagnostic: PluginDiagnostic): void;
}

const rootOwners = new WeakMap<ShadowRoot, ShadowRendererHost>();

/** Owns one plugin renderer mount and serializes its asynchronous lifecycle. */
export class ShadowRendererHost {
  readonly root: ShadowRoot;
  private mounted: MountedBrowserElementRenderer | null = null;
  private renderer: BrowserElementRenderer | null = null;
  private controller: AbortController | null = null;
  private pendingContext: RendererContextInput | null = null;
  private updateTask: Promise<void> | null = null;
  private disposed = false;
  private failed = false;

  constructor(
    outerFrame: HTMLElement,
    private readonly options: ShadowRendererHostOptions = {}
  ) {
    this.root = outerFrame.shadowRoot ?? outerFrame.attachShadow({ mode: 'open' });
    rootOwners.set(this.root, this);
  }

  async mount(renderer: BrowserElementRenderer | undefined, context: RendererContextInput): Promise<void> {
    if (this.disposed) throw new Error('Renderer host is disposed');
    if (this.mounted || this.renderer) throw new Error('Renderer host is already mounted');
    if (!renderer?.schemaVersions.includes(context.element.schemaVersion)) {
      this.showFailure('missing', context);
      return;
    }
    this.renderer = renderer;
    this.controller = new AbortController();
    try {
      this.mounted = renderer.mount(this.root, { ...context, signal: this.controller.signal });
    } catch {
      this.showFailure('failed', context);
    }
  }

  update(context: RendererContextInput): Promise<void> {
    if (this.disposed || this.failed) return Promise.resolve();
    if (!this.mounted) return Promise.resolve();
    this.pendingContext = context;
    this.controller?.abort();
    if (!this.updateTask) this.updateTask = this.flushUpdates();
    return this.updateTask;
  }

  private async flushUpdates(): Promise<void> {
    while (this.pendingContext && this.mounted && !this.disposed) {
      const context = this.pendingContext;
      this.pendingContext = null;
      const controller = new AbortController();
      this.controller = controller;
      try {
        await this.mounted.update({ ...context, signal: controller.signal });
      } catch {
        if (!controller.signal.aborted) {
          this.showFailure('failed', context);
          break;
        }
      }
    }
    this.updateTask = null;
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.pendingContext = null;
    this.controller?.abort();
    const mounted = this.mounted;
    this.mounted = null;
    this.renderer = null;
    try {
      await mounted?.dispose();
    } catch {
      const diagnostic: PluginDiagnostic = {
        code: 'browser_renderer_dispose_failed',
        severity: 'warning',
        message: 'Renderer disposal failed.',
        retryable: false
      };
      this.options.reportDiagnostic?.(diagnostic);
    } finally {
      if (rootOwners.get(this.root) === this) {
        rootOwners.delete(this.root);
        this.root.replaceChildren();
      }
    }
  }

  private showFailure(status: 'missing' | 'failed', context: RendererContextInput): void {
    this.controller?.abort();
    this.failed = true;
    const diagnostic = browserRendererDiagnostic(status, context.element.type, context.element.id);
    this.options.reportDiagnostic?.(diagnostic);
    context.reportDiagnostic(diagnostic);
    renderBrowserDiagnosticCard(this.root, diagnostic);
  }
}
