import type { DiagramAppearance, DiagramPoint, MermaidLayout, MermaidPresentation } from '../contracts.js';
import { MermaidSourceError } from './policy.js';

type GraphData = {
  nodes: Array<{ id: string; domId?: string; label?: string; isGroup?: boolean }>;
  edges: Array<
    { id: string; start: string; end: string; label?: string } & Partial<
      Record<'startLabelLeft' | 'startLabelRight' | 'endLabelLeft' | 'endLabelRight', string>
    >
  >;
};
function fail(message: string): never {
  throw new MermaidSourceError([{ path: '/presentation', code: 'mermaid.presentation.contract', message }]);
}

export function rootMatrix(root: SVGSVGElement, element: SVGGraphicsElement): DOMMatrix {
  const base = root.getScreenCTM(),
    matrix = element.getScreenCTM();
  if (!base || !matrix) fail('Diagram geometry is unavailable.');
  const relative = base.inverse().multiply(matrix);
  return new DOMMatrix([relative.a, relative.b, relative.c, relative.d, relative.e, relative.f]);
}
export function bounds(root: SVGSVGElement, element: SVGGraphicsElement) {
  const box = element.getBBox(),
    matrix = rootMatrix(root, element);
  const points = [
    [box.x, box.y],
    [box.x + box.width, box.y],
    [box.x, box.y + box.height],
    [box.x + box.width, box.y + box.height]
  ].map(([x, y]) => new DOMPoint(x, y).matrixTransform(matrix));
  const x = Math.min(...points.map((point) => point.x)),
    y = Math.min(...points.map((point) => point.y));
  return {
    x,
    y,
    width: Math.max(...points.map((point) => point.x)) - x,
    height: Math.max(...points.map((point) => point.y)) - y
  };
}
export function transformWorld(root: SVGSVGElement, element: SVGGraphicsElement, transform: DOMMatrix): void {
  const parent = element.parentElement;
  if (!(parent instanceof SVGGraphicsElement)) fail('Diagram item has no SVG parent.');
  const next = rootMatrix(root, parent).inverse().multiply(transform).multiply(rootMatrix(root, element));
  element.setAttribute('transform', `matrix(${next.a} ${next.b} ${next.c} ${next.d} ${next.e} ${next.f})`);
}
export function resizeBox(
  root: SVGSVGElement,
  element: SVGGraphicsElement,
  before: { x: number; y: number; width: number; height: number },
  next: { x: number; y: number; width: number; height: number }
): void {
  const sx = next.width / before.width,
    sy = next.height / before.height;
  transformWorld(
    root,
    element,
    new DOMMatrix().translate(next.x, next.y).scale(sx, sy).translate(-before.x, -before.y)
  );
  // Box size is independent of font size. Counter-scale glyphs around their new centers.
  if (sx !== 1 || sy !== 1)
    for (const text of element.querySelectorAll<SVGTextElement>('text')) {
      const box = bounds(root, text),
        x = box.x + box.width / 2,
        y = box.y + box.height / 2;
      transformWorld(
        root,
        text,
        new DOMMatrix()
          .translate(x, y)
          .scale(1 / sx, 1 / sy)
          .translate(-x, -y)
      );
    }
}
export function applyAppearance(element: SVGElement, appearance?: DiagramAppearance): void {
  if (!appearance) return;
  for (const shape of [element, ...element.querySelectorAll<SVGElement>('rect,path,polygon,ellipse,circle,line')]) {
    if (!['rect', 'path', 'polygon', 'ellipse', 'circle', 'line'].includes(shape.tagName)) continue;
    if (appearance.fill !== undefined && !shape.matches('line,[data-edge]'))
      shape.style.setProperty('fill', appearance.fill, 'important');
    if (appearance.borderColor !== undefined) shape.style.setProperty('stroke', appearance.borderColor, 'important');
    if (appearance.borderWidth !== undefined)
      shape.style.setProperty('stroke-width', String(appearance.borderWidth), 'important');
    if (appearance.borderStyle !== undefined)
      shape.style.setProperty(
        'stroke-dasharray',
        appearance.borderStyle === 'solid' ? 'none' : appearance.borderStyle === 'dotted' ? '2 3' : '6 4',
        'important'
      );
  }
  for (const text of [element, ...element.querySelectorAll<SVGElement>('text,tspan')]) {
    if (!['text', 'tspan'].includes(text.tagName)) continue;
    if (appearance.textColor !== undefined) text.style.setProperty('fill', appearance.textColor, 'important');
    if (appearance.fontFamily !== undefined) text.style.setProperty('font-family', appearance.fontFamily, 'important');
    if (appearance.fontSize !== undefined) text.style.setProperty('font-size', `${appearance.fontSize}px`, 'important');
  }
}
export function setRoute(root: SVGSVGElement, edge: SVGGraphicsElement, points: DiagramPoint[]): SVGPathElement {
  const inverse = rootMatrix(root, edge).inverse();
  const path = edge instanceof SVGPathElement ? edge : document.createElementNS('http://www.w3.org/2000/svg', 'path');
  if (path !== edge) {
    for (const attr of edge.attributes) path.setAttribute(attr.name, attr.value);
    edge.replaceWith(path);
  }
  path.setAttribute(
    'd',
    points
      .map((point, index) => {
        const local = new DOMPoint(point.x, point.y).matrixTransform(inverse);
        return `${index ? 'L' : 'M'}${local.x},${local.y}`;
      })
      .join(' ')
  );
  path.style.setProperty('fill', 'none', 'important');
  return path;
}
export function midpoint(points: DiagramPoint[]): DiagramPoint {
  const lengths = points
    .slice(1)
    .map((point, index) => Math.hypot(point.x - points[index].x, point.y - points[index].y));
  let remaining = lengths.reduce((a, b) => a + b, 0) / 2;
  for (let i = 0; i < lengths.length; i++) {
    if (remaining <= lengths[i]) {
      const ratio = lengths[i] ? remaining / lengths[i] : 0;
      return {
        x: points[i].x + (points[i + 1].x - points[i].x) * ratio,
        y: points[i].y + (points[i + 1].y - points[i].y) * ratio
      };
    }
    remaining -= lengths[i];
  }
  return points[0];
}
export function validatePresentationTargets(layout: MermaidLayout, presentation?: MermaidPresentation): void {
  for (const collection of ['nodes', 'edges'] as const)
    for (const item of presentation?.[collection] ?? [])
      if (!layout[collection].some((node) => node.id === item.id))
        fail(`Unknown ${collection} presentation ID: ${item.id}. Inspect this exact source again.`);
}

/** Version-pinned Mermaid 11.17.2 DB and SVG adapter. Never infer connectivity from visual proximity. */
export function presentGraph(root: SVGSVGElement, raw: unknown, presentation?: MermaidPresentation): MermaidLayout {
  const graph = raw as GraphData;
  if (!graph || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges))
    fail('Mermaid parser graph contract changed.');
  const nodeElements = [...root.querySelectorAll<SVGGElement>('g.node')];
  const edgeElements = [...root.querySelectorAll<SVGPathElement>('[data-edge="true"]')];
  const labelElements = [...root.querySelectorAll<SVGGElement>('g.edgeLabel')];
  const layout: MermaidLayout = { nodes: [], edges: [] };
  const elements = new Map<string, SVGGElement>();
  const original = new Map<string, { x: number; y: number; width: number; height: number }>();
  for (const node of graph.nodes) {
    if (node.isGroup) continue;
    if (typeof node.id !== 'string') fail('Mermaid returned an invalid node ID.');
    // ClassDB's DOM counter survives parser instances; semantic IDs are the stable owner.
    const prefix = node.domId?.startsWith('classId-') ? `${root.id}-classId-${node.id}-` : undefined;
    const element = nodeElements.find((element) =>
      prefix
        ? element.id.startsWith(prefix) && /^\d+$/.test(element.id.slice(prefix.length))
        : element.id === `${root.id}-${node.domId ?? node.id}`
    );
    if (!element) fail(`Mermaid node geometry is missing: ${node.id}.`);
    const box = bounds(root, element);
    if (!(box.width > 0 && box.height > 0)) continue;
    original.set(node.id, box);
    elements.set(node.id, element);
    layout.nodes.push({ id: node.id, label: typeof node.label === 'string' ? node.label : node.id, ...box });
  }
  for (const edge of graph.edges) {
    if (typeof edge.id !== 'string' || typeof edge.start !== 'string' || typeof edge.end !== 'string')
      fail('Mermaid returned an invalid edge identity.');
    const element = edgeElements.find((element) => element.dataset.id === edge.id);
    if (!element) fail(`Mermaid connector geometry is missing: ${edge.id}.`);
    const matrix = rootMatrix(root, element);
    const length = element.getTotalLength();
    const samples = edge.start === edge.end ? 9 : 3;
    const points = Array.from({ length: samples }, (_, index) => {
      const local = element.getPointAtLength((length * index) / (samples - 1));
      const point = new DOMPoint(local.x, local.y).matrixTransform(matrix);
      return { x: point.x, y: point.y };
    });
    const label = labelElements.find((label) => label.querySelector('[data-id]')?.getAttribute('data-id') === edge.id);
    const labelBox = label ? bounds(root, label) : undefined;
    layout.edges.push({
      id: edge.id,
      source: edge.start,
      target: edge.end,
      label: typeof edge.label === 'string' ? edge.label : '',
      points,
      labelPosition: labelBox
        ? { x: labelBox.x + labelBox.width / 2, y: labelBox.y + labelBox.height / 2 }
        : midpoint(points)
    });
  }
  validatePresentationTargets(layout, presentation);
  for (const node of layout.nodes) {
    const override = presentation?.nodes.find((item) => item.id === node.id);
    const element = elements.get(node.id)!;
    applyAppearance(element, override?.appearance);
    if (!override) continue;
    const next = {
      x: override.x ?? node.x,
      y: override.y ?? node.y,
      width: override.width ?? node.width,
      height: override.height ?? node.height
    };
    resizeBox(root, element, node, next);
    Object.assign(node, next);
  }
  for (const edge of layout.edges) {
    const originalFirst = edge.points[0],
      originalLast = edge.points[edge.points.length - 1];
    const override = presentation?.edges.find((item) => item.id === edge.id);
    const geometryChanged = presentation?.nodes.some(
      (node) =>
        [edge.source, edge.target].includes(node.id) &&
        [node.x, node.y, node.width, node.height].some((value) => value !== undefined)
    );
    const endpoint = (point: DiagramPoint, id: string) => {
      const before = original.get(id),
        after = layout.nodes.find((item) => item.id === id);
      if (!before || !after) return point;
      return {
        x: after.x + ((point.x - before.x) * after.width) / before.width,
        y: after.y + ((point.y - before.y) * after.height) / before.height
      };
    };
    if (geometryChanged || override?.bends?.length) {
      const first = endpoint(edge.points[0], edge.source),
        last = endpoint(edge.points[edge.points.length - 1], edge.target);
      const bends = override?.bends?.length
        ? override.bends
        : edge.source === edge.target
          ? edge.points.slice(1, -1).map((point) => endpoint(point, edge.source))
          : Math.abs(first.x - last.x) >= Math.abs(first.y - last.y)
            ? [
                { x: (first.x + last.x) / 2, y: first.y },
                { x: (first.x + last.x) / 2, y: last.y }
              ]
            : [
                { x: first.x, y: (first.y + last.y) / 2 },
                { x: last.x, y: (first.y + last.y) / 2 }
              ];
      edge.points = [first, ...bends, last];
      setRoute(root, edgeElements.find((item) => item.dataset.id === edge.id)!, edge.points);
    }
    applyAppearance(edgeElements.find((item) => item.dataset.id === edge.id)!, override?.appearance);
    const nextLabel =
      override?.labelPosition ??
      (geometryChanged || override?.bends?.length ? midpoint(edge.points) : edge.labelPosition);
    const label = labelElements.find((label) => label.querySelector('[data-id]')?.getAttribute('data-id') === edge.id);
    if (label) {
      const descriptor = graph.edges.find((item) => item.id === edge.id)!;
      const terminalSides = (['startLabelLeft', 'startLabelRight', 'endLabelLeft', 'endLabelRight'] as const).filter(
        (key) => descriptor[key]
      );
      let terminal = label.nextElementSibling;
      for (const side of terminalSides) {
        // Empty class labels may have a separate background group before the terminal labels.
        if (
          terminal?.matches('g:not([class])') &&
          terminal.children.length === 1 &&
          terminal.firstElementChild?.matches('rect.background')
        )
          terminal = terminal.nextElementSibling;
        if (!(terminal instanceof SVGGraphicsElement) || !terminal.classList.contains('edgeTerminals'))
          fail('Mermaid terminal-label contract changed.');
        const start = side.startsWith('start'),
          before = start ? originalFirst : originalLast,
          after = start ? edge.points[0] : edge.points[edge.points.length - 1];
        transformWorld(root, terminal, new DOMMatrix().translate(after.x - before.x, after.y - before.y));
        applyAppearance(terminal, override?.appearance);
        terminal = terminal.nextElementSibling;
      }
      transformWorld(
        root,
        label,
        new DOMMatrix().translate(nextLabel.x - edge.labelPosition.x, nextLabel.y - edge.labelPosition.y)
      );
      applyAppearance(label, override?.appearance);
    }
    edge.labelPosition = nextLabel;
  }
  return layout;
}
