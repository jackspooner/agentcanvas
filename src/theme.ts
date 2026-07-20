import { CANVAS_THEME_V1_SCHEMA, type CanvasThemeV1 } from '@agentcanvas/plugin-sdk';
import Ajv2020 from 'ajv/dist/2020.js';
import { CanvasError } from './errors.js';

const validateSchema = new Ajv2020({ allErrors: true, strict: true }).compile(CANVAS_THEME_V1_SCHEMA);

function luminance(color: string): number {
  const channels = [1, 3, 5].map((offset) => Number.parseInt(color.slice(offset, offset + 2), 16) / 255);
  const [red, green, blue] = channels.map((value) =>
    value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  );
  return red * 0.2126 + green * 0.7152 + blue * 0.0722;
}

export function themeContrast(foreground: string, background: string): number {
  const lighter = Math.max(luminance(foreground), luminance(background));
  const darker = Math.min(luminance(foreground), luminance(background));
  return (lighter + 0.05) / (darker + 0.05);
}

function requireContrast(
  theme: CanvasThemeV1,
  foreground: keyof CanvasThemeV1['colors'],
  background: keyof CanvasThemeV1['colors']
): void {
  if (themeContrast(theme.colors[foreground], theme.colors[background]) < 4.5) {
    throw new CanvasError(
      'validation_error',
      `canvas theme ${String(foreground)} must have at least 4.5:1 contrast against ${String(background)}`,
      'validation',
      400
    );
  }
}

/** Validates and clones an untrusted public CanvasThemeV1 value. */
export function normalizeCanvasTheme(value: unknown): CanvasThemeV1 {
  if (!validateSchema(value)) {
    const detail = validateSchema.errors?.[0];
    throw new CanvasError(
      'validation_error',
      `canvas theme is invalid${detail ? ` at ${detail.instancePath || '/'}: ${detail.message}` : ''}`,
      'validation',
      400
    );
  }
  const theme = structuredClone(value) as CanvasThemeV1;
  theme.name = theme.name.trim();
  if (!theme.name) {
    throw new CanvasError('validation_error', 'canvas theme name must not be blank', 'validation', 400);
  }
  requireContrast(theme, 'text', 'surface');
  requireContrast(theme, 'text', 'canvas');
  requireContrast(theme, 'accentText', 'accent');
  requireContrast(theme, 'highlightText', 'highlight');
  return theme;
}
