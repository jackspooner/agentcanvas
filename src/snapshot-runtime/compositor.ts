import type { CanvasElement, PluginDiagnostic, SnapshotContribution } from '@agentcanvas/plugin-sdk';
import { envelopeMatrix, type SnapshotBounds, snapshotNodeBounds, transformBounds, unionBounds } from './bounds.js';
import { escapeXml, serializeSnapshotNode } from './serializer.js';
import {
  DEFAULT_SNAPSHOT_LIMITS,
  SnapshotSafetyError,
  type SnapshotSafetyLimits,
  validateSnapshotContribution
} from './validation.js';

export type SnapshotRenderStatus = 'supported' | 'unsupported' | 'missing' | 'failed';

export interface SnapshotRenderItem {
  element: Readonly<CanvasElement>;
  status: SnapshotRenderStatus;
  contribution?: SnapshotContribution;
  diagnostic?: PluginDiagnostic;
}

export interface ComposeSnapshotOptions {
  items: readonly SnapshotRenderItem[];
  background?: string;
  padding?: number;
  minimumWidth?: number;
  minimumHeight?: number;
  limits?: SnapshotSafetyLimits;
}

export interface ComposedSnapshot {
  svg: string;
  width: number;
  height: number;
  viewBox: Readonly<{ x: number; y: number; width: number; height: number }>;
  diagnostics: readonly PluginDiagnostic[];
}

const LAYERS: Readonly<Record<SnapshotContribution['layer'], number>> = { underlay: 0, content: 1, overlay: 2 };

function diagnosticFor(item: SnapshotRenderItem, rendererFailed = false): PluginDiagnostic {
  const pluginId = item.element.type.slice(0, item.element.type.lastIndexOf('/'));
  if (item.diagnostic) return item.diagnostic;
  const status = rendererFailed ? 'failed' : item.status;
  return {
    code: `snapshot_renderer_${status}`,
    severity: status === 'unsupported' ? 'warning' : 'error',
    message:
      status === 'missing'
        ? `No active snapshot renderer is available for ${item.element.type}.`
        : status === 'unsupported'
          ? `${item.element.type} does not support deterministic snapshots.`
          : `Snapshot renderer failed for ${item.element.type}.`,
    retryable: status === 'failed',
    pluginId,
    elementId: item.element.id
  };
}

function diagnosticContribution(item: SnapshotRenderItem, diagnostic: PluginDiagnostic): SnapshotContribution {
  const width = Math.max(120, item.element.width ?? 240);
  const height = Math.max(52, item.element.height ?? 84);
  const title = diagnostic.code.includes('missing')
    ? 'Plugin unavailable'
    : diagnostic.code.includes('unsupported')
      ? 'Snapshot unavailable'
      : 'Renderer error';
  const message = diagnostic.message.length > 180 ? `${diagnostic.message.slice(0, 177)}…` : diagnostic.message;
  return {
    space: 'frame',
    layer: 'content',
    nodes: [
      { kind: 'rect', x: 0, y: 0, width, height, rx: 8, fill: '#fef2f2', stroke: '#fca5a5', strokeWidth: 1 },
      {
        kind: 'text',
        x: 12,
        y: 22,
        text: title,
        fill: '#7f1d1d',
        fontFamily: 'system-ui',
        fontSize: 12,
        fontWeight: 700
      },
      {
        kind: 'text',
        x: 12,
        y: 42,
        text: message,
        fill: '#991b1b',
        fontFamily: 'system-ui',
        fontSize: 10,
        maxWidth: width - 24
      }
    ]
  };
}

interface PreparedItem {
  item: SnapshotRenderItem;
  contribution: SnapshotContribution;
  order: number;
}

function safeBackground(value: string | undefined): string {
  const background = value ?? '#ffffff';
  if (!/^(?:#[0-9a-f]{3,8}|[a-z]+|(?:rgb|rgba|hsl|hsla)\([0-9.%+, /-]+\))$/i.test(background)) {
    throw new SnapshotSafetyError('snapshot_paint_invalid', 'Snapshot background is not a safe color');
  }
  return background;
}

function contributionBounds(prepared: PreparedItem): SnapshotBounds | null {
  let bounds = prepared.contribution.nodes.reduce<SnapshotBounds | null>(
    (result, node) => unionBounds(result, snapshotNodeBounds(node)),
    null
  );
  if (!bounds || prepared.contribution.space === 'world') return bounds;
  const element = prepared.item.element;
  const width = element.width ?? Math.max(0, bounds.maxX - bounds.minX);
  const height = element.height ?? Math.max(0, bounds.maxY - bounds.minY);
  bounds = transformBounds(bounds, envelopeMatrix(element.x, element.y, width, height, element.rotation ?? 0));
  return bounds;
}

function envelopeTransform(element: Readonly<CanvasElement>, bounds: SnapshotBounds | null): string {
  const width = element.width ?? (bounds ? bounds.maxX - bounds.minX : 0);
  const height = element.height ?? (bounds ? bounds.maxY - bounds.minY : 0);
  const matrix = envelopeMatrix(element.x, element.y, width, height, element.rotation ?? 0);
  return `matrix(${matrix.join(' ')})`;
}

export function composeSnapshot(options: ComposeSnapshotOptions): ComposedSnapshot {
  const limits = options.limits ?? DEFAULT_SNAPSHOT_LIMITS;
  const diagnostics: PluginDiagnostic[] = [];
  const prepared: PreparedItem[] = [];
  for (const [order, item] of options.items.entries()) {
    let contribution = item.contribution;
    if (item.status !== 'supported' || !contribution) {
      const diagnostic = diagnosticFor(item);
      diagnostics.push(diagnostic);
      contribution = diagnosticContribution(item, diagnostic);
    }
    try {
      validateSnapshotContribution(contribution, limits);
      diagnostics.push(...(contribution.diagnostics ?? []));
      prepared.push({ item, contribution, order });
    } catch (error) {
      if (error instanceof SnapshotSafetyError && error.hardLimit) throw error;
      const diagnostic = diagnosticFor(item, true);
      diagnostics.push(diagnostic);
      const fallback = diagnosticContribution(item, diagnostic);
      validateSnapshotContribution(fallback, limits);
      prepared.push({ item, contribution: fallback, order });
    }
  }
  validateSnapshotContribution(
    {
      space: 'world',
      layer: 'content',
      nodes: prepared.flatMap((item) => item.contribution.nodes)
    },
    limits
  );
  prepared.sort(
    (left, right) =>
      LAYERS[left.contribution.layer] - LAYERS[right.contribution.layer] ||
      (left.item.element.zIndex ?? 0) - (right.item.element.zIndex ?? 0) ||
      left.order - right.order
  );
  let bounds = prepared.reduce<SnapshotBounds | null>(
    (result, item) => unionBounds(result, contributionBounds(item)),
    null
  );
  const padding = Math.max(0, options.padding ?? 24);
  if (!bounds) bounds = { minX: 0, minY: 0, maxX: options.minimumWidth ?? 1, maxY: options.minimumHeight ?? 1 };
  const contentWidth = Math.max(options.minimumWidth ?? 1, bounds.maxX - bounds.minX);
  const contentHeight = Math.max(options.minimumHeight ?? 1, bounds.maxY - bounds.minY);
  const viewBox = {
    x: bounds.minX - padding,
    y: bounds.minY - padding,
    width: contentWidth + padding * 2,
    height: contentHeight + padding * 2
  };
  const definitions: string[] = [];
  let clipCounter = 0;
  const serializationContext = {
    nextClipId: () => `agentcanvas-clip-${++clipCounter}`,
    addDefinition: (svg: string) => definitions.push(svg),
    resourceUrl: (handle: string) => `/api/v1/resources/${encodeURIComponent(handle)}/content`
  };
  const bodies = prepared.map(({ item, contribution }) => {
    const nodeBounds = contribution.nodes.reduce<SnapshotBounds | null>(
      (result, node) => unionBounds(result, snapshotNodeBounds(node)),
      null
    );
    const nodes = contribution.nodes.map((node) => serializeSnapshotNode(node, serializationContext)).join('');
    if (contribution.space === 'world') {
      return `<g data-element-id="${escapeXml(item.element.id)}" opacity="${item.element.opacity ?? 1}">${nodes}</g>`;
    }
    const width = item.element.width ?? (nodeBounds ? nodeBounds.maxX - nodeBounds.minX : 0);
    const height = item.element.height ?? (nodeBounds ? nodeBounds.maxY - nodeBounds.minY : 0);
    let clip = '';
    if (width > 0 && height > 0) {
      const clipId = serializationContext.nextClipId();
      serializationContext.addDefinition(
        `<clipPath id="${clipId}"><rect x="0" y="0" width="${width}" height="${height}"/></clipPath>`
      );
      clip = ` clip-path="url(#${clipId})"`;
    }
    return `<g data-element-id="${escapeXml(item.element.id)}" transform="${envelopeTransform(
      item.element,
      nodeBounds
    )}" opacity="${item.element.opacity ?? 1}"${clip}>${nodes}</g>`;
  });
  const background = safeBackground(options.background);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${viewBox.width}" height="${viewBox.height}" viewBox="${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}" role="img"><rect x="${viewBox.x}" y="${viewBox.y}" width="${viewBox.width}" height="${viewBox.height}" fill="${escapeXml(background)}"/><defs>${definitions.join('')}</defs>${bodies.join('')}</svg>`;
  return Object.freeze({
    svg,
    width: Math.ceil(viewBox.width),
    height: Math.ceil(viewBox.height),
    viewBox: Object.freeze(viewBox),
    diagnostics: Object.freeze(diagnostics)
  });
}

export function snapshotDiagnosticItem(
  element: Readonly<CanvasElement>,
  status: Exclude<SnapshotRenderStatus, 'supported'>,
  diagnostic?: PluginDiagnostic
): SnapshotRenderItem {
  return { element, status, diagnostic };
}

export function supportedSnapshotItem(
  element: Readonly<CanvasElement>,
  contribution: SnapshotContribution
): SnapshotRenderItem {
  return { element, status: 'supported', contribution };
}
