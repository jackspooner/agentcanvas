import type { SnapshotNode } from '@agentcanvas/extension-sdk';

const svgNamespace = 'http://www.w3.org/2000/svg';

export function svgElement<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attributes: Record<string, string | number> = {}
): SVGElementTagNameMap[K] {
  const element = document.createElementNS(svgNamespace, tag);
  for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, String(value));
  return element;
}

/** Converts the deterministic native ERD scene without interpreting diagram data or geometry. */
export function sceneToSvg(nodes: readonly SnapshotNode[]): SVGElement[] {
  return nodes.map((node) => {
    if (node.kind === 'imageHandle') throw new Error('Native ERD scenes cannot contain image handles.');
    if (node.kind === 'group' && node.clip) throw new Error('Native ERD scene clips are unsupported.');
    const element = svgElement(node.kind === 'group' ? 'g' : node.kind);
    for (const [key, value] of Object.entries(node)) {
      if (value === undefined || ['kind', 'children', 'clip', 'text', 'maxWidth'].includes(key)) continue;
      if (key === 'id') element.setAttribute('data-scene-id', String(value));
      else if (key === 'transform') element.setAttribute('transform', `matrix(${value.join(' ')})`);
      else if (key === 'dash') element.setAttribute('stroke-dasharray', value.join(' '));
      else
        element.setAttribute(
          key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`),
          String(value)
        );
    }
    if (node.kind === 'group') element.append(...sceneToSvg(node.children));
    if (node.kind === 'text') element.textContent = node.text;
    return element;
  });
}
