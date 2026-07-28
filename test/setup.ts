import { setDefaultRendererRuntimeEnvironmentForTests } from '../src/web/plugins/renderer-environment.js';
import { ManualRendererEnvironment } from './support/manual-renderer-environment.js';

class TestResizeObserver implements ResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = TestResizeObserver;
}

setDefaultRendererRuntimeEnvironmentForTests(new ManualRendererEnvironment());
