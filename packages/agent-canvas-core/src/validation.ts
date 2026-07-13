import type { CanvasBounds, CanvasElement, CanvasViewport, CanvasViewportInput } from './contracts.js';
import { CanvasError } from './errors.js';

export const LIMITS = {
  maxCanvasWidth: 20_000,
  maxCanvasHeight: 20_000,
  maxElements: 2_000,
  minZoom: 0.05,
  maxZoom: 8,
  defaultViewportWidth: 1920,
  defaultViewportHeight: 900
};

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;

function validation(message: string): never {
  throw new CanvasError('validation_error', message, 'validation', 400, false);
}

function finite(value: unknown, label: string, fallback?: number): number {
  if (value === undefined || value === null) {
    if (fallback !== undefined) return fallback;
    validation(`${label} is required`);
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) validation(`${label} must be finite`);
  return value;
}

export function normalizeCanvasBounds(
  value: unknown,
  legacySize: { width?: unknown; height?: unknown } = {}
): CanvasBounds {
  if (value === undefined && (legacySize.width !== undefined || legacySize.height !== undefined)) {
    if (legacySize.width === undefined || legacySize.height === undefined) {
      validation('legacy canvas width and height must be provided together');
    }
    value = { mode: 'fixed', width: legacySize.width, height: legacySize.height };
  }
  if (value === undefined || value === null) return { mode: 'unlimited' };
  if (typeof value !== 'object' || Array.isArray(value)) validation('canvas bounds must be an object');
  const input = value as Record<string, unknown>;
  if (input.mode === 'unlimited' || input.mode === 'infinite') return { mode: 'unlimited' };
  if (input.mode !== 'fixed') validation('canvas bounds mode must be unlimited or fixed');
  const width = finite(input.width, 'canvas.bounds.width');
  const height = finite(input.height, 'canvas.bounds.height');
  if (width <= 0 || height <= 0) validation('fixed canvas width and height must be positive');
  if (width > LIMITS.maxCanvasWidth || height > LIMITS.maxCanvasHeight) {
    validation(`fixed canvas bounds cannot exceed ${LIMITS.maxCanvasWidth}x${LIMITS.maxCanvasHeight}`);
  }
  return { mode: 'fixed', width: Math.round(width), height: Math.round(height) };
}

export function validateSafeId(value: unknown, label = 'id'): string {
  if (typeof value !== 'string' || !SAFE_ID.test(value)) validation(`${label} must be a safe non-empty string`);
  return value;
}

export function ensureElementCap(elements: readonly CanvasElement[]): void {
  if (elements.length > LIMITS.maxElements) validation(`canvas exceeds ${LIMITS.maxElements} elements`);
}

export function defaultViewport(bounds: CanvasBounds = { mode: 'unlimited' }): CanvasViewport {
  return {
    centerX: bounds.mode === 'fixed' ? bounds.width / 2 : 0,
    centerY: bounds.mode === 'fixed' ? bounds.height / 2 : 0,
    zoom: 1,
    width: LIMITS.defaultViewportWidth,
    height: LIMITS.defaultViewportHeight,
    source: 'default',
    updatedAt: null
  };
}

export function normalizeViewportInput(
  input: CanvasViewportInput | Record<string, unknown>,
  sourceFallback: 'user' | 'agent' = 'user'
): Omit<CanvasViewport, 'updatedAt'> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) validation('viewport payload must be an object');
  const value = input as Record<string, unknown>;
  const zoom = finite(value.zoom, 'viewport.zoom', 1);
  if (zoom < LIMITS.minZoom || zoom > LIMITS.maxZoom) {
    validation(`viewport.zoom must be between ${LIMITS.minZoom} and ${LIMITS.maxZoom}`);
  }
  const width = finite(value.width, 'viewport.width', LIMITS.defaultViewportWidth);
  const height = finite(value.height, 'viewport.height', LIMITS.defaultViewportHeight);
  if (width <= 0 || height <= 0) validation('viewport width and height must be positive');
  return {
    centerX: finite(value.centerX, 'viewport.centerX', 0),
    centerY: finite(value.centerY, 'viewport.centerY', 0),
    zoom,
    width: Math.round(width),
    height: Math.round(height),
    source: value.source === 'agent' || value.source === 'user' ? value.source : sourceFallback
  };
}
