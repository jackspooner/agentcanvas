import type { CanvasThemeV1 } from '@agentcanvas/plugin-sdk';

export const TEST_CANVAS_THEME: CanvasThemeV1 = {
  schemaVersion: 1,
  name: 'Forest report',
  colors: {
    canvas: '#f0fdf4',
    surface: '#ffffff',
    surfaceMuted: '#dcfce7',
    text: '#14532d',
    textMuted: '#166534',
    border: '#86efac',
    accent: '#166534',
    accentText: '#ffffff',
    highlight: '#14532d',
    highlightText: '#ffffff'
  },
  typography: {
    bodyFont: 'Inter, Arial, sans-serif',
    headingFont: 'Georgia, serif',
    monoFont: 'Consolas, monospace'
  },
  shape: { borderWidth: 2, radius: 4 }
};
