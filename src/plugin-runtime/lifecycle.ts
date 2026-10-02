import type { V2SqliteCanvasStore } from '../store/v2.js';
import { createPluginCanvasOperations } from './canvas-operations.js';
import type { FrozenPluginRegistry } from './registry.js';

/** One lifetime for all services in this frozen registry, never used by offline tooling. */
export async function startPluginServices(
  registry: FrozenPluginRegistry,
  store: V2SqliteCanvasStore
): Promise<() => void> {
  const controller = new AbortController();
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    controller.abort();
    const errors: unknown[] = [];
    for (const plugin of [...registry.plugins].reverse()) {
      try {
        plugin.lifecycle?.dispose();
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length) throw new AggregateError(errors, 'Extension services failed to stop.');
  };
  try {
    for (const plugin of registry.plugins) {
      await plugin.lifecycle?.start({
        signal: controller.signal,
        correlationId: `service_${plugin.plugin.manifest.id}`,
        canvas: createPluginCanvasOperations(
          store,
          plugin.plugin.manifest.id,
          plugin.plugin.manifest.permissions,
          registry,
          controller.signal
        )
      });
    }
    return dispose;
  } catch (error) {
    try {
      dispose();
    } catch (stopError) {
      throw new AggregateError([error, stopError], 'Extension service startup failed.');
    }
    throw error;
  }
}
