import { deflateSync } from 'node:zlib';
import JSZip from 'jszip';
import type { BBox, BBoxData, OverlayPath, PathData } from './contracts.js';
import { maskFilename, maskFolderName } from './exports.js';
import { overlayAccent } from './geometry.js';

const PNG_SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
const MAX_EXPORT_PIXELS = 16_777_216;
const MAX_MASK_PIXELS = 67_108_864;
const MAX_PATH_SEGMENTS = 200_000;
const ZIP_DATE = new Date('1980-01-01T00:00:00.000Z');

interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

interface Point {
  x: number;
  y: number;
}

interface FlatPath {
  points: Point[];
  closed: boolean;
}

function dimensions(
  widthValue: number | undefined,
  heightValue: number | undefined
): { width: number; height: number } {
  if (!Number.isSafeInteger(widthValue) || !Number.isSafeInteger(heightValue) || !widthValue || !heightValue) {
    throw new TypeError('server exports require positive integer canvas dimensions');
  }
  const width = widthValue;
  const height = heightValue;
  if (width * height > MAX_EXPORT_PIXELS) throw new RangeError('overlay export exceeds the pixel limit');
  return { width, height };
}

function parseComponent(value: string): number {
  if (value.endsWith('%')) return Math.round((Number.parseFloat(value) / 100) * 255);
  return Number.parseFloat(value);
}

function parseAlpha(value: string): number {
  if (value.endsWith('%')) return Math.round((Number.parseFloat(value) / 100) * 255);
  return Math.round(Number.parseFloat(value) * 255);
}

function byte(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0 || value > 255) throw new TypeError(`${label} is outside the color range`);
  return Math.round(value);
}

function color(value: string | null | undefined, fallback?: string): Rgba {
  const source = (value ?? fallback)?.trim().toLowerCase();
  if (!source) throw new TypeError('overlay color is required');
  if (source === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };
  const named: Record<string, string> = {
    black: '#000000',
    white: '#ffffff',
    red: '#ff0000',
    green: '#008000',
    blue: '#0000ff',
    yellow: '#ffff00',
    orange: '#ffa500',
    purple: '#800080',
    gray: '#808080',
    grey: '#808080'
  };
  const normalized = named[source] ?? source;
  const hex = normalized.match(/^#([a-f0-9]{3,8})$/i)?.[1];
  if (hex) {
    if (hex.length === 3 || hex.length === 4) {
      return {
        r: Number.parseInt(`${hex[0]}${hex[0]}`, 16),
        g: Number.parseInt(`${hex[1]}${hex[1]}`, 16),
        b: Number.parseInt(`${hex[2]}${hex[2]}`, 16),
        a: hex.length === 4 ? Number.parseInt(`${hex[3]}${hex[3]}`, 16) : 255
      };
    }
    if (hex.length === 6 || hex.length === 8) {
      return {
        r: Number.parseInt(hex.slice(0, 2), 16),
        g: Number.parseInt(hex.slice(2, 4), 16),
        b: Number.parseInt(hex.slice(4, 6), 16),
        a: hex.length === 8 ? Number.parseInt(hex.slice(6, 8), 16) : 255
      };
    }
  }
  const functional = normalized.match(/^rgba?\((.+)\)$/);
  if (functional) {
    const parts = functional[1]?.split(',').map((part) => part.trim()) ?? [];
    if (parts.length === 3 || parts.length === 4) {
      return {
        r: byte(parseComponent(parts[0] as string), 'red'),
        g: byte(parseComponent(parts[1] as string), 'green'),
        b: byte(parseComponent(parts[2] as string), 'blue'),
        a: parts[3] === undefined ? 255 : byte(parseAlpha(parts[3]), 'alpha')
      };
    }
  }
  throw new TypeError(`server export does not support color ${source}`);
}

class Raster {
  readonly bytes: Uint8Array;

  constructor(
    readonly width: number,
    readonly height: number,
    background: Rgba
  ) {
    this.bytes = new Uint8Array(width * height * 4);
    for (let offset = 0; offset < this.bytes.length; offset += 4) {
      this.bytes[offset] = background.r;
      this.bytes[offset + 1] = background.g;
      this.bytes[offset + 2] = background.b;
      this.bytes[offset + 3] = background.a;
    }
  }

  pixel(xValue: number, yValue: number, source: Rgba): void {
    const x = Math.round(xValue);
    const y = Math.round(yValue);
    if (x < 0 || y < 0 || x >= this.width || y >= this.height || source.a === 0) return;
    const offset = (y * this.width + x) * 4;
    if (source.a === 255) {
      this.bytes[offset] = source.r;
      this.bytes[offset + 1] = source.g;
      this.bytes[offset + 2] = source.b;
      this.bytes[offset + 3] = 255;
      return;
    }
    const sourceAlpha = source.a / 255;
    const targetAlpha = (this.bytes[offset + 3] as number) / 255;
    const outputAlpha = sourceAlpha + targetAlpha * (1 - sourceAlpha);
    if (outputAlpha === 0) return;
    this.bytes[offset] = Math.round(
      (source.r * sourceAlpha + (this.bytes[offset] as number) * targetAlpha * (1 - sourceAlpha)) / outputAlpha
    );
    this.bytes[offset + 1] = Math.round(
      (source.g * sourceAlpha + (this.bytes[offset + 1] as number) * targetAlpha * (1 - sourceAlpha)) / outputAlpha
    );
    this.bytes[offset + 2] = Math.round(
      (source.b * sourceAlpha + (this.bytes[offset + 2] as number) * targetAlpha * (1 - sourceAlpha)) / outputAlpha
    );
    this.bytes[offset + 3] = Math.round(outputAlpha * 255);
  }

  fillRect(x: number, y: number, width: number, height: number, fill: Rgba): void {
    const left = Math.max(0, Math.floor(x));
    const top = Math.max(0, Math.floor(y));
    const right = Math.min(this.width, Math.ceil(x + width));
    const bottom = Math.min(this.height, Math.ceil(y + height));
    for (let py = top; py < bottom; py += 1) {
      for (let px = left; px < right; px += 1) this.pixel(px, py, fill);
    }
  }

  disk(x: number, y: number, radius: number, fill: Rgba): void {
    const safeRadius = Math.max(0.5, radius);
    const left = Math.floor(x - safeRadius);
    const right = Math.ceil(x + safeRadius);
    const top = Math.floor(y - safeRadius);
    const bottom = Math.ceil(y + safeRadius);
    const squared = safeRadius * safeRadius;
    for (let py = top; py <= bottom; py += 1) {
      for (let px = left; px <= right; px += 1) {
        if ((px - x) ** 2 + (py - y) ** 2 <= squared) this.pixel(px, py, fill);
      }
    }
  }

  line(from: Point, to: Point, width: number, stroke: Rgba): void {
    if (width <= 0 || stroke.a === 0) return;
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy))));
    for (let step = 0; step <= steps; step += 1) {
      const ratio = step / steps;
      this.disk(from.x + dx * ratio, from.y + dy * ratio, width / 2, stroke);
    }
  }

  strokeRect(x: number, y: number, width: number, height: number, strokeWidth: number, stroke: Rgba): void {
    if (strokeWidth <= 0 || stroke.a === 0) return;
    const half = strokeWidth / 2;
    this.fillRect(x - half, y - half, width + strokeWidth, strokeWidth, stroke);
    this.fillRect(x - half, y + height - half, width + strokeWidth, strokeWidth, stroke);
    this.fillRect(x - half, y + half, strokeWidth, Math.max(0, height - strokeWidth), stroke);
    this.fillRect(x + width - half, y + half, strokeWidth, Math.max(0, height - strokeWidth), stroke);
  }

  fillPolygon(points: readonly Point[], fill: Rgba): void {
    if (points.length < 3 || fill.a === 0) return;
    let lowest = Number.POSITIVE_INFINITY;
    let highest = Number.NEGATIVE_INFINITY;
    for (const point of points) {
      lowest = Math.min(lowest, point.y);
      highest = Math.max(highest, point.y);
    }
    const minY = Math.max(0, Math.floor(lowest));
    const maxY = Math.min(this.height - 1, Math.ceil(highest));
    for (let y = minY; y <= maxY; y += 1) {
      const intersections: number[] = [];
      for (let index = 0; index < points.length; index += 1) {
        const first = points[index] as Point;
        const second = points[(index + 1) % points.length] as Point;
        if ((first.y <= y && second.y > y) || (second.y <= y && first.y > y)) {
          intersections.push(first.x + ((y - first.y) * (second.x - first.x)) / (second.y - first.y));
        }
      }
      intersections.sort((left, right) => left - right);
      for (let index = 0; index + 1 < intersections.length; index += 2) {
        this.fillRect(
          intersections[index] as number,
          y,
          (intersections[index + 1] as number) - (intersections[index] as number),
          1,
          fill
        );
      }
    }
  }
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const value of bytes) {
    crc ^= value;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function uint32(value: number): Uint8Array {
  return new Uint8Array([(value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255]);
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const result = new Uint8Array(parts.reduce((total, part) => total + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.byteLength;
  }
  return result;
}

function chunk(name: string, data: Uint8Array): Uint8Array {
  const type = new TextEncoder().encode(name);
  const body = concat([type, data]);
  return concat([uint32(data.byteLength), body, uint32(crc32(body))]);
}

function encodePng(raster: Raster): Uint8Array {
  const rows = new Uint8Array((raster.width * 4 + 1) * raster.height);
  for (let y = 0; y < raster.height; y += 1) {
    const target = y * (raster.width * 4 + 1);
    rows[target] = 0;
    rows.set(raster.bytes.subarray(y * raster.width * 4, (y + 1) * raster.width * 4), target + 1);
  }
  const header = new Uint8Array(13);
  header.set(uint32(raster.width), 0);
  header.set(uint32(raster.height), 4);
  header.set([8, 6, 0, 0, 0], 8);
  return concat([
    PNG_SIGNATURE,
    chunk('IHDR', header),
    chunk('IDAT', new Uint8Array(deflateSync(rows, { level: 9 }))),
    chunk('IEND', new Uint8Array())
  ]);
}

function cubic(from: Point, first: Point, second: Point, to: Point, ratio: number): Point {
  const inverse = 1 - ratio;
  return {
    x:
      inverse ** 3 * from.x +
      3 * inverse ** 2 * ratio * first.x +
      3 * inverse * ratio ** 2 * second.x +
      ratio ** 3 * to.x,
    y:
      inverse ** 3 * from.y +
      3 * inverse ** 2 * ratio * first.y +
      3 * inverse * ratio ** 2 * second.y +
      ratio ** 3 * to.y
  };
}

function quadratic(from: Point, control: Point, to: Point, ratio: number): Point {
  const inverse = 1 - ratio;
  return {
    x: inverse ** 2 * from.x + 2 * inverse * ratio * control.x + ratio ** 2 * to.x,
    y: inverse ** 2 * from.y + 2 * inverse * ratio * control.y + ratio ** 2 * to.y
  };
}

function vectorAngle(ux: number, uy: number, vx: number, vy: number): number {
  const divisor = Math.sqrt((ux ** 2 + uy ** 2) * (vx ** 2 + vy ** 2));
  if (divisor === 0) return 0;
  const ratio = Math.min(1, Math.max(-1, (ux * vx + uy * vy) / divisor));
  return (ux * vy - uy * vx < 0 ? -1 : 1) * Math.acos(ratio);
}

function arcPoints(
  from: Point,
  rxValue: number,
  ryValue: number,
  rotation: number,
  largeArc: number,
  sweep: number,
  to: Point
): Point[] {
  let rx = Math.abs(rxValue);
  let ry = Math.abs(ryValue);
  if (rx === 0 || ry === 0 || (from.x === to.x && from.y === to.y)) return [to];
  const phi = (rotation * Math.PI) / 180;
  const cosine = Math.cos(phi);
  const sine = Math.sin(phi);
  const dx = (from.x - to.x) / 2;
  const dy = (from.y - to.y) / 2;
  const xPrime = cosine * dx + sine * dy;
  const yPrime = -sine * dx + cosine * dy;
  const scale = Math.sqrt(xPrime ** 2 / rx ** 2 + yPrime ** 2 / ry ** 2);
  if (scale > 1) {
    rx *= scale;
    ry *= scale;
  }
  const numerator = Math.max(0, rx ** 2 * ry ** 2 - rx ** 2 * yPrime ** 2 - ry ** 2 * xPrime ** 2);
  const denominator = rx ** 2 * yPrime ** 2 + ry ** 2 * xPrime ** 2;
  const factor = (largeArc === sweep ? -1 : 1) * Math.sqrt(denominator === 0 ? 0 : numerator / denominator);
  const cxPrime = factor * ((rx * yPrime) / ry);
  const cyPrime = factor * (-(ry * xPrime) / rx);
  const center = {
    x: cosine * cxPrime - sine * cyPrime + (from.x + to.x) / 2,
    y: sine * cxPrime + cosine * cyPrime + (from.y + to.y) / 2
  };
  const start = vectorAngle(1, 0, (xPrime - cxPrime) / rx, (yPrime - cyPrime) / ry);
  let delta = vectorAngle(
    (xPrime - cxPrime) / rx,
    (yPrime - cyPrime) / ry,
    (-xPrime - cxPrime) / rx,
    (-yPrime - cyPrime) / ry
  );
  if (!sweep && delta > 0) delta -= Math.PI * 2;
  if (sweep && delta < 0) delta += Math.PI * 2;
  const steps = Math.max(4, Math.min(128, Math.ceil(Math.abs(delta) / (Math.PI / 16))));
  return Array.from({ length: steps }, (_, index) => {
    const angle = start + (delta * (index + 1)) / steps;
    return {
      x: center.x + cosine * rx * Math.cos(angle) - sine * ry * Math.sin(angle),
      y: center.y + sine * rx * Math.cos(angle) + cosine * ry * Math.sin(angle)
    };
  });
}

function flattenPath(source: string): FlatPath[] {
  const tokens = source.match(/[AaCcHhLlMmQqSsTtVvZz]|[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g) ?? [];
  const residue = source
    .replace(/[AaCcHhLlMmQqSsTtVvZz]|[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g, '')
    .replace(/[\s,]/g, '');
  if (residue || tokens.length === 0) throw new TypeError('path contains unsupported syntax');
  const paths: FlatPath[] = [];
  let tokenIndex = 0;
  let command = '';
  let current: Point = { x: 0, y: 0 };
  let start: Point = { x: 0, y: 0 };
  let active: FlatPath | undefined;
  let lastCubic: Point | undefined;
  let lastQuadratic: Point | undefined;
  let segments = 0;
  const isCommand = (value: string | undefined) => Boolean(value && /^[A-Za-z]$/.test(value));
  const number = (): number => {
    const token = tokens[tokenIndex];
    if (token === undefined || isCommand(token)) throw new TypeError(`path command ${command} is missing parameters`);
    tokenIndex += 1;
    const value = Number(token);
    if (!Number.isFinite(value)) throw new TypeError('path coordinate must be finite');
    return value;
  };
  const point = (relative: boolean): Point => {
    const x = number();
    const y = number();
    return relative ? { x: current.x + x, y: current.y + y } : { x, y };
  };
  const add = (value: Point): void => {
    if (!active) throw new TypeError('path must begin with a move command');
    active.points.push(value);
    current = value;
    segments += 1;
    if (segments > MAX_PATH_SEGMENTS) throw new RangeError('path export exceeds the segment limit');
  };
  while (tokenIndex < tokens.length) {
    if (isCommand(tokens[tokenIndex])) command = tokens[tokenIndex++] as string;
    if (!command) throw new TypeError('path must begin with a command');
    const relative = command === command.toLowerCase();
    const upper = command.toUpperCase();
    if (upper === 'Z') {
      if (!active) throw new TypeError('close command requires an active path');
      active.closed = true;
      current = start;
      lastCubic = undefined;
      lastQuadratic = undefined;
      command = '';
      continue;
    }
    if (upper === 'M') {
      const next = point(relative);
      active = { points: [next], closed: false };
      paths.push(active);
      current = next;
      start = next;
      command = relative ? 'l' : 'L';
      lastCubic = undefined;
      lastQuadratic = undefined;
      continue;
    }
    if (!active) throw new TypeError('path must begin with a move command');
    if (upper === 'L') add(point(relative));
    else if (upper === 'H') add({ x: relative ? current.x + number() : number(), y: current.y });
    else if (upper === 'V') add({ x: current.x, y: relative ? current.y + number() : number() });
    else if (upper === 'C') {
      const first = point(relative);
      const second = point(relative);
      const to = point(relative);
      const from = current;
      for (let step = 1; step <= 16; step += 1) add(cubic(from, first, second, to, step / 16));
      lastCubic = second;
      lastQuadratic = undefined;
    } else if (upper === 'S') {
      const first = lastCubic ? { x: current.x * 2 - lastCubic.x, y: current.y * 2 - lastCubic.y } : current;
      const second = point(relative);
      const to = point(relative);
      const from = current;
      for (let step = 1; step <= 16; step += 1) add(cubic(from, first, second, to, step / 16));
      lastCubic = second;
      lastQuadratic = undefined;
    } else if (upper === 'Q') {
      const control = point(relative);
      const to = point(relative);
      const from = current;
      for (let step = 1; step <= 12; step += 1) add(quadratic(from, control, to, step / 12));
      lastQuadratic = control;
      lastCubic = undefined;
    } else if (upper === 'T') {
      const control = lastQuadratic
        ? { x: current.x * 2 - lastQuadratic.x, y: current.y * 2 - lastQuadratic.y }
        : current;
      const to = point(relative);
      const from = current;
      for (let step = 1; step <= 12; step += 1) add(quadratic(from, control, to, step / 12));
      lastQuadratic = control;
      lastCubic = undefined;
    } else if (upper === 'A') {
      const rx = number();
      const ry = number();
      const rotation = number();
      const largeArc = number();
      const sweep = number();
      if ((largeArc !== 0 && largeArc !== 1) || (sweep !== 0 && sweep !== 1))
        throw new TypeError('path arc flags must be 0 or 1');
      const to = point(relative);
      for (const value of arcPoints(current, rx, ry, rotation, largeArc, sweep, to)) add(value);
      lastCubic = undefined;
      lastQuadratic = undefined;
    } else {
      throw new TypeError(`path command ${command} is unsupported`);
    }
    if (upper !== 'C' && upper !== 'S') lastCubic = undefined;
    if (upper !== 'Q' && upper !== 'T') lastQuadratic = undefined;
  }
  return paths;
}

function renderBox(raster: Raster, box: BBox, index: number): void {
  const stroke = color(box.color, overlayAccent(index));
  const fill = color(box.fill, `${overlayAccent(index)}22`);
  raster.fillRect(box.x, box.y, box.width, box.height, fill);
  raster.strokeRect(
    box.x,
    box.y,
    box.width,
    box.height,
    box.strokeWidth ?? Math.max(2, Math.round(raster.width / 512)),
    stroke
  );
}

function renderOverlayPath(raster: Raster, path: OverlayPath, index: number): void {
  const stroke = color(path.color, overlayAccent(index));
  const fill = color(path.fill, 'transparent');
  const flat = flattenPath(path.d);
  for (const part of flat) {
    if (fill.a > 0) raster.fillPolygon(part.points, fill);
    for (let pointIndex = 1; pointIndex < part.points.length; pointIndex += 1) {
      raster.line(
        part.points[pointIndex - 1] as Point,
        part.points[pointIndex] as Point,
        path.strokeWidth ?? 2,
        stroke
      );
    }
    if (part.closed && part.points.length > 1) {
      raster.line(part.points[part.points.length - 1] as Point, part.points[0] as Point, path.strokeWidth ?? 2, stroke);
    }
  }
}

export function renderBBoxPng(data: BBoxData, signal: AbortSignal): Uint8Array {
  signal.throwIfAborted();
  const { width, height } = dimensions(data.canvasWidth, data.canvasHeight);
  const raster = new Raster(width, height, color(data.background, '#f8fafc'));
  for (const [index, box] of (data.boxes ?? []).entries()) {
    signal.throwIfAborted();
    renderBox(raster, box, index);
  }
  signal.throwIfAborted();
  return encodePng(raster);
}

export function renderPathPng(data: PathData, signal: AbortSignal): Uint8Array {
  signal.throwIfAborted();
  const { width, height } = dimensions(data.canvasWidth, data.canvasHeight);
  const raster = new Raster(width, height, color(data.background, '#f8fafc'));
  for (const [index, path] of data.paths.entries()) {
    signal.throwIfAborted();
    renderOverlayPath(raster, path, index);
  }
  signal.throwIfAborted();
  return encodePng(raster);
}

export async function renderMaskZip(data: BBoxData, elementId: string, signal: AbortSignal): Promise<Uint8Array> {
  signal.throwIfAborted();
  const { width, height } = dimensions(data.canvasWidth, data.canvasHeight);
  const boxes = data.boxes ?? [];
  if (width * height * Math.max(1, boxes.length) > MAX_MASK_PIXELS) {
    throw new RangeError('mask ZIP export exceeds the aggregate pixel limit');
  }
  const zip = new JSZip();
  const folder = maskFolderName(elementId, width, height);
  for (const [index, box] of boxes.entries()) {
    signal.throwIfAborted();
    const raster = new Raster(width, height, color('#000000'));
    raster.fillRect(box.x, box.y, box.width, box.height, color('#ffffff'));
    zip.file(`${folder}/${maskFilename(index, box.label ?? box.id)}`, encodePng(raster), {
      binary: true,
      createFolders: false,
      date: ZIP_DATE
    });
  }
  const bytes = await zip.generateAsync({
    type: 'uint8array',
    compression: 'DEFLATE',
    compressionOptions: { level: 9 },
    platform: 'DOS'
  });
  signal.throwIfAborted();
  return bytes;
}
