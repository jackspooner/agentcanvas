import type { PluginDiagnostic } from './diagnostics.js';
import type { CanvasElement } from './element.js';
import type { ElementType } from './identifiers.js';
import type { JsonObject } from './json.js';

export type BrowserRendererPlacement = 'node' | 'world-underlay' | 'world-overlay';

export interface CanvasPoint {
  x: number;
  y: number;
}

export interface CanvasRect extends CanvasPoint {
  width: number;
  height: number;
}

export interface RendererGeometryService {
  getElementFrame(elementId: string): CanvasRect | null;
  resolveAnchor(elementId: string, anchor: 'center' | 'top' | 'right' | 'bottom' | 'left'): CanvasPoint | null;
}

export interface RendererOverlayHandle {
  update(content: Node): void;
  close(): void;
}

export interface RendererOverlayService {
  open(content: Node, options?: { modal?: boolean; label?: string }): RendererOverlayHandle;
}

export interface RendererContext {
  element: Readonly<CanvasElement>;
  runtime: Readonly<JsonObject> | null;
  readOnly: boolean;
  selected: boolean;
  signal: AbortSignal;
  theme: Readonly<Record<string, string>>;
  geometry: RendererGeometryService;
  overlays: RendererOverlayService;
  reportDiagnostic(diagnostic: PluginDiagnostic): void;
}

export interface MountedBrowserElementRenderer {
  update(next: RendererContext): void | Promise<void>;
  dispose(): void | Promise<void>;
}

export interface BrowserElementRenderer {
  type: ElementType;
  schemaVersions: readonly number[];
  placement: BrowserRendererPlacement;
  mount(root: ShadowRoot, context: RendererContext): MountedBrowserElementRenderer;
}

export interface BrowserPluginHost {
  registerRenderer(renderer: BrowserElementRenderer): void;
}

export interface AgentCanvasBrowserPlugin {
  activate(host: BrowserPluginHost): void | Promise<void>;
}
