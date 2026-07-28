import type { AgentCanvasExtensionDefinition, RendererFrame, RendererFrameScheduler } from '@agentcanvas/extension-sdk';
import { assertPluginManifestStructure } from '@agentcanvas/plugin-testkit';

export * from '@agentcanvas/plugin-testkit';

export function assertExtensionDefinition(definition: AgentCanvasExtensionDefinition): void {
  assertPluginManifestStructure(definition.manifest);
  const expected = {
    elements: definition.contributes.elements,
    commands: definition.contributes.commands.map((command) => command.name),
    tools: definition.contributes.tools,
    procedures: definition.contributes.procedures,
    migrations: definition.contributes.migrations
  };
  if (JSON.stringify(definition.manifest.contributes) !== JSON.stringify(expected)) {
    throw new Error('Extension descriptors do not match the generated manifest contributions.');
  }
}

interface ManualFrameSubscription {
  callback(frame: RendererFrame): void;
  previousTimestamp: number | null;
}

export class ManualRendererFrameScheduler implements RendererFrameScheduler {
  private readonly subscriptions = new Set<ManualFrameSubscription>();
  private active = true;
  private disposed = false;

  constructor(private readonly onCallbackFailure: (error: unknown) => void = () => {}) {}

  subscribe(callback: (frame: RendererFrame) => void): () => void {
    if (this.disposed) return () => {};
    const subscription = { callback, previousTimestamp: null };
    this.subscriptions.add(subscription);
    let subscribed = true;
    return () => {
      if (!subscribed) return;
      subscribed = false;
      this.subscriptions.delete(subscription);
    };
  }

  setActive(active: boolean): void {
    if (this.disposed || this.active === active) return;
    this.active = active;
    if (!active) {
      for (const subscription of this.subscriptions) subscription.previousTimestamp = null;
    }
  }

  step(timestamp: number): void {
    if (this.disposed || !this.active) return;
    for (const subscription of [...this.subscriptions]) {
      const deltaMs =
        subscription.previousTimestamp === null ? 0 : Math.max(0, timestamp - subscription.previousTimestamp);
      subscription.previousTimestamp = timestamp;
      try {
        subscription.callback({ timestamp, deltaMs });
      } catch (error) {
        this.subscriptions.delete(subscription);
        this.onCallbackFailure(error);
      }
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.subscriptions.clear();
  }
}
