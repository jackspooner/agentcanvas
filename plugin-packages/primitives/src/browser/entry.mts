import type {
  AgentCanvasBrowserPlugin,
  BrowserElementRenderer,
  BrowserPluginHost,
  CanvasElement,
  RendererContext
} from '@agentcanvas/plugin-sdk';
import { connectorData, stringValue } from './data.js';
import { arrowHead, connectorMidpoint, resolveConnectorEndpoints } from './geometry.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

function cssValue(element: Readonly<CanvasElement>, key: string, fallback: string): string {
  const value = element.style?.[key];
  return typeof value === 'string' || typeof value === 'number' ? String(value) : fallback;
}

function mountContainer(root: ShadowRoot, styles: string): HTMLElement {
  const style = document.createElement('style');
  style.textContent = styles;
  const container = document.createElement('div');
  container.className = 'content';
  root.replaceChildren(style, container);
  return container;
}

function cardRenderer(type: 'text' | 'shape'): BrowserElementRenderer {
  return {
    type: `agentcanvas.primitives/${type}`,
    schemaVersions: [1],
    placement: 'node',
    mount(root, initial) {
      const container = mountContainer(
        root,
        `:host{display:block;width:100%;height:100%;box-sizing:border-box}.content{box-sizing:border-box;width:100%;height:100%;display:grid;place-items:center;overflow:hidden;color:var(--ac-color,#0f172a);font:var(--ac-font,16px/1.4 Inter,Arial,sans-serif)}.text{display:block;white-space:pre-wrap;padding:14px;overflow:auto;border:var(--ac-border-width,1px) solid var(--ac-border,#d0d7de);border-radius:var(--ac-radius,10px);background:var(--ac-background,#fff)}.shape{border:var(--ac-stroke-width,2px) solid var(--ac-stroke,#64748b);background:var(--ac-fill,#fff);text-align:center;padding:12px}.ellipse{border-radius:50%}.diamond{width:68%;height:68%;transform:rotate(45deg);padding:0}.diamond>span{display:grid;place-items:center;width:100%;height:100%;transform:rotate(-45deg)}`
      );
      const update = (context: RendererContext) => {
        const element = context.element;
        const { colors, typography, shape: shapeTokens } = context.theme;
        container.style.setProperty('--ac-color', cssValue(element, 'color', colors.text));
        container.style.setProperty('--ac-background', cssValue(element, 'background', colors.surface));
        container.style.setProperty('--ac-border', cssValue(element, 'borderColor', colors.border));
        container.style.setProperty(
          '--ac-border-width',
          `${cssValue(element, 'borderWidth', String(shapeTokens.borderWidth))}px`
        );
        container.style.setProperty(
          '--ac-radius',
          `${cssValue(element, 'borderRadius', String(shapeTokens.radius))}px`
        );
        container.style.setProperty(
          '--ac-fill',
          cssValue(element, 'fill', cssValue(element, 'background', colors.surface))
        );
        container.style.setProperty(
          '--ac-stroke',
          cssValue(element, 'stroke', cssValue(element, 'borderColor', colors.border))
        );
        container.style.setProperty('--ac-stroke-width', `${cssValue(element, 'strokeWidth', '2')}px`);
        container.style.setProperty(
          '--ac-font',
          `${cssValue(element, 'fontWeight', '400')} ${cssValue(element, 'fontSize', '16')}px/1.4 ${cssValue(element, 'fontFamily', typography.bodyFont)}`
        );
        if (type === 'text') {
          container.className = 'content text';
          container.textContent = stringValue(element.data.text);
          return;
        }
        const shape = stringValue(element.data.shape, 'rect');
        container.className = `content shape ${shape}`;
        const span = document.createElement('span');
        span.textContent = stringValue(element.data.label);
        container.replaceChildren(span);
      };
      update(initial);
      return { update, dispose: () => root.replaceChildren() };
    }
  };
}

function connectorRenderer(type: 'line' | 'arrow'): BrowserElementRenderer {
  return {
    type: `agentcanvas.primitives/${type}`,
    schemaVersions: [1],
    placement: 'world-underlay',
    mount(root, initial) {
      const container = mountContainer(
        root,
        ':host{display:block;overflow:visible}.content,svg{position:absolute;inset:0;overflow:visible;pointer-events:none}.label{paint-order:stroke;stroke:#fff;stroke-width:5px;stroke-linejoin:round;font:600 13px Inter,Arial,sans-serif;fill:#0f172a}'
      );
      const update = (context: RendererContext) => {
        const data = connectorData(context.element);
        const resolved = resolveConnectorEndpoints(data.from, data.to, context.geometry);
        const svg = document.createElementNS(SVG_NS, 'svg');
        svg.setAttribute('width', '1');
        svg.setAttribute('height', '1');
        const line = document.createElementNS(SVG_NS, 'line');
        line.setAttribute('x1', String(resolved.from.x));
        line.setAttribute('y1', String(resolved.from.y));
        line.setAttribute('x2', String(resolved.to.x));
        line.setAttribute('y2', String(resolved.to.y));
        line.setAttribute('stroke', data.stroke ?? context.theme.colors.accent);
        line.setAttribute('stroke-width', String(data.strokeWidth ?? 2));
        svg.append(line);
        if (type === 'arrow') {
          const points = arrowHead(resolved.from, resolved.to);
          const polygon = document.createElementNS(SVG_NS, 'polygon');
          polygon.setAttribute('points', points.map((point) => `${point.x},${point.y}`).join(' '));
          polygon.setAttribute('fill', data.stroke ?? context.theme.colors.accent);
          svg.append(polygon);
        }
        if (data.label) {
          const midpoint = connectorMidpoint(resolved.from, resolved.to);
          const label = document.createElementNS(SVG_NS, 'text');
          label.classList.add('label');
          label.setAttribute('x', String(midpoint.x));
          label.setAttribute('y', String(midpoint.y - 8));
          label.setAttribute('text-anchor', 'middle');
          label.setAttribute('fill', context.theme.colors.text);
          label.setAttribute('stroke', context.theme.colors.surface);
          label.setAttribute('font-family', context.theme.typography.bodyFont);
          label.textContent = data.label;
          svg.append(label);
        }
        container.replaceChildren(svg);
        if (resolved.missingElementIds.length) {
          context.reportDiagnostic({
            code: 'connector_anchor_missing',
            severity: 'warning',
            message: `Could not resolve connector anchor(s): ${resolved.missingElementIds.join(', ')}.`,
            retryable: false,
            pluginId: 'agentcanvas.primitives',
            elementId: context.element.id
          });
        }
      };
      update(initial);
      return { update, dispose: () => root.replaceChildren() };
    }
  };
}

const plugin: AgentCanvasBrowserPlugin = {
  activate(host: BrowserPluginHost) {
    host.registerRenderer(cardRenderer('text'));
    host.registerRenderer(cardRenderer('shape'));
    host.registerRenderer(connectorRenderer('line'));
    host.registerRenderer(connectorRenderer('arrow'));
  }
};

export default plugin;
