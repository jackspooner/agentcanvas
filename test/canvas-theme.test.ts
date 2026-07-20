import { describe, expect, it } from 'vitest';
import { PluginElementValidator } from '../src/plugin-runtime/elements.js';
import { FrozenPluginRegistry } from '../src/plugin-runtime/registry.js';
import { V2SqliteCanvasStore } from '../src/store/v2.js';
import { normalizeCanvasTheme, themeContrast } from '../src/theme.js';
import { TEST_CANVAS_THEME } from './fixtures/canvas-theme.js';

function store(): V2SqliteCanvasStore {
  return new V2SqliteCanvasStore(new PluginElementValidator(new FrozenPluginRegistry([], new Map())), ':memory:');
}

describe('CanvasThemeV1', () => {
  it('accepts safe semantic tokens and enforces text contrast', () => {
    expect(normalizeCanvasTheme(TEST_CANVAS_THEME)).toEqual(TEST_CANVAS_THEME);
    expect(themeContrast(TEST_CANVAS_THEME.colors.highlightText, TEST_CANVAS_THEME.colors.highlight)).toBeGreaterThan(
      4.5
    );
    expect(() =>
      normalizeCanvasTheme({
        ...TEST_CANVAS_THEME,
        colors: { ...TEST_CANVAS_THEME.colors, highlightText: '#166534' }
      })
    ).toThrowError(/highlightText.*4\.5:1.*highlight/);
  });

  it('rejects unsafe font syntax and unknown theme fields', () => {
    expect(() =>
      normalizeCanvasTheme({
        ...TEST_CANVAS_THEME,
        typography: { ...TEST_CANVAS_THEME.typography, bodyFont: 'url(https://example.test/font.woff)' }
      })
    ).toThrowError(/canvas theme is invalid/);
    expect(() => normalizeCanvasTheme({ ...TEST_CANVAS_THEME, script: 'alert(1)' })).toThrowError(
      /canvas theme is invalid/
    );
    expect(() => normalizeCanvasTheme({ ...TEST_CANVAS_THEME, name: '   ' })).toThrowError(/name must not be blank/);
  });

  it('persists creation-time themes and atomically replaces or clears them', () => {
    const database = store();
    const created = database.createCanvas({ title: 'Themed', theme: TEST_CANVAS_THEME });
    expect(created.theme).toEqual(TEST_CANVAS_THEME);
    const replaced = database.updateCanvasTheme(created.id, {
      theme: { ...TEST_CANVAS_THEME, name: 'Forest report revised' },
      expectedRevision: created.revision,
      actor: 'test'
    });
    expect(replaced).toMatchObject({ revision: 2, theme: { name: 'Forest report revised' } });
    expect(() =>
      database.updateCanvasTheme(created.id, { theme: null, expectedRevision: created.revision })
    ).toThrowError(/expected revision 1, current revision 2/);
    const cleared = database.updateCanvasTheme(created.id, { theme: null, expectedRevision: replaced.revision });
    expect(cleared).toMatchObject({ revision: 3, theme: null });
    expect(database.db.prepare('SELECT operation_json FROM canvas_events ORDER BY revision').all()).toEqual([
      { operation_json: expect.stringContaining('Forest report revised') },
      { operation_json: '{"op":"setTheme","theme":null}' }
    ]);
    database.close();
  });
});
