import type {
  BrowserElementRenderer,
  MountedBrowserElementRenderer,
  PluginDiagnostic,
  RendererContext
} from '@agentcanvas/plugin-sdk';
import { browserRendererDiagnostic, renderBrowserDiagnosticCard } from './diagnostics.js';
import {
  defaultRendererRuntimeEnvironment,
  type RendererActivityState,
  type RendererRuntimeEnvironment
} from './renderer-environment.js';
import { RendererFrameScope } from './renderer-frame-scheduler.js';

export type RendererContextInput = Omit<RendererContext, 'signal' | 'lifecycle' | 'frames'>;

export interface ShadowRendererHostOptions {
  reportDiagnostic?(diagnostic: PluginDiagnostic): void;
  environment?: RendererRuntimeEnvironment;
}

const rootOwners = new WeakMap<ShadowRoot, ShadowRendererHost>();

/** Owns one plugin renderer mount and serializes its asynchronous lifecycle. */
export class ShadowRendererHost {
  readonly root: ShadowRoot;
  private mounted: MountedBrowserElementRenderer | null = null;
  private renderer: BrowserElementRenderer | null = null;
  private controller: AbortController | null = null;
  private pendingContext: RendererContextInput | null = null;
  private latestContext: RendererContextInput | null = null;
  private updateTask: Promise<void> | null = null;
  private readonly lifetimeController = new AbortController();
  private readonly frames: RendererFrameScope;
  private unregisterActivity: (() => void) | null = null;
  private active = false;
  private reducedMotion = false;
  private disposed = false;
  private failed = false;

  constructor(
    outerFrame: HTMLElement,
    private readonly options: ShadowRendererHostOptions = {}
  ) {
    this.root = outerFrame.shadowRoot ?? outerFrame.attachShadow({ mode: 'open' });
    rootOwners.set(this.root, this);
    const environment = options.environment ?? defaultRendererRuntimeEnvironment();
    this.frames = new RendererFrameScope(environment, () => this.reportFrameFailure());
    this.unregisterActivity = environment.observeActivity(outerFrame, (state) => this.activityChanged(state));
  }

  async mount(renderer: BrowserElementRenderer | undefined, context: RendererContextInput): Promise<void> {
    if (this.disposed) throw new Error('Renderer host is disposed');
    if (this.mounted || this.renderer) throw new Error('Renderer host is already mounted');
    this.latestContext = context;
    if (!renderer?.schemaVersions.includes(context.element.schemaVersion)) {
      await this.showFailure('missing', context);
      return;
    }
    this.renderer = renderer;
    this.controller = new AbortController();
    try {
      this.mounted = renderer.mount(this.root, this.contextFor(context, this.controller.signal));
    } catch {
      await this.showFailure('failed', context);
    }
  }

  update(context: RendererContextInput): Promise<void> {
    if (this.disposed || this.failed) return Promise.resolve();
    if (!this.mounted) return Promise.resolve();
    this.latestContext = context;
    this.queueUpdate(context);
    return this.updateTask ?? Promise.resolve();
  }

  private queueUpdate(context: RendererContextInput): void {
    this.pendingContext = context;
    this.controller?.abort();
    if (!this.updateTask) this.updateTask = this.flushUpdates();
  }

  private async flushUpdates(): Promise<void> {
    while (this.pendingContext && this.mounted && !this.disposed) {
      const context = this.pendingContext;
      this.pendingContext = null;
      const controller = new AbortController();
      this.controller = controller;
      try {
        await this.mounted.update(this.contextFor(context, controller.signal));
      } catch {
        if (!controller.signal.aborted) {
          await this.showFailure('failed', context);
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
    this.latestContext = null;
    this.lifetimeController.abort();
    this.unregisterActivity?.();
    this.unregisterActivity = null;
    this.frames.dispose();
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

  contextFor(context: RendererContextInput, signal: AbortSignal): RendererContext {
    return {
      ...context,
      signal,
      lifecycle: {
        signal: this.lifetimeController.signal,
        active: this.active,
        reducedMotion: this.reducedMotion
      },
      frames: this.frames
    };
  }

  private activityChanged(state: RendererActivityState): void {
    const active = state.connected && state.intersecting && state.documentVisible;
    const changed = active !== this.active || state.reducedMotion !== this.reducedMotion;
    this.active = active;
    this.reducedMotion = state.reducedMotion;
    this.frames.setActive(active);
    if (changed && this.latestContext && this.mounted && !this.disposed && !this.failed) {
      this.queueUpdate(this.latestContext);
    }
  }

  private reportFrameFailure(): void {
    const context = this.latestContext;
    if (!context || this.disposed || this.failed) return;
    const type = context.element.type;
    const separator = type.lastIndexOf('/');
    const diagnostic: PluginDiagnostic = {
      code: 'browser_renderer_frame_failed',
      severity: 'warning',
      message: 'A browser renderer frame callback failed and was stopped.',
      retryable: false,
      ...(separator > 0 ? { pluginId: type.slice(0, separator) } : {}),
      elementId: context.element.id
    };
    this.reportDiagnostic(diagnostic, context);
  }

  private reportDiagnostic(diagnostic: PluginDiagnostic, context?: RendererContextInput): void {
    if (this.options.reportDiagnostic) this.options.reportDiagnostic(diagnostic);
    else context?.reportDiagnostic(diagnostic);
  }

  private async showFailure(status: 'missing' | 'failed', context: RendererContextInput): Promise<void> {
    if (this.failed) return;
    this.lifetimeController.abort();
    this.unregisterActivity?.();
    this.unregisterActivity = null;
    this.frames.dispose();
    this.controller?.abort();
    this.pendingContext = null;
    this.failed = true;
    const mounted = this.mounted;
    this.mounted = null;
    this.renderer = null;
    try {
      await mounted?.dispose();
    } catch {
      this.reportDiagnostic(
        {
          code: 'browser_renderer_dispose_failed',
          severity: 'warning',
          message: 'Renderer disposal failed.',
          retryable: false
        },
        context
      );
    }
    const diagnostic = browserRendererDiagnostic(status, context.element.type, context.element.id);
    this.reportDiagnostic(diagnostic, context);
    renderBrowserDiagnosticCard(this.root, diagnostic);
  }
}
