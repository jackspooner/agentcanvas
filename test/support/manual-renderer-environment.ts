import type { RendererActivityState, RendererRuntimeEnvironment } from '../../src/web/plugins/renderer-environment.js';

interface ActivityRegistration {
  state: RendererActivityState;
  listener(state: RendererActivityState): void;
}

const DEFAULT_ACTIVITY: RendererActivityState = {
  connected: true,
  intersecting: true,
  documentVisible: true,
  reducedMotion: false
};

export class ManualRendererEnvironment implements RendererRuntimeEnvironment {
  private readonly registrations = new Map<Element, ActivityRegistration>();
  private readonly frameCallbacks = new Map<number, FrameRequestCallback>();
  private nextFrameHandle = 1;
  requestedFrameCount = 0;
  cancelledFrameCount = 0;

  get pendingFrameCount(): number {
    return this.frameCallbacks.size;
  }

  observeActivity(element: Element, listener: (state: RendererActivityState) => void): () => void {
    const registration = { state: { ...DEFAULT_ACTIVITY }, listener };
    this.registrations.set(element, registration);
    listener({ ...registration.state });
    return () => {
      if (this.registrations.get(element) === registration) this.registrations.delete(element);
    };
  }

  setActivity(element: Element, next: Partial<RendererActivityState>): void {
    const registration = this.registrations.get(element);
    if (!registration) throw new Error('Element activity is not registered');
    registration.state = { ...registration.state, ...next };
    registration.listener({ ...registration.state });
  }

  requestFrame(callback: FrameRequestCallback): number {
    const handle = this.nextFrameHandle++;
    this.requestedFrameCount += 1;
    this.frameCallbacks.set(handle, callback);
    return handle;
  }

  cancelFrame(handle: number): void {
    if (this.frameCallbacks.delete(handle)) this.cancelledFrameCount += 1;
  }

  step(timestamp: number): void {
    const callbacks = [...this.frameCallbacks.values()];
    this.frameCallbacks.clear();
    for (const callback of callbacks) callback(timestamp);
  }
}
