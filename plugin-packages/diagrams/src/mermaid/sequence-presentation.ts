import type { MermaidLayout, MermaidPresentation } from '../contracts.js';
import {
  applyAppearance,
  bounds,
  midpoint,
  rootMatrix,
  setRoute,
  transformWorld,
  validatePresentationTargets,
  resizeBox
} from './presentation.js';
import { MermaidSourceError } from './policy.js';

/** Participants move horizontally; extra header height shifts the timeline without changing message order. */
export function presentSequence(root: SVGSVGElement, presentation?: MermaidPresentation): MermaidLayout {
  const participants = [...root.querySelectorAll<SVGGraphicsElement>('[data-et="participant"]')];
  const messages = [...root.querySelectorAll<SVGGeometryElement>('[data-et="message"]')];
  const layout: MermaidLayout = {
    nodes: participants.map((element) => ({
      id: element.dataset.id!,
      label: element.textContent?.trim() ?? element.dataset.id!,
      ...bounds(root, element)
    })),
    edges: []
  };
  if (layout.nodes.some((node) => !node.id || !(node.width > 0 && node.height > 0)))
    throw new MermaidSourceError([
      {
        path: '/presentation',
        code: 'mermaid.presentation.contract',
        message: 'Sequence participant geometry changed.'
      }
    ]);
  const labels = new Map<string, SVGGraphicsElement>();
  for (const element of messages) {
    const id = element.dataset.id!,
      source = element.dataset.from!,
      target = element.dataset.to!;
    const matrix = rootMatrix(root, element),
      length = element.getTotalLength();
    const samples = source === target ? 9 : 3;
    const points = Array.from({ length: samples }, (_, index) => {
      const local = element.getPointAtLength((length * index) / (samples - 1));
      const point = new DOMPoint(local.x, local.y).matrixTransform(matrix);
      return { x: point.x, y: point.y };
    });
    let label = element.previousElementSibling;
    while (label && !label.matches('.messageText') && !label.matches('[data-et="message"]'))
      label = label.previousElementSibling;
    const text = label instanceof SVGGraphicsElement && label.matches('.messageText') ? label : undefined;
    if (text) labels.set(id, text);
    const box = text ? bounds(root, text) : undefined;
    layout.edges.push({
      id,
      source,
      target,
      label: text?.textContent ?? '',
      points,
      labelPosition: box ? { x: box.x + box.width / 2, y: box.y + box.height / 2 } : midpoint(points)
    });
  }
  validatePresentationTargets(layout, presentation);
  const originals = structuredClone(layout.nodes);
  for (const node of layout.nodes) {
    const override = presentation?.nodes.find((item) => item.id === node.id);
    if (override?.y !== undefined && Math.abs(override.y - node.y) > 0.01)
      throw new MermaidSourceError([
        {
          path: '/presentation/nodes',
          code: 'mermaid.presentation.sequence-order',
          message: 'Sequence participants move horizontally. Leave Y unchanged to preserve message order.'
        }
      ]);
    Object.assign(node, {
      x: override?.x ?? node.x,
      width: override?.width ?? node.width,
      height: override?.height ?? node.height
    });
  }
  const timelineShift = Math.max(
    0,
    Math.max(...layout.nodes.map((node) => node.y + node.height)) -
      Math.max(...originals.map((node) => node.y + node.height))
  );
  const participantParents = new Set<Element>();
  for (const element of root.querySelectorAll('[data-et="participant"],[data-et="life-line"],.actor-bottom')) {
    let parent = element;
    while (parent.parentNode instanceof Element && parent.parentNode !== root) parent = parent.parentNode;
    participantParents.add(parent);
  }
  if (timelineShift)
    for (const element of [...root.children]) {
      if (
        element instanceof SVGGraphicsElement &&
        !participantParents.has(element) &&
        !['defs', 'style'].includes(element.tagName)
      )
        transformWorld(root, element, new DOMMatrix().translate(0, timelineShift));
    }
  const deltaX = (id: string) => {
    const before = originals.find((node) => node.id === id),
      after = layout.nodes.find((node) => node.id === id);
    return before && after ? after.x + after.width / 2 - before.x - before.width / 2 : 0;
  };
  for (const node of layout.nodes) {
    const before = originals.find((item) => item.id === node.id)!;
    const override = presentation?.nodes.find((item) => item.id === node.id);
    const top = participants.find((element) => element.dataset.id === node.id)!;
    applyAppearance(top, override?.appearance);
    resizeBox(root, top, before, node);
    const footer = [...root.querySelectorAll<SVGGraphicsElement>('.actor-bottom')].find(
      (element) => element.getAttribute('name') === node.id
    );
    if (footer) {
      const group = footer.tagName === 'g' ? footer : (footer.parentElement as unknown as SVGGraphicsElement);
      const box = bounds(root, group);
      applyAppearance(group, override?.appearance);
      resizeBox(root, group, box, { x: node.x, y: box.y + timelineShift, width: node.width, height: node.height });
    }
    const life = [...root.querySelectorAll<SVGLineElement>('[data-et="life-line"]')].find(
      (element) => element.dataset.id === node.id
    );
    if (life) {
      const box = bounds(root, life);
      const line = setRoute(root, life, [
        { x: box.x + deltaX(node.id), y: node.y + node.height },
        { x: box.x + deltaX(node.id), y: box.y + box.height + timelineShift }
      ]);
      applyAppearance(line, override?.appearance);
    }
  }
  // Activation bars have no actor identifier in 11.17.2; their rendered center lies on that actor's lifeline.
  for (const activation of root.querySelectorAll<SVGGraphicsElement>('[class^="activation"]')) {
    const box = bounds(root, activation);
    const nearest = [...originals].sort(
      (a, b) =>
        Math.abs(a.x + a.width / 2 - box.x - box.width / 2) - Math.abs(b.x + b.width / 2 - box.x - box.width / 2)
    )[0];
    if (nearest) transformWorld(root, activation, new DOMMatrix().translate(deltaX(nearest.id), 0));
  }
  for (const edge of layout.edges) {
    const element = messages.find((item) => item.dataset.id === edge.id)!;
    const override = presentation?.edges.find((item) => item.id === edge.id);
    const from = deltaX(edge.source),
      to = deltaX(edge.target);
    const originalLabel = { x: edge.labelPosition.x, y: edge.labelPosition.y + timelineShift };
    const moved = edge.points.map((point, index) => ({
      x: point.x + from + ((to - from) * index) / (edge.points.length - 1),
      y: point.y + timelineShift
    }));
    edge.points = override?.bends?.length ? [moved[0], ...override.bends, moved[moved.length - 1]] : moved;
    let rendered: SVGGraphicsElement = element;
    if (from || to || override?.bends?.length) rendered = setRoute(root, element, edge.points);
    applyAppearance(rendered, override?.appearance);
    edge.labelPosition = override?.labelPosition ?? { x: originalLabel.x + (from + to) / 2, y: originalLabel.y };
    const label = labels.get(edge.id);
    if (label) {
      transformWorld(
        root,
        label,
        new DOMMatrix().translate(edge.labelPosition.x - originalLabel.x, edge.labelPosition.y - originalLabel.y)
      );
      applyAppearance(label, override?.appearance);
    }
  }
  return layout;
}
