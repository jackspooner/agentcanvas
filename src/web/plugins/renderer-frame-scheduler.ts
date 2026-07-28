import type { RendererFrame, RendererFrameScheduler } from '@agentcanvas/plugin-sdk';
import type { RendererRuntimeEnvironment } from './renderer-environment.js';

interface FrameSubscription {
  callback(frame: RendererFrame): void;
  previousTimestamp: number | null;
}

type FrameFailureReporter = () => void;

const sharedClocks = new WeakMap<RendererRuntimeEnvironment, SharedRendererFrameClock>();

class SharedRendererFrameClock {
  private readonly scopes = new Set<RendererFrameScope>();
  private frameHandle: number | null = null;

  constructor(private readonly environment: RendererRuntimeEnvironment) {}

  add(scope: RendererFrameScope): void {
    this.scopes.add(scope);
    this.refresh();
  }

  remove(scope: RendererFrameScope): void {
    this.scopes.delete(scope);
    this.refresh();
  }

  refresh(): void {
    const needed = [...this.scopes].some((scope) => scope.needsFrames);
    if (needed && this.frameHandle === null) {
      this.frameHandle = this.environment.requestFrame(this.deliver);
    } else if (!needed && this.frameHandle !== null) {
      this.environment.cancelFrame(this.frameHandle);
      this.frameHandle = null;
    }
  }

  private readonly deliver = (timestamp: number): void => {
    this.frameHandle = null;
    for (const scope of [...this.scopes]) scope.deliver(timestamp);
    this.refresh();
  };
}

function sharedClock(environment: RendererRuntimeEnvironment): SharedRendererFrameClock {
  let clock = sharedClocks.get(environment);
  if (!clock) {
    clock = new SharedRendererFrameClock(environment);
    sharedClocks.set(environment, clock);
  }
  return clock;
}

export class RendererFrameScope implements RendererFrameScheduler {
  private readonly subscriptions = new Set<FrameSubscription>();
  private readonly clock: SharedRendererFrameClock;
  private active = false;
  private disposed = false;

  constructor(
    environment: RendererRuntimeEnvironment,
    private readonly reportFailure: FrameFailureReporter
  ) {
    this.clock = sharedClock(environment);
    this.clock.add(this);
  }

  get needsFrames(): boolean {
    return !this.disposed && this.active && this.subscriptions.size > 0;
  }

  subscribe(callback: (frame: RendererFrame) => void): () => void {
    if (this.disposed) return () => {};
    const subscription: FrameSubscription = { callback, previousTimestamp: null };
    this.subscriptions.add(subscription);
    this.clock.refresh();
    let subscribed = true;
    return () => {
      if (!subscribed) return;
      subscribed = false;
      this.subscriptions.delete(subscription);
      this.clock.refresh();
    };
  }

  setActive(active: boolean): void {
    if (this.disposed || this.active === active) return;
    this.active = active;
    if (!active) {
      for (const subscription of this.subscriptions) subscription.previousTimestamp = null;
    }
    this.clock.refresh();
  }

  deliver(timestamp: number): void {
    if (!this.needsFrames) return;
    for (const subscription of [...this.subscriptions]) {
      const deltaMs =
        subscription.previousTimestamp === null ? 0 : Math.max(0, timestamp - subscription.previousTimestamp);
      subscription.previousTimestamp = timestamp;
      try {
        subscription.callback({ timestamp, deltaMs });
      } catch {
        this.subscriptions.delete(subscription);
        try {
          this.reportFailure();
        } catch (error) {
          void error;
        }
      }
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.active = false;
    this.subscriptions.clear();
    this.clock.remove(this);
  }
}
