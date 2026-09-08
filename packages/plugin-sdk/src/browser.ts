import type { PluginDiagnostic } from './diagnostics.js';
import type { CanvasElement } from './element.js';
import type { ElementType } from './identifiers.js';
import type { JsonObject } from './json.js';
import type { CanvasThemeV1 } from './theme.js';

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

export interface RendererLifecycle {
  signal: AbortSignal;
  active: boolean;
  reducedMotion: boolean;
}

export interface RendererFrame {
  timestamp: number;
  deltaMs: number;
}

export interface RendererFrameScheduler {
  subscribe(callback: (frame: RendererFrame) => void): () => void;
}

export type BrowserOwnCanvasOperation =
  | { op: 'upsertElement'; element: CanvasElement }
  | { op: 'replaceElementData'; elementId: string; data: JsonObject; style?: JsonObject | null }
  | { op: 'deleteElement'; elementId: string };

export interface BrowserCommandContext {
  pluginId: string;
  theme?: Readonly<CanvasThemeV1>;
  readOnly: boolean;
  selection: readonly Readonly<CanvasElement>[];
  viewport: Readonly<{ centerX: number; centerY: number; zoom: number }>;
  signal: AbortSignal;
  overlays: RendererOverlayService;
  executeCommand(commandId: string, input?: JsonObject): Promise<boolean>;
  /** Reads a current, confirmed element owned by this extension. */
  getElement?(elementId: string): { element: Readonly<CanvasElement>; revision: number } | null;
  reveal(rect: CanvasRect): void;
  transact(
    label: string,
    operations: readonly BrowserOwnCanvasOperation[],
    options?: { expectedRevision?: number }
  ): Promise<void>;
  reportDiagnostic(diagnostic: PluginDiagnostic): void;
}

export interface BrowserCommandDescriptor {
  name: string;
  title: string;
  category?: string;
  hidden?: boolean;
  isEnabled?(context: BrowserCommandContext): boolean;
  execute(context: BrowserCommandContext, input?: JsonObject): void | Promise<void>;
}

export interface RendererContext {
  element: Readonly<CanvasElement>;
  canvasRevision?: number;
  /** Executes this extension's registered commands or core undo/redo, bound to this element. */
  executeCommand?(commandId: string, input?: JsonObject): Promise<boolean>;
  runtime: Readonly<JsonObject> | null;
  readOnly: boolean;
  selected: boolean;
  signal: AbortSignal;
  lifecycle: Readonly<RendererLifecycle>;
  frames: RendererFrameScheduler;
  theme: Readonly<CanvasThemeV1>;
  geometry: RendererGeometryService;
  overlays: RendererOverlayService;
  reportDiagnostic(diagnostic: PluginDiagnostic): void;
}

export interface MountedBrowserElementRenderer {
  update(next: RendererContext): void | Promise<void>;
  dispose(): void | Promise<void>;
}

/**
 * Optional element-owned details workflow exposed through the editor's shared
 * node affordance. The host owns the button; the extension owns the safe data
 * projection and overlay content.
 */
export interface BrowserElementDetails {
  label?: string;
  open(context: RendererContext): void | Promise<void>;
}

export interface BrowserElementRenderer {
  type: ElementType;
  schemaVersions: readonly number[];
  placement: BrowserRendererPlacement;
  details?: BrowserElementDetails;
  mount(root: ShadowRoot, context: RendererContext): MountedBrowserElementRenderer;
}

export interface BrowserPluginHost {
  registerRenderer(renderer: BrowserElementRenderer): void;
  registerCommand?(command: BrowserCommandDescriptor): void;
}

export interface BrowserPluginDisposable {
  dispose(): void | Promise<void>;
}

export interface AgentCanvasBrowserPlugin {
  activate(host: BrowserPluginHost): void | BrowserPluginDisposable | Promise<void | BrowserPluginDisposable>;
}
