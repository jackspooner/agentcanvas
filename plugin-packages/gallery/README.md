# Media Gallery extension

Media Gallery is an optional AgentCanvas extension for presenting several images in one canvas element. Carousel navigation is browser-local and does not create canvas revisions.

Gallery items use provider-neutral image references. The current first-party providers are:

- `agentcanvas.assets2` with an Assets-2 asset reference;
- `agentcanvas.filesystem-images` with an allowlisted filesystem source.

The extension can remain installed when a referenced provider is unavailable. The gallery envelope and layout remain editable, unresolved items show diagnostics, and reinstalling the source provider restores rendering.

The installable distribution is built into `dist/plugin-catalog/agentcanvas.gallery` by `npm run plugins:build`. It is optional and is not activated by `plugins:materialize -- --defaults`.

Agent tools create galleries, append or remove items, reorder items, choose the deterministic cover image, and update presentation settings. A gallery must contain from 1 through 50 images. Autoplay defaults off and pauses for focus, pointer hover, and reduced-motion preferences.
