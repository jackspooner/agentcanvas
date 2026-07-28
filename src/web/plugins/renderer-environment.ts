export interface RendererActivityState {
  connected: boolean;
  intersecting: boolean;
  documentVisible: boolean;
  reducedMotion: boolean;
}

export interface RendererRuntimeEnvironment {
  observeActivity(element: Element, listener: (state: RendererActivityState) => void): () => void;
  requestFrame(callback: FrameRequestCallback): number;
  cancelFrame(handle: number): void;
}

interface ActivityRegistration {
  element: Element;
  intersecting: boolean;
  listener(state: RendererActivityState): void;
}

class BrowserRendererRuntimeEnvironment implements RendererRuntimeEnvironment {
  private readonly registrations = new Map<Element, ActivityRegistration>();
  private readonly observer: IntersectionObserver;
  private readonly reducedMotionQuery: MediaQueryList;

  constructor() {
    if (typeof IntersectionObserver !== 'function') {
      throw new Error('AgentCanvas browser renderers require IntersectionObserver');
    }
    if (typeof window.matchMedia !== 'function') {
      throw new Error('AgentCanvas browser renderers require matchMedia');
    }
    if (!('visibilityState' in document)) {
      throw new Error('AgentCanvas browser renderers require the document visibility API');
    }
    this.reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    this.observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const registration = this.registrations.get(entry.target);
        if (!registration) continue;
        registration.intersecting = entry.isIntersecting;
        this.emit(registration);
      }
    });
    document.addEventListener('visibilitychange', this.emitAll);
    this.reducedMotionQuery.addEventListener('change', this.emitAll);
  }

  observeActivity(element: Element, listener: (state: RendererActivityState) => void): () => void {
    if (this.registrations.has(element)) {
      throw new Error('Renderer activity is already being observed for this element');
    }
    const registration: ActivityRegistration = { element, intersecting: false, listener };
    this.registrations.set(element, registration);
    this.observer.observe(element);
    this.emit(registration);
    return () => {
      if (this.registrations.get(element) !== registration) return;
      this.registrations.delete(element);
      this.observer.unobserve(element);
    };
  }

  requestFrame(callback: FrameRequestCallback): number {
    return window.requestAnimationFrame(callback);
  }

  cancelFrame(handle: number): void {
    window.cancelAnimationFrame(handle);
  }

  private readonly emitAll = (): void => {
    for (const registration of this.registrations.values()) this.emit(registration);
  };

  private emit(registration: ActivityRegistration): void {
    registration.listener({
      connected: registration.element.isConnected,
      intersecting: registration.intersecting,
      documentVisible: document.visibilityState === 'visible',
      reducedMotion: this.reducedMotionQuery.matches
    });
  }
}

let browserEnvironment: RendererRuntimeEnvironment | null = null;

export function defaultRendererRuntimeEnvironment(): RendererRuntimeEnvironment {
  browserEnvironment ??= new BrowserRendererRuntimeEnvironment();
  return browserEnvironment;
}

export function setDefaultRendererRuntimeEnvironmentForTests(environment: RendererRuntimeEnvironment): void {
  browserEnvironment = environment;
}
