import type {
  BrowserElementRenderer,
  CanvasElement,
  CanvasThemeV1,
  JsonObject,
  PluginDiagnostic,
  RendererGeometryService
} from '@agentcanvas/plugin-sdk';
import { useEffect, useMemo, useRef } from 'react';
import { isPluginInteractiveEvent } from '../plugins/interaction';
import type { DomRendererOverlayService } from '../plugins/overlays';
import { type RendererContextInput, ShadowRendererHost } from '../plugins/renderer-host';

interface PluginRendererSurfaceProps {
  canvasId?: string;
  canvasRevision?: number;
  executeCommand?: RendererContextInput['executeCommand'];
  element: CanvasElement;
  runtime: JsonObject | null;
  renderer: BrowserElementRenderer | undefined;
  geometry: RendererGeometryService;
  overlays: DomRendererOverlayService;
  readOnly: boolean;
  selected: boolean;
  theme: Readonly<CanvasThemeV1>;
  reportDiagnostic(diagnostic: PluginDiagnostic): void;
}

export function PluginRendererSurface(props: PluginRendererSurfaceProps) {
  const outer = useRef<HTMLDivElement | null>(null);
  const host = useRef<ShadowRendererHost | null>(null);
  const detailsController = useRef<AbortController | null>(null);
  const context: RendererContextInput = useMemo(
    () => ({
      element: props.element,
      canvasRevision: props.canvasRevision,
      executeCommand: props.executeCommand,
      runtime: props.runtime,
      readOnly: props.readOnly,
      selected: props.selected,
      theme: props.theme,
      geometry: props.geometry,
      overlays: props.overlays,
      reportDiagnostic: props.reportDiagnostic
    }),
    [
      props.element,
      props.canvasRevision,
      props.executeCommand,
      props.geometry,
      props.overlays,
      props.readOnly,
      props.reportDiagnostic,
      props.runtime,
      props.selected,
      props.theme
    ]
  );

  const latestContext = useRef(context);
  latestContext.current = context;
  // biome-ignore lint/correctness/useExhaustiveDependencies: Identity controls renderer lifetime; context changes use update below.
  useEffect(() => {
    if (!outer.current) return undefined;
    const surface = outer.current;
    const preserveInteractiveWheel = (event: WheelEvent) => {
      if (isPluginInteractiveEvent(event, surface)) event.stopPropagation();
    };
    surface.addEventListener('wheel', preserveInteractiveWheel, { passive: true });
    const rendererHost = new ShadowRendererHost(surface, {
      reportDiagnostic: (diagnostic) => latestContext.current.reportDiagnostic(diagnostic)
    });
    host.current = rendererHost;
    void rendererHost.mount(props.renderer, latestContext.current);
    return () => {
      surface.removeEventListener('wheel', preserveInteractiveWheel);
      detailsController.current?.abort();
      detailsController.current = null;
      host.current = null;
      void rendererHost.dispose();
    };
  }, [props.canvasId, props.element.id, props.element.type, props.renderer]);

  useEffect(() => {
    void host.current?.update(context);
  }, [context]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: A changed element invalidates its open Details request.
  useEffect(() => {
    detailsController.current?.abort();
    detailsController.current = null;
  }, [props.element]);

  const openDetails = () => {
    if (!props.renderer?.details) return;
    detailsController.current?.abort();
    const controller = new AbortController();
    detailsController.current = controller;
    void Promise.resolve()
      .then(() => {
        const rendererContext = host.current?.contextFor(context, controller.signal);
        if (rendererContext) return props.renderer?.details?.open(rendererContext);
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          props.reportDiagnostic({
            code: 'browser_element_details_failed',
            severity: 'warning',
            message: 'Element details could not be opened.',
            retryable: true,
            elementId: props.element.id
          });
        }
      });
  };

  return (
    <div className="plugin-renderer-container">
      <div ref={outer} className="plugin-renderer-surface agentcanvas-editor-no-drag agentcanvas-editor-no-pan" />
      {props.renderer?.details && (
        <button
          type="button"
          className="plugin-renderer-details agentcanvas-editor-no-drag agentcanvas-editor-no-pan"
          data-agentcanvas-interactive=""
          aria-label={`${props.renderer.details.label ?? 'Details'} for ${props.element.id}`}
          onClick={openDetails}
        >
          {props.renderer.details.label ?? 'Details'}
        </button>
      )}
    </div>
  );
}
