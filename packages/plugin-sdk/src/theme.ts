import type { CanvasElement } from './element.js';
import type { JsonSchema } from './json.js';

export interface CanvasThemeColorsV1 {
  canvas: string;
  surface: string;
  surfaceMuted: string;
  text: string;
  textMuted: string;
  border: string;
  accent: string;
  accentText: string;
  highlight: string;
  highlightText: string;
}

export interface CanvasThemeTypographyV1 {
  bodyFont: string;
  headingFont: string;
  monoFont: string;
}

export interface CanvasThemeShapeV1 {
  borderWidth: number;
  radius: number;
}

/** Stable semantic design tokens persisted on one canvas. */
export interface CanvasThemeV1 {
  schemaVersion: 1;
  name: string;
  colors: CanvasThemeColorsV1;
  typography: CanvasThemeTypographyV1;
  shape: CanvasThemeShapeV1;
}

const color = { type: 'string', pattern: '^#[0-9a-fA-F]{6}$' } as const;
const font = { type: 'string', minLength: 1, maxLength: 200, pattern: `^[A-Za-z0-9 "'.,-]+$` } as const;

export const CANVAS_THEME_V1_SCHEMA: JsonSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'object',
  additionalProperties: false,
  required: ['schemaVersion', 'name', 'colors', 'typography', 'shape'],
  properties: {
    schemaVersion: { const: 1 },
    name: { type: 'string', minLength: 1, maxLength: 100 },
    colors: {
      type: 'object',
      additionalProperties: false,
      required: [
        'canvas',
        'surface',
        'surfaceMuted',
        'text',
        'textMuted',
        'border',
        'accent',
        'accentText',
        'highlight',
        'highlightText'
      ],
      properties: {
        canvas: color,
        surface: color,
        surfaceMuted: color,
        text: color,
        textMuted: color,
        border: color,
        accent: color,
        accentText: color,
        highlight: color,
        highlightText: color
      }
    },
    typography: {
      type: 'object',
      additionalProperties: false,
      required: ['bodyFont', 'headingFont', 'monoFont'],
      properties: { bodyFont: font, headingFont: font, monoFont: font }
    },
    shape: {
      type: 'object',
      additionalProperties: false,
      required: ['borderWidth', 'radius'],
      properties: {
        borderWidth: { type: 'number', minimum: 0, maximum: 8 },
        radius: { type: 'number', minimum: 0, maximum: 32 }
      }
    }
  }
};

export const DEFAULT_CANVAS_THEME: Readonly<CanvasThemeV1> = Object.freeze({
  schemaVersion: 1,
  name: 'AgentCanvas',
  colors: Object.freeze({
    canvas: '#f8fafc',
    surface: '#ffffff',
    surfaceMuted: '#f1f5f9',
    text: '#0f172a',
    textMuted: '#475569',
    border: '#cbd5e1',
    accent: '#2563eb',
    accentText: '#ffffff',
    highlight: '#dbeafe',
    highlightText: '#1e3a8a'
  }),
  typography: Object.freeze({
    bodyFont: 'Inter, Arial, sans-serif',
    headingFont: 'Inter, Arial, sans-serif',
    monoFont: 'ui-monospace, Consolas, monospace'
  }),
  shape: Object.freeze({ borderWidth: 1, radius: 8 })
});

export function themedString(
  element: Readonly<CanvasElement>,
  theme: Readonly<CanvasThemeV1>,
  styleKey: string,
  themeValue: string
): string {
  const explicit = element.style?.[styleKey];
  return typeof explicit === 'string' ? explicit : themeValue;
}

export function themedNumber(
  element: Readonly<CanvasElement>,
  theme: Readonly<CanvasThemeV1>,
  styleKey: string,
  themeValue: number
): number {
  const explicit = element.style?.[styleKey];
  return typeof explicit === 'number' && Number.isFinite(explicit) ? explicit : themeValue;
}
