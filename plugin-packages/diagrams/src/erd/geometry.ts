import type { SnapshotNode } from '@agentcanvas/extension-sdk';
import type { Cardinality, ErdData, ErdEntity } from '../contracts.js';
import { assertErd } from './validation.js';

export interface Point {
  x: number;
  y: number;
}
export interface Bounds extends Point {
  width: number;
  height: number;
}
export interface EntityGeometry extends Bounds {
  id: string;
  headerHeight: number;
  rowHeight: number;
  nameWidth: number;
  typeWidth: number;
  rows: { id: string; y: number; centerY: number }[];
}
export interface RelationshipGeometry {
  id: string;
  points: Point[];
  label: Point;
  sourceMarkers: SnapshotNode[];
  targetMarkers: SnapshotNode[];
}

/** Conservative width estimate shared by geometry and clipping; no DOM measurement is persisted. */
export function textWidth(value: string, fontSize = 12): number {
  return Math.ceil(value.length * fontSize * 0.7);
}
export function labelWidth(value: string, fontSize = 12): number {
  return Math.min((320 * fontSize) / 12, textWidth(value, fontSize));
}

export function entityGeometry(entity: ErdEntity): EntityGeometry {
  const fontSize = entity.appearance?.fontSize ?? 12;
  const headerHeight = (entity.alias ? 56 : 36) * Math.max(1, fontSize / 12);
  const minimumRowHeight = Math.max(28, fontSize + 16);
  const height = Math.max(entity.height ?? 0, headerHeight + Math.max(1, entity.attributes.length) * minimumRowHeight);
  const rowHeight = (height - headerHeight) / Math.max(1, entity.attributes.length);
  const attributeNameWidth = Math.max(1, ...entity.attributes.map((attribute) => textWidth(attribute.name, fontSize)));
  const attributeTypeWidth = Math.max(
    1,
    ...entity.attributes.map((attribute) => textWidth(attribute.dataType, fontSize))
  );
  const width =
    entity.width ??
    Math.min(
      640,
      Math.max(
        280,
        24 +
          Math.max(
            textWidth(entity.name, 14),
            textWidth(entity.alias ?? ''),
            attributeNameWidth + attributeTypeWidth + 156
          )
      )
    );
  const nameWidth = ((width - 156) * attributeNameWidth) / (attributeNameWidth + attributeTypeWidth);
  return {
    id: entity.id,
    x: entity.x,
    y: entity.y,
    width,
    nameWidth,
    typeWidth: width - 156 - nameWidth,
    height,
    headerHeight,
    rowHeight,
    rows: entity.attributes.map((attribute, index) => ({
      id: attribute.id,
      y: entity.y + headerHeight + index * rowHeight,
      centerY: entity.y + headerHeight + (index + 0.5) * rowHeight
    }))
  };
}

/** Shared world geometry for browser hit targets, vector snapshots, and layout dimensions. */
export function diagramGeometry(data: ErdData): {
  entities: EntityGeometry[];
  relationships: RelationshipGeometry[];
  bounds: Bounds;
} {
  assertErd(data);
  const entities = data.entities.map(entityGeometry);
  const pairKey = (source: string, target: string) => JSON.stringify([source, target].sort());
  const siblings = new Map<string, string[]>();
  for (const relationship of data.relationships) {
    const key = pairKey(relationship.source.entityId, relationship.target.entityId);
    const ids = siblings.get(key) ?? [];
    ids.push(relationship.id);
    siblings.set(key, ids);
  }
  for (const ids of siblings.values()) ids.sort();
  const relationships = data.relationships.map((relationship) => {
    const source = entities[entities.findIndex((entity) => entity.id === relationship.source.entityId)];
    const target = entities[entities.findIndex((entity) => entity.id === relationship.target.entityId)];
    const ids = siblings.get(pairKey(source.id, target.id));
    if (!ids) throw new Error('Relationship lane group is missing');
    const lane = ids.indexOf(relationship.id);
    const offset = (lane - (ids.length - 1) / 2) * 18;
    const anchorY = (entity: EntityGeometry, attributeId?: string) =>
      attributeId === undefined
        ? entity.y + entity.headerHeight / 2
        : entity.rows[entity.rows.findIndex((row) => row.id === attributeId)].centerY;
    const sy = anchorY(source, relationship.source.attributeId);
    const ty = anchorY(target, relationship.target.attributeId);
    let points: Point[];
    if (source.id === target.id) {
      const right = source.x + source.width;
      const outside = right + 48 + lane * 24;
      const bottom = source.y + source.height + 32 + lane * 24;
      points = [
        { x: right, y: sy - 6 },
        { x: outside, y: sy - 6 },
        { x: outside, y: bottom },
        { x: outside + 20, y: bottom },
        { x: outside + 20, y: ty + 6 },
        { x: right, y: ty + 6 }
      ];
    } else if (target.x >= source.x + source.width + 80 || source.x >= target.x + target.width + 80) {
      const rightward = target.x > source.x;
      const sx = source.x + (rightward ? source.width : 0);
      const tx = target.x + (rightward ? 0 : target.width);
      const direction = rightward ? 1 : -1;
      const mid = (sx + tx) / 2;
      // The outer lane keeps coincident-row parallel edges distinct without shortening cardinality stems.
      points = [
        { x: sx, y: sy },
        { x: sx + direction * 32, y: sy },
        { x: sx + direction * 32, y: sy + offset },
        { x: mid, y: sy + offset },
        { x: mid, y: ty + offset },
        { x: tx - direction * 32, y: ty + offset },
        { x: tx - direction * 32, y: ty },
        { x: tx, y: ty }
      ];
    } else {
      const right = Math.max(source.x + source.width, target.x + target.width) + 48 + lane * 24;
      points = [
        { x: source.x + source.width, y: sy },
        { x: right, y: sy },
        { x: right, y: ty },
        { x: target.x + target.width, y: ty }
      ];
    }
    if (relationship.bends?.length) points = [points[0], ...relationship.bends, points[points.length - 1]];
    points = points.filter(
      (point, index) => index === 0 || point.x !== points[index - 1].x || point.y !== points[index - 1].y
    );
    return {
      id: relationship.id,
      points,
      label: relationship.labelPosition ?? midpoint(points),
      sourceMarkers: cardinalityMarkers(points[0], points[1], relationship.source.cardinality),
      targetMarkers: cardinalityMarkers(
        points[points.length - 1],
        points[points.length - 2],
        relationship.target.cardinality
      )
    };
  });
  const extents: Bounds[] = entities.map((entity) => entity);
  for (const [index, relationship] of relationships.entries()) {
    for (const point of relationship.points) extents.push({ x: point.x - 8, y: point.y - 8, width: 16, height: 16 });
    const label = data.relationships[index].label;
    if (label)
      extents.push({
        x: relationship.label.x - labelWidth(label, data.relationships[index].appearance?.fontSize ?? 12) / 2 - 6,
        y: relationship.label.y - (data.relationships[index].appearance?.fontSize ?? 12),
        width: labelWidth(label, data.relationships[index].appearance?.fontSize ?? 12) + 12,
        height: (data.relationships[index].appearance?.fontSize ?? 12) * 2
      });
  }
  if (!extents.length) return { entities, relationships, bounds: { x: 0, y: 0, width: 320, height: 96 } };
  const x = Math.min(...extents.map((item) => item.x)) - 16;
  const y = Math.min(...extents.map((item) => item.y)) - (data.title ? 48 : 16);
  const right = Math.max(...extents.map((item) => item.x + item.width)) + 16;
  const bottom = Math.max(...extents.map((item) => item.y + item.height)) + 16;
  return {
    entities,
    relationships,
    bounds: {
      x,
      y,
      width: Math.max(right - x, data.title ? Math.min(640, data.title.length * 9) + 32 : 0),
      height: bottom - y
    }
  };
}

function midpoint(points: Point[]): Point {
  const lengths = points
    .slice(1)
    .map((point, index) => Math.hypot(point.x - points[index].x, point.y - points[index].y));
  let remaining = lengths.reduce((sum, length) => sum + length, 0) / 2;
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

function cardinalityMarkers(at: Point, toward: Point, cardinality: Cardinality): SnapshotNode[] {
  if (!toward) return [];
  const length = Math.hypot(toward.x - at.x, toward.y - at.y);
  if (!length) return [];
  const dx = (toward.x - at.x) / length;
  const dy = (toward.y - at.y) / length;
  const point = (along: number, across: number): Point => ({
    x: at.x + dx * along - dy * across,
    y: at.y + dy * along + dx * across
  });
  const line = (a: Point, b: Point): SnapshotNode => ({
    kind: 'line',
    x1: a.x,
    y1: a.y,
    x2: b.x,
    y2: b.y,
    stroke: 'currentColor',
    strokeWidth: 1.5
  });
  const nodes: SnapshotNode[] = [];
  if (cardinality.endsWith('many')) {
    for (const across of [-7, 0, 7]) nodes.push(line(point(2, across), point(14, 0)));
  } else nodes.push(line(point(8, -7), point(8, 7)));
  if (cardinality.startsWith('zero')) {
    const center = point(23, 0);
    nodes.push({
      kind: 'ellipse',
      cx: center.x,
      cy: center.y,
      rx: 4,
      ry: 4,
      fill: 'none',
      stroke: 'currentColor',
      strokeWidth: 1.5
    });
  } else nodes.push(line(point(22, -7), point(22, 7)));
  return nodes;
}
