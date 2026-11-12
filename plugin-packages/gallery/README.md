# Media Gallery extension

Media Gallery is an optional AgentCanvas extension for presenting several images in one canvas element. Carousel navigation is browser-local and does not create canvas revisions.

Gallery items use provider-neutral image references. The current first-party providers are:

- `agentcanvas.assets2` with an Assets-2 asset reference;
- `agentcanvas.filesystem-images` with an allowlisted filesystem source.

The extension can remain installed when a referenced provider is unavailable. The gallery envelope and layout remain editable, unresolved items show diagnostics, and reinstalling the source provider restores rendering.

The installable distribution is built into `dist/plugin-catalog/agentcanvas.gallery` by `npm run plugins:build`. It is optional and is not activated by `plugins:materialize -- --defaults`.

Agent tools create galleries, append or remove items, reorder items, choose the deterministic cover image, and update presentation settings. A gallery must contain from 1 through 50 images. Autoplay defaults off and pauses for focus, pointer hover, and reduced-motion preferences.

Install the built gallery alongside an image-source extension while the host is
stopped, then restart:

```bash
npm run plugins:install -- dist/plugin-catalog/agentcanvas.gallery
```

An allowlisted filesystem item uses this stable provider envelope:

```json
{
  "provider": "agentcanvas.filesystem-images",
  "reference": { "rootId": "pictures", "path": "products/mug.png" }
}
```

The named tools are `agentcanvas_gallery__create`,
`agentcanvas_gallery__append_items`, `agentcanvas_gallery__remove_item`,
`agentcanvas_gallery__reorder_items`, `agentcanvas_gallery__set_cover` and
`agentcanvas_gallery__update_settings`. The persisted `initialIndex` controls
the initial slide and deterministic snapshot cover; navigation is browser-local.

Gallery settings are also editable from the canvas: every gallery node shows a `Settings` affordance that opens an autoplay, interval, fit, controls and indicators panel. The panel commits through the extension's own `apply-settings` browser command, so the change is one undoable canvas revision instead of a browser-local edit.

Autoplay keeps its remaining dwell time across renderer updates that do not change the gallery itself (host refreshes, theme, selection, viewport). Only a settings or item change, a pause-state change, or an explicit navigation restarts the interval.
