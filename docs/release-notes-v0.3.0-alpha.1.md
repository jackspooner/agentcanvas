# AgentCanvas v0.3.0 alpha implementation notes

This main-branch alpha advances AgentCanvas from a renderer with movement
controls to a general canvas editor while preserving the v0.2 document and
plugin API v1 runtime contracts.

## Editor

- Added `@agentcanvas/editor` with a private React Flow adapter.
- Added pan, pointer-relative zoom, single and multiple selection,
  Shift-drag marquee, multi-element movement, resize handles, keyboard
  movement, and grid snapping.
- Added canonical duplicate, delete, copy, paste, select-all, undo, redo,
  zoom, fit, reset, and snap commands.
- Added revision-aware optimistic batch mutations and rollback after failed
  commits.
- Preserved Shadow DOM renderer lifecycle, interactive extension controls,
  world underlays/overlays, fixed bounds, and read-only shares.

## Extension authoring

- Added `@agentcanvas/extension-sdk` and
  `@agentcanvas/extension-testkit` as public facades over plugin API v1.
- Added typed extension, element, and command descriptors plus deterministic
  static manifest serialization.
- Added browser command contributions with selection, viewport, reveal,
  scoped transactions, overlays, diagnostics, and cancellation.
- Added browser activation disposables and registry teardown.
- Added host API `1.1.0` renderer lifecycle/activity state and one shared,
  visibility-gated browser frame scheduler for extension-owned dynamic visual
  nodes, without changing document schemas or shipping built-in effects.
- Added `create-agentcanvas-extension`; `create-agentcanvas-plugin` remains a
  compatibility entrypoint.

## Compatibility

- Installed distributions still use `agentcanvas.plugin.json`,
  `agentcanvas.plugin/v1`, and the `plugins/` runtime folder.
- Existing manifests without commands and existing browser activation hosts
  remain valid.
- React Flow types are not persisted or exposed through extension, HTTP, or
  MCP contracts.

## Image sources

- Made Assets-2 an optional extension rather than a host startup dependency.
- Added `agentcanvas.filesystem-images` for PNG, JPEG, WebP, GIF, and AVIF files below administrator-allowlisted roots.
- Persisted filesystem nodes use `rootId + relative path`; browser and snapshot bytes still flow through same-origin opaque resource handles.
- Reduced the clean default set to primitives, Markdown, and table while retaining both image sources in the built catalog.
- Added the optional `agentcanvas.gallery` extension with accessible local carousel navigation, six agent tools, deterministic cover snapshots, and provider-neutral image references.
- Added the host-owned `agentcanvas.image-sources@1.0.0` registry; Assets-2 and filesystem images now register independent adapters so Gallery does not depend on either storage provider.
- Added first-class per-canvas `CanvasThemeV1` state, validated agent/HTTP theme mutations, shared browser and snapshot theme contexts, and semantic theme adoption across all first-party extensions.
- Added the backup-backed offline physical schema 2-to-3 migration for `theme_json`; document envelopes remain version 2.
