# AgentCanvas v0.1 to v0.2 HTTP and MCP mapping

V0.2 is intentionally breaking. The unversioned v0.1 JSON API and feature-specific MCP aliases are not retained.

This is a migration reference. For the current interface and examples, use [HTTP and MCP](http-and-mcp.md) and runtime `GET /openapi.json`.

After upgrading, restart AgentCanvas and reload or reconnect every MCP client so it discards its cached tool catalog. Request a fresh `tools/list` before invoking tools; v0.1 aliases shown by a stale client are not compatibility endpoints and will be rejected.

## HTTP mapping

| v0.1 surface | v0.2 surface | Notes |
|---|---|---|
| `/api/configuration` | `/api/v1/configuration` | GET/PATCH |
| `/api/canvases` | `/api/v1/canvases` | GET/POST |
| `/api/canvases/:canvasId` | `/api/v1/canvases/:canvasId` | GET; PATCH updates bounds |
| `/api/canvases/:canvasId/title` | `/api/v1/canvases/:canvasId/title` | PATCH |
| none | `/api/v1/canvases/:canvasId/theme` | PATCH complete `CanvasThemeV1` or `null` |
| `/api/canvases/:canvasId/elements:batch` | `/api/v1/canvases/:canvasId/elements:batch` | operation names changed |
| v0.1 screenshot route/result | `/api/v1/canvases/:canvasId/snapshot` | returns opaque SVG resource handle, not inline data URL |
| v0.1 share-link routes | `/api/v1/canvases/:canvasId/share-links` | POST/GET/DELETE child route |
| v0.1 share token API | `/api/v1/share/:token` | read-only projection |
| v0.1 viewport routes | `/api/v1/canvases/:canvasId/viewport` and `/viewport/focus` | separate user report and agent focus |
| feature-specific asset proxy/details routes | `/api/v1/resources/:handle/details` and `/content`; Assets procedure `details` | callers use opaque handles |
| none | `/api/v1/plugins` and `/api/v1/plugins/:pluginId` | sanitized active registry |
| none | `/api/v1/plugins/:pluginId/procedures/:procedureName` | schema-validated plugin procedure |
| none | `/api/v1/plugin-modules/:pluginId/:buildHash/*` | browser module delivery |

Unversioned `/health`, `/whoami`, `/openapi.json`, `/mcp`, and browser routes remain unversioned.

## Element operation mapping

| v0.1 operation | v0.2 operation |
|---|---|
| `upsertElement` | `upsertElement` with complete namespaced current-version envelope |
| generic `patchElement` frame fields | `patchElementFrame` |
| generic `patchElement` data/style | `replaceElementData` with complete replacement |
| generic `patchElement` metadata | `replaceElementMetadata` |
| `deleteElement` | `deleteElement` |
| `clear` | `clear` |

Type or schema-version changes require migration or delete plus upsert.

## MCP core tools

| v0.1 tool | v0.2 replacement/status |
|---|---|
| `canvas_create` | `canvas_create` |
| `canvas_list` | `canvas_list` |
| `canvas_get` | `canvas_get` |
| none | `canvas_get_url` returns the direct browser URL for an existing canvas |
| none | `canvas_get_guidance`, `canvas_inspect` |
| rename | `canvas_rename` |
| none | `canvas_set_bounds`; `canvas_create` also accepts optional `bounds` |
| none | `canvas_set_theme`, `canvas_clear_theme` |
| generic add/update | `canvas_upsert_element`, `canvas_patch_element_frame`, `canvas_replace_element_data`, `canvas_replace_element_metadata` |
| `canvas_delete_element` | `canvas_delete_element` |
| `canvas_clear` | `canvas_clear` |
| none | `canvas_list_plugins`, `canvas_get_plugin` |
| configuration/share/viewport/screenshot tools | no current v0.2 MCP core equivalent; use the corresponding HTTP route where implemented |

## MCP feature tools

| v0.1 alias | v0.2 plugin tool |
|---|---|
| `canvas_add_text` | `agentcanvas_primitives__add_text` |
| shape through generic batch | `agentcanvas_primitives__add_shape` |
| `canvas_add_line` | `agentcanvas_primitives__add_line` |
| `canvas_add_arrow` | `agentcanvas_primitives__add_arrow` |
| `canvas_add_markdown` | `agentcanvas_markdown__add_document` |
| `canvas_add_table` | `agentcanvas_table__add_table` |
| `canvas_place_asset` | `agentcanvas_assets2__place` |
| asset detail workflow | `agentcanvas_assets2__get_details` or Assets `details` HTTP procedure |
| create image gallery | `agentcanvas_gallery__create` |
| edit gallery items | `agentcanvas_gallery__append_items`, `agentcanvas_gallery__remove_item`, or `agentcanvas_gallery__reorder_items` |
| choose gallery cover | `agentcanvas_gallery__set_cover` |
| change gallery presentation | `agentcanvas_gallery__update_settings` |
| `canvas_add_bbox_overlay` | `agentcanvas_image_overlays__add_bbox` |
| `canvas_add_bbox_overlay_from_asset` | `agentcanvas_image_overlays__add_bbox` with `layoutAssetRef` |
| `canvas_add_path_overlay` | `agentcanvas_image_overlays__add_path` |
| bbox PNG export | `agentcanvas_image_overlays__export_png` |
| bbox mask ZIP export | `agentcanvas_image_overlays__export_mask_zip` |
| `canvas_place_video` | `agentcanvas_video__place` |
| `canvas_place_glb_viewer` | `agentcanvas_glb_viewer__place` |

HTTP and stdio MCP share the resident registry because stdio proxies `/mcp`. Plugin tool input/output schemas are descriptor-owned. Core element inputs use the active registry's schemas, and core outputs describe canonical canvas/plugin projections.

## OpenAPI accuracy

Runtime OpenAPI covers configuration, title, share-link, viewport, share-token, plugin-module, plugin procedure, resource, and canvas routes. Resource handle/details components match the broker's compact `url` and flat metadata shapes. `docs/openapi.standard.json` is freshness-checked against the default registry output.
