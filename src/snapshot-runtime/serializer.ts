import type { SnapshotNode } from '@agentcanvas/plugin-sdk';

export function escapeXml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => {
    switch (character) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case "'":
        return '&apos;';
      default:
        return '&quot;';
    }
  });
}

function attribute(name: string, value: string | number | undefined): string {
  return value === undefined ? '' : ` ${name}="${escapeXml(String(value))}"`;
}

function common(node: SnapshotNode): string {
  return `${attribute('id', node.id)}${attribute('opacity', node.opacity)}${attribute(
    'transform',
    node.transform ? `matrix(${node.transform.join(' ')})` : undefined
  )}`;
}

export interface SnapshotSerializationContext {
  nextClipId(): string;
  addDefinition(svg: string): void;
  resourceUrl(handle: string): string;
}

export function serializeSnapshotNode(node: SnapshotNode, context: SnapshotSerializationContext): string {
  switch (node.kind) {
    case 'group': {
      let clip = '';
      if (node.clip) {
        const clipId = context.nextClipId();
        context.addDefinition(`<clipPath id="${clipId}">${serializeSnapshotNode(node.clip, context)}</clipPath>`);
        clip = ` clip-path="url(#${clipId})"`;
      }
      return `<g${common(node)}${clip}>${node.children.map((child) => serializeSnapshotNode(child, context)).join('')}</g>`;
    }
    case 'rect':
      return `<rect${common(node)}${attribute('x', node.x)}${attribute('y', node.y)}${attribute(
        'width',
        node.width
      )}${attribute('height', node.height)}${attribute('rx', node.rx)}${attribute('ry', node.ry)}${attribute(
        'fill',
        node.fill ?? 'none'
      )}${attribute('stroke', node.stroke)}${attribute('stroke-width', node.strokeWidth)}/>`;
    case 'ellipse':
      return `<ellipse${common(node)}${attribute('cx', node.cx)}${attribute('cy', node.cy)}${attribute(
        'rx',
        node.rx
      )}${attribute('ry', node.ry)}${attribute('fill', node.fill ?? 'none')}${attribute(
        'stroke',
        node.stroke
      )}${attribute('stroke-width', node.strokeWidth)}/>`;
    case 'line':
      return `<line${common(node)}${attribute('x1', node.x1)}${attribute('y1', node.y1)}${attribute(
        'x2',
        node.x2
      )}${attribute('y2', node.y2)}${attribute('stroke', node.stroke)}${attribute(
        'stroke-width',
        node.strokeWidth
      )}${attribute('stroke-dasharray', node.dash?.join(' '))}/>`;
    case 'path':
      return `<path${common(node)}${attribute('d', node.d)}${attribute('fill', node.fill ?? 'none')}${attribute(
        'stroke',
        node.stroke
      )}${attribute('stroke-width', node.strokeWidth)}/>`;
    case 'text':
      return `<text${common(node)}${attribute('x', node.x)}${attribute('y', node.y)}${attribute(
        'fill',
        node.fill
      )}${attribute('font-family', node.fontFamily)}${attribute('font-size', node.fontSize)}${attribute(
        'font-weight',
        node.fontWeight
      )}${attribute('text-anchor', node.textAnchor)}${attribute('textLength', node.maxWidth)}>${escapeXml(node.text)}</text>`;
    case 'imageHandle': {
      const fit = node.fit ?? 'contain';
      const preserve =
        fit === 'fill'
          ? 'none'
          : fit === 'cover'
            ? 'xMidYMid slice'
            : fit === 'none'
              ? 'xMidYMid meet'
              : 'xMidYMid meet';
      return `<image${common(node)}${attribute('x', node.x)}${attribute('y', node.y)}${attribute(
        'width',
        node.width
      )}${attribute('height', node.height)}${attribute('href', context.resourceUrl(node.handle))}${attribute(
        'preserveAspectRatio',
        preserve
      )}${attribute('aria-label', node.alt)}/>`;
    }
  }
}
