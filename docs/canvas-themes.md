# Canvas themes

Canvas themes give agents one semantic design system for an entire canvas. A theme is canonical canvas state,
not an extension and not generic metadata. Browser renderers and snapshot renderers receive the same resolved
theme.

## Theme contract

`CanvasThemeV1` is exported by `@agentcanvas/plugin-sdk`:

```json
{
  "schemaVersion": 1,
  "name": "Warm Editorial",
  "colors": {
    "canvas": "#f6f5f2",
    "surface": "#ffffff",
    "surfaceMuted": "#eeeae3",
    "text": "#20201d",
    "textMuted": "#68665f",
    "border": "#d4d0c7",
    "accent": "#9f2d1f",
    "accentText": "#ffffff",
    "highlight": "#702016",
    "highlightText": "#ffffff"
  },
  "typography": {
    "bodyFont": "Inter, Arial, sans-serif",
    "headingFont": "Georgia, serif",
    "monoFont": "Consolas, monospace"
  },
  "shape": {
    "borderWidth": 1,
    "radius": 8
  }
}
```

Colors must be six-digit hexadecimal values. Font stacks may name local fonts and generic families but cannot
contain URLs or arbitrary CSS syntax. Border width is limited to 0 through 8 pixels and radius to 0 through 32
pixels. Normal text against both the canvas and surface, accent text against the accent, and highlight text
against the highlight must each meet a 4.5:1 contrast ratio.

## Applying a theme

Agents can include `theme` in `canvas_create`, replace it with `canvas_set_theme`, or restore AgentCanvas
defaults with `canvas_clear_theme`. HTTP clients use `PATCH /api/v1/canvases/{canvasId}/theme` with a complete
theme or `null`. Theme mutations accept `expectedRevision` and increment the canvas revision.

Theme resolution is deterministic:

1. an explicit element style;
2. the canvas theme's semantic token; then
3. the built-in AgentCanvas theme.

Setting a theme therefore does not destroy deliberate element-level overrides. New elements normally omit
style defaults and inherit the canvas theme automatically. `background.color` remains an explicit canvas
background override; otherwise the board and full-canvas snapshot use `theme.colors.canvas`.

## Extension authoring

Browser extensions read `RendererContext.theme`. Snapshot extensions read `SnapshotRendererContext.theme`.
Both surfaces receive a complete `CanvasThemeV1`, including the default theme when the canvas has no stored
theme. Use the SDK `themedString` and `themedNumber` helpers when a plugin style field should override a token.

Map visual roles semantically. For example, first-party tables use `highlight` and `highlightText` for header
cells, `surface` for the table body, `border` for grid lines, and `bodyFont` for cell text. Do not hard-code a
parallel light theme in browser or snapshot code.

Reusable cross-canvas preset storage is not part of v1. A theme has a human-readable name, but ownership and
versioning remain with the canvas that stores it.
